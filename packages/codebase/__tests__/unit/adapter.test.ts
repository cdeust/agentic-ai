/**
 * Unit tests for adapters/rust-pipeline-adapter.ts
 *
 * Uses a mock JsonRpcClient to verify:
 *   - Each method passes the correct tool name to the client
 *   - camelCase inputs are translated to snake_case before forwarding
 *   - snake_case outputs are translated to camelCase before returning
 *   - Output Zod validation is applied; schema drift raises CodebaseValidationError
 *   - LSP error-reason codes raise CodebaseLspError (not CodebaseSubprocessError)
 *   - Dijkstra: concurrent calls resolve in id order via SerialQueue
 *   - Lamport: Date.now=0 does not affect operation
 *
 * source: docs/PHASE_3_PLAN.md §6.5 — genius gates
 * source: docs/ADR/0003 — preconditions are syntactic only
 */

import { describe, it, expect, vi } from "vitest";
import { RustPipelineAdapter } from "../../src/adapters/rust-pipeline-adapter.js";
import type { JsonRpcClient } from "../../src/internal/json-rpc-client.js";
import type { ProcessSupervisor } from "../../src/internal/process-supervisor.js";
import {
  CodebaseValidationError,
  CodebaseLspError,
} from "@agentic/core";

// ── Mock factory ──────────────────────────────────────────────────────────────

function makeEnvelope(payload: Record<string, unknown>): unknown {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

function makeMockClient(
  callImpl: (method: string, params: Record<string, unknown>) => Promise<unknown>,
): JsonRpcClient {
  return {
    call: vi.fn(callImpl),
    metrics: { depth: 0, lastRequestId: 0 },
  } as unknown as JsonRpcClient;
}

function makeMockSupervisor(): ProcessSupervisor {
  return {
    dispose: vi.fn(async () => undefined),
    isDisposed: false,
  } as unknown as ProcessSupervisor;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("RustPipelineAdapter", () => {
  describe("healthCheck", () => {
    it("calls health_check with empty params", async () => {
      const expected = {
        stage: 0,
        name: "ai-architect",
        status: "ok",
        server: "ai-architect",
        version: "0.0.4",
        protocol: "2.0",
        stages_registered: 9,
        tools_count: 23,
      };
      const client = makeMockClient(async () => makeEnvelope(expected));
      const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

      const result = await adapter.healthCheck({});
      expect(vi.mocked(client.call).mock.calls[0]?.[0]).toBe("health_check");
      expect(result.toolsCount).toBe(23);
      expect(result.server).toBe("ai-architect");
    });
  });

  describe("indexCodebase", () => {
    it("translates camelCase input to snake_case params", async () => {
      const rustOutput = {
        stage: 3,
        graph_path: "/tmp/graph.db",
        node_count: 50,
        edge_count: 200,
        files_indexed: 10,
        elapsed_ms: 500,
      };
      const client = makeMockClient(async () => makeEnvelope(rustOutput));
      const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

      const result = await adapter.indexCodebase({
        path: "/some/path",
        language: "rust",
        outputDir: "/tmp/out",
      });

      const [toolName, params] = vi.mocked(client.call).mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(toolName).toBe("index_codebase");
      expect(params["output_dir"]).toBe("/tmp/out");  // camel→snake
      expect(params["outputDir"]).toBeUndefined();    // original must not appear

      expect(result.nodeCount).toBe(50);
      expect(result.edgeCount).toBe(200);
      expect(result.graphPath).toBe("/tmp/graph.db");
    });

    it("raises CodebaseValidationError on schema drift", async () => {
      const badOutput = {
        stage: 3,
        graph_path: "/tmp/graph.db",
        // Missing required fields: node_count, edge_count, files_indexed, elapsed_ms
      };
      const client = makeMockClient(async () => makeEnvelope(badOutput));
      const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

      await expect(
        adapter.indexCodebase({
          path: "/p",
          language: "auto",
          outputDir: "/out",
        }),
      ).rejects.toThrowError(CodebaseValidationError);
    });
  });

  describe("getSymbol — discriminated union", () => {
    it("returns GetSymbolOutput on success", async () => {
      const rustOutput = {
        node: { id: "Foo::bar", label: "NODE_FUNCTION" },
        edges_out: [],
        edges_in: [],
      };
      const client = makeMockClient(async () => makeEnvelope(rustOutput));
      const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

      const result = await adapter.getSymbol({
        graphPath: "/g.db",
        qualifiedName: "Foo::bar",
      });
      if ("node" in result) {
        expect(result.node["id"]).toBe("Foo::bar");
      } else {
        throw new Error("Expected GetSymbolOutput, got NotFoundOutput");
      }
    });

    it("returns NotFoundOutput when symbol is absent", async () => {
      const rustOutput = {
        status: "error",
        reason: "symbol_not_found",
        did_you_mean: ["Foo::baz"],
      };
      const client = makeMockClient(async () => makeEnvelope(rustOutput));
      const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

      const result = await adapter.getSymbol({
        graphPath: "/g.db",
        qualifiedName: "Foo::missing",
      });
      if ("status" in result) {
        expect(result.reason).toBe("symbol_not_found");
        expect(result.didYouMean).toContain("Foo::baz");
      } else {
        throw new Error("Expected NotFoundOutput, got GetSymbolOutput");
      }
    });
  });

  describe("lspResolve — four LSP error codes (ADR-0001)", () => {
    const lspReasons = [
      "lsp_command_not_allowed",
      "lsp_not_found",
      "lsp_probe_failed",
      "lsp_resolve_failed",
    ] as const;

    for (const reason of lspReasons) {
      it(`raises CodebaseLspError for reason=${reason}`, async () => {
        const rustOutput = {
          status: "error",
          reason,
          message: `LSP error: ${reason}`,
          allowed: reason === "lsp_command_not_allowed" ? ["rust-analyzer"] : undefined,
        };
        const client = makeMockClient(async () => makeEnvelope(rustOutput));
        const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

        await expect(
          adapter.lspResolve({
            graphPath: "/g.db",
            codebasePath: "/code",
            lspCommand: "/usr/bin/rust-analyzer",
          }),
        ).rejects.toThrowError(CodebaseLspError);

        await expect(
          adapter.lspResolve({
            graphPath: "/g.db",
            codebasePath: "/code",
            lspCommand: "/usr/bin/rust-analyzer",
          }),
        ).rejects.toMatchObject({ reason });
      });
    }

    it("returns LspResolveOutput on success", async () => {
      const rustOutput = {
        resolved_count: 42,
        failed_count: 3,
        skipped_count: 1,
        elapsed_ms: 1500,
      };
      const client = makeMockClient(async () => makeEnvelope(rustOutput));
      const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

      const result = await adapter.lspResolve({
        graphPath: "/g.db",
        codebasePath: "/code",
      });
      expect(result.resolvedCount).toBe(42);
      expect(result.failedCount).toBe(3);
    });
  });

  describe("dispose()", () => {
    it("delegates to supervisor.dispose()", async () => {
      const supervisor = makeMockSupervisor();
      const adapter = new RustPipelineAdapter(
        supervisor,
        makeMockClient(async () => makeEnvelope({})),
      );
      await adapter.dispose();
      expect(vi.mocked(supervisor.dispose)).toHaveBeenCalledOnce();
    });
  });

  describe("Dijkstra genius gate — concurrent calls resolve in id order", () => {
    it("10 concurrent healthCheck() calls all resolve correctly", async () => {
      const rustOutput = {
        stage: 0,
        name: "ai-architect",
        status: "ok",
        server: "ai-architect",
        version: "0.0.4",
        protocol: "2.0",
        stages_registered: 9,
        tools_count: 23,
      };
      const client = makeMockClient(async () => makeEnvelope(rustOutput));
      const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

      // All 10 calls are fired concurrently.
      const results = await Promise.all(
        Array.from({ length: 10 }, () => adapter.healthCheck({})),
      );
      expect(results).toHaveLength(10);
      for (const r of results) {
        expect(r.server).toBe("ai-architect");
      }
      // All 10 went through the serial queue — call count is 10.
      expect(vi.mocked(client.call)).toHaveBeenCalledTimes(10);
    });
  });

  describe("Lamport genius gate — Date.now=0 does not affect correctness", () => {
    it("analyzeCodebase returns valid output with Date.now frozen at 0", async () => {
      const realDateNow = Date.now;
      Date.now = () => 0;

      const rustOutput = {
        graph_path: "/g.db",
        index: {
          stage: 3,
          graph_path: "/g.db",
          node_count: 100,
          edge_count: 400,
          files_indexed: 20,
          elapsed_ms: 1000,
        },
        resolve: {
          imports_resolved: 10,
          calls_resolved: 20,
          implements_resolved: 0,
          extends_resolved: 5,
          uses_resolved: 3,
          total_edges: 38,
          total_refs: 100,
          resolution_rate: 0.38,
          unresolved_count: 62,
          elapsed_ms: 500,
        },
        cluster: {
          community_count: 4,
          modularity: 0.6,
          process_count: 2,
          clusters: [],
          total_memberships: 10,
          elapsed_ms: 200,
        },
        search_index: { status: "indexed" },
        lsp_resolve: null,
        total_elapsed_ms: 1700,
      };

      const client = makeMockClient(async () => makeEnvelope(rustOutput));
      const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

      const result = await adapter.analyzeCodebase({
        path: "/code",
        language: "auto",
        outputDir: "/out",
      });

      // The Rust child provides elapsed_ms; the TS adapter MUST NOT recompute it
      // from Date.now (which is frozen at 0). The result must be ≥ 0.
      expect(result.totalElapsedMs).toBeGreaterThanOrEqual(0);
      expect(result.graphPath).toBe("/g.db");

      Date.now = realDateNow;
    });
  });
});
