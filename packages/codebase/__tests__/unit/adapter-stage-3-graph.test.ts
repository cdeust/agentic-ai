/**
 * Unit tests for Stage 3 graph MCP tools in RustPipelineAdapter.
 *
 * Covers: queryGraph (3a), resolveGraph (3b), clusterGraph, getProcesses,
 *         getImpact (3c), searchCodebase, getContext (3d), detectChanges (3e).
 *
 * Contract under test:
 *   - Each method forwards the correct tool name to the JsonRpcClient.
 *   - camelCase TS inputs are translated to snake_case before forwarding.
 *   - snake_case Rust outputs are translated to camelCase before returning.
 *   - Zod output validation is applied; missing required fields raise
 *     CodebaseValidationError (schema drift is not silently accepted).
 *   - Rust string numeric values (e.g. "0.38" for resolution_rate,
 *     "0.854890" for modularity) are coerced to JS numbers by z.coerce.number().
 *
 * source: docs/ADR/0003 — preconditions are syntactic only
 * source: packages/codebase-rust/src/tool_schemas.rs:238-600 (commit 2cc3780)
 * source: packages/core/src/ports/codebase-outputs.ts — Zod output schemas
 *
 * Split from adapter-stage-tools.test.ts per §4.1 (500 LOC file limit).
 */

import { describe, it, expect, vi } from "vitest";
import { RustPipelineAdapter } from "../../src/adapters/rust-pipeline-adapter.js";
import type { JsonRpcClient } from "../../src/internal/json-rpc-client.js";
import type { ProcessSupervisor } from "../../src/internal/process-supervisor.js";
import { CodebaseValidationError } from "@agentic/core";

// ── Mock helpers ──────────────────────────────────────────────────────────────

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

// ── Stage 3a: query_graph ─────────────────────────────────────────────────────

describe("queryGraph (Stage 3a)", () => {
  // postcondition: columns and rows arrays returned; elapsed_ms → elapsedMs
  // source: tool_schemas.rs:238-258
  it("happy path — returns columns and rows from Cypher query", async () => {
    const rustOutput = {
      columns: ["id", "label"],
      rows: [["src/main.rs::main", "NODE_FUNCTION"]],
      result: null,
      elapsed_ms: 12,
    };
    const client = makeMockClient(async () => makeEnvelope(rustOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    const result = await adapter.queryGraph({
      graphPath: "/g.db",
      query: "MATCH (n:NODE_FUNCTION) RETURN n.id, n.label LIMIT 10",
    });

    const [toolName, params] = vi.mocked(client.call).mock.calls[0] as [string, Record<string, unknown>];
    expect(toolName).toBe("query_graph");
    // camelCase → snake_case on input
    expect(params["graph_path"]).toBe("/g.db");
    expect(params["graphPath"]).toBeUndefined();
    // snake_case → camelCase on output
    expect(result.columns).toEqual(["id", "label"]);
    expect(result.rows).toHaveLength(1);
    expect(result.elapsedMs).toBe(12);
  });

  // postcondition: missing required "columns" field raises CodebaseValidationError
  it("raises CodebaseValidationError when output is missing required columns field", async () => {
    const badOutput = { rows: [], result: null, elapsed_ms: 0 };
    const client = makeMockClient(async () => makeEnvelope(badOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    await expect(
      adapter.queryGraph({ graphPath: "/g.db", query: "MATCH (n) RETURN n" }),
    ).rejects.toThrowError(CodebaseValidationError);
  });
});

// ── Stage 3b: resolve_graph ───────────────────────────────────────────────────

describe("resolveGraph (Stage 3b)", () => {
  // postcondition: resolutionRate coerced from Rust string; totalEdges returned
  // source: tool_schemas.rs:282-298
  // source: codebase-outputs.ts — "resolution_rate is a string like '0.48'"
  it("happy path — coerces string resolution_rate to number", async () => {
    const rustOutput = {
      imports_resolved: 10,
      calls_resolved: 20,
      implements_resolved: 0,
      extends_resolved: 5,
      uses_resolved: 3,
      total_edges: 38,
      total_refs: 100,
      resolution_rate: "0.38",  // Rust emits as string; z.coerce.number() handles it
      unresolved_count: 62,
      elapsed_ms: 200,
    };
    const client = makeMockClient(async () => makeEnvelope(rustOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    const result = await adapter.resolveGraph({ graphPath: "/g.db" });

    const [toolName, params] = vi.mocked(client.call).mock.calls[0] as [string, Record<string, unknown>];
    expect(toolName).toBe("resolve_graph");
    expect(params["graph_path"]).toBe("/g.db");
    // Rust string "0.38" must be coerced to number 0.38 by z.coerce.number()
    expect(result.resolutionRate).toBe(0.38);
    expect(result.totalEdges).toBe(38);
  });

  // postcondition: missing required "totalEdges" raises CodebaseValidationError
  it("raises CodebaseValidationError when totalEdges is absent", async () => {
    const badOutput = { resolution_rate: "0.5" };
    const client = makeMockClient(async () => makeEnvelope(badOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    await expect(
      adapter.resolveGraph({ graphPath: "/g.db" }),
    ).rejects.toThrowError(CodebaseValidationError);
  });
});

// ── Stage 3c: cluster_graph ───────────────────────────────────────────────────

describe("clusterGraph (Stage 3c)", () => {
  // postcondition: modularity coerced from Rust string; community_count → communityCount
  // source: tool_schemas.rs:300-321
  // source: codebase-outputs.ts — "modularity is emitted as string '0.854890'"
  it("happy path — coerces string modularity to number", async () => {
    const rustOutput = {
      community_count: 4,
      modularity: "0.854890",  // Rust emits as string; z.coerce.number() handles it
      process_count: 2,
      clusters: [],
      total_memberships: 10,
      elapsed_ms: 150,
    };
    const client = makeMockClient(async () => makeEnvelope(rustOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    const result = await adapter.clusterGraph({ graphPath: "/g.db" });

    const [toolName] = vi.mocked(client.call).mock.calls[0] as [string, Record<string, unknown>];
    expect(toolName).toBe("cluster_graph");
    expect(result.communityCount).toBe(4);
    // string "0.854890" must be coerced to number
    expect(result.modularity).toBeCloseTo(0.85489);
    expect(result.processCount).toBe(2);
  });

  it("raises CodebaseValidationError when communityCount is missing", async () => {
    const badOutput = { modularity: "0.5", process_count: 2 };
    const client = makeMockClient(async () => makeEnvelope(badOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    await expect(
      adapter.clusterGraph({ graphPath: "/g.db" }),
    ).rejects.toThrowError(CodebaseValidationError);
  });
});

// ── Stage 3c: get_processes ───────────────────────────────────────────────────

describe("getProcesses (Stage 3c)", () => {
  // postcondition: processCount and processes array returned
  // source: tool_schemas.rs:323-339
  it("happy path — returns process list with entry points", async () => {
    const rustOutput = {
      process_count: 2,
      processes: [
        { entry: "src/main.rs::main", kind: "main", depth: 5, symbol_count: 12 },
        { entry: "src/lib.rs::handle_request", kind: "handler", depth: 3, symbol_count: 8 },
      ],
    };
    const client = makeMockClient(async () => makeEnvelope(rustOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    const result = await adapter.getProcesses({ graphPath: "/g.db" });

    const [toolName] = vi.mocked(client.call).mock.calls[0] as [string, Record<string, unknown>];
    expect(toolName).toBe("get_processes");
    // process_count → processCount
    expect(result.processCount).toBe(2);
    expect(result.processes).toHaveLength(2);
  });

  it("raises CodebaseValidationError when processCount is missing", async () => {
    const badOutput = { processes: [] };
    const client = makeMockClient(async () => makeEnvelope(badOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    await expect(
      adapter.getProcesses({ graphPath: "/g.db" }),
    ).rejects.toThrowError(CodebaseValidationError);
  });
});

// ── Stage 3c: get_impact ──────────────────────────────────────────────────────

describe("getImpact (Stage 3c)", () => {
  // postcondition: communities and processes arrays; qualified_name forwarded as snake_case
  // source: packages/codebase-rust/src/main.rs:2337-2346 — do_get_impact
  // SCHEMA FIX: communities is array<string> (community IDs), not array<object>
  it("happy path — returns blast-radius communities (string IDs) and processes (string names)", async () => {
    // source: packages/codebase-rust/src/main.rs:2337-2346
    // communities: Vec<String> — array of community ID strings
    // processes: Vec<String> — array of process name strings
    const rustOutput = {
      communities: ["community::louvain::1::3", "community::louvain::1::5"],
      communities_affected: 2,
      processes: [],
      processes_affected: 0,
      qualified_name: "src/auth.rs::verify_token",
    };
    const client = makeMockClient(async () => makeEnvelope(rustOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    const result = await adapter.getImpact({
      graphPath: "/g.db",
      qualifiedName: "src/auth.rs::verify_token",
    });

    const [toolName, params] = vi.mocked(client.call).mock.calls[0] as [string, Record<string, unknown>];
    expect(toolName).toBe("get_impact");
    // camelCase → snake_case on input
    expect(params["qualified_name"]).toBe("src/auth.rs::verify_token");
    expect(params["qualifiedName"]).toBeUndefined();
    // communities_affected → communitiesAffected
    expect(result.communitiesAffected).toBe(2);
    expect(result.processesAffected).toBe(0);
    // communities is an array of strings
    expect(result.communities).toEqual(["community::louvain::1::3", "community::louvain::1::5"]);
  });

  it("raises CodebaseValidationError when communities array is missing", async () => {
    const badOutput = { communities_affected: 0, processes: [], processes_affected: 0 };
    const client = makeMockClient(async () => makeEnvelope(badOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    await expect(
      adapter.getImpact({ graphPath: "/g.db", qualifiedName: "src/foo.rs::bar" }),
    ).rejects.toThrowError(CodebaseValidationError);
  });
});

// ── Stage 3d: search_codebase ─────────────────────────────────────────────────

describe("searchCodebase (Stage 3d)", () => {
  // postcondition: resultCount and results array returned with elapsedMs
  // source: tool_schemas.rs:363-393
  it("happy path — returns ranked search results", async () => {
    const rustOutput = {
      result_count: 2,
      results: [
        { name: "verify_token", kind: "Function", file_path: "src/auth.rs", score: 0.95 },
        { name: "check_token", kind: "Function", file_path: "src/auth.rs", score: 0.7 },
      ],
      elapsed_ms: 8,
    };
    const client = makeMockClient(async () => makeEnvelope(rustOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    const result = await adapter.searchCodebase({
      graphPath: "/g.db",
      query: "verify_token",
      limit: 10,
    });

    const [toolName] = vi.mocked(client.call).mock.calls[0] as [string, Record<string, unknown>];
    expect(toolName).toBe("search_codebase");
    // result_count → resultCount
    expect(result.resultCount).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.elapsedMs).toBe(8);
  });

  it("raises CodebaseValidationError when resultCount is missing", async () => {
    const badOutput = { results: [], elapsed_ms: 1 };
    const client = makeMockClient(async () => makeEnvelope(badOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    await expect(
      adapter.searchCodebase({ graphPath: "/g.db", query: "auth" }),
    ).rejects.toThrowError(CodebaseValidationError);
  });
});

// ── Stage 3d: get_context ─────────────────────────────────────────────────────

describe("getContext (Stage 3d)", () => {
  // postcondition: symbol + relationships + community + processes returned
  // source: packages/codebase-rust/src/main.rs:2481-2506 — do_get_context
  // SCHEMA FIX: relationships is a nested OBJECT with sub-arrays, not an array
  it("happy path — returns full 360° symbol view with relationships as nested object", async () => {
    // source: packages/codebase-rust/src/main.rs:2494-2503 — relationships shape
    // relationships is a dict: { imports: [...], imported_by: [...], calls: [...], ... }
    const rustOutput = {
      symbol: { qualified_name: "src/auth.rs::verify_token", name: "verify_token", kind: "Function",
                file_path: "src/auth.rs", start_line: 10, end_line: 25, visibility: "pub" },
      relationships: {
        imports: [],
        imported_by: [],
        calls: [{ name: "query", qualified_name: "src/db.rs::query", kind: "Function" }],
        called_by: [],
        implements: [],
        implemented_by: [],
        uses: [],
        used_by: [],
      },
      community: { id: "c-1", name: "auth_community", member_count: 5 },
      processes: [],
    };
    const client = makeMockClient(async () => makeEnvelope(rustOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    const result = await adapter.getContext({
      graphPath: "/g.db",
      qualifiedName: "src/auth.rs::verify_token",
    });

    const [toolName] = vi.mocked(client.call).mock.calls[0] as [string, Record<string, unknown>];
    expect(toolName).toBe("get_context");
    // Result matches success schema (not NotFoundOutput)
    if ("symbol" in result) {
      expect(result.symbol["qualifiedName"]).toBe("src/auth.rs::verify_token");
      // relationships is an object with sub-arrays
      const rel = result.relationships as Record<string, unknown>;
      expect(Array.isArray(rel["calls"])).toBe(true);
      expect((rel["calls"] as unknown[]).length).toBe(1);
    } else {
      throw new Error("Expected GetContextOutput, got NotFoundOutput");
    }
  });

  it("raises CodebaseValidationError when output matches neither success nor not-found schema", async () => {
    // Output that matches neither: no symbol, no status, no reason
    const badOutput = { unexpected_field: true };
    const client = makeMockClient(async () => makeEnvelope(badOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    await expect(
      adapter.getContext({ graphPath: "/g.db", qualifiedName: "src/auth.rs::missing" }),
    ).rejects.toThrowError(CodebaseValidationError);
  });
});

// ── Stage 3e: detect_changes ──────────────────────────────────────────────────

describe("detectChanges (Stage 3e)", () => {
  // postcondition: symbolsAffected, communitiesAffected, processesAffected arrays + riskScore
  // source: packages/codebase-rust/src/main.rs:2792-2804 — do_detect_changes
  // SCHEMA FIX: affectedCount/affected were wrong names; actual fields are
  //   symbols_affected, symbols_affected_count, communities_affected,
  //   communities_affected_count, processes_affected, processes_affected_count, risk_score
  it("happy path — returns symbolsAffected/communitiesAffected/processesAffected with riskScore", async () => {
    const rustOutput = {
      files_changed: 1,
      symbols_affected: [
        { qualified_name: "src/auth.rs::verify_token", kind: "Function" },
        { qualified_name: "src/auth.rs::check_scope", kind: "Function" },
        { qualified_name: "src/lib.rs::dispatch", kind: "Function" },
      ],
      symbols_affected_count: 3,
      communities_affected: [{ id: "c-1" }],
      communities_affected_count: 1,
      processes_affected: [],
      processes_affected_count: 0,
      risk_score: "0.7500",
    };
    const client = makeMockClient(async () => makeEnvelope(rustOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    const result = await adapter.detectChanges({
      graphPath: "/g.db",
      diffText: "--- a/src/auth.rs\n+++ b/src/auth.rs\n@@ -1,4 +1,5 @@",
    });

    const [toolName, params] = vi.mocked(client.call).mock.calls[0] as [string, Record<string, unknown>];
    expect(toolName).toBe("detect_changes");
    // camelCase → snake_case on input
    expect(params["diff_text"]).toBeDefined();
    expect(params["diffText"]).toBeUndefined();
    // symbols_affected_count → symbolsAffectedCount
    expect(result.symbolsAffectedCount).toBe(3);
    expect(result.symbolsAffected).toHaveLength(3);
    expect(result.communitiesAffectedCount).toBe(1);
    expect(result.processesAffectedCount).toBe(0);
    // risk_score is a string coerced to number by z.coerce
    expect(result.riskScore).toBe(0.75);
  });

  it("raises CodebaseValidationError when symbolsAffected is missing", async () => {
    // source: DetectChangesOutputSchema requires symbolsAffected (array), symbolsAffectedCount, etc.
    const badOutput = { risk_score: "0.5" };
    const client = makeMockClient(async () => makeEnvelope(badOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    await expect(
      adapter.detectChanges({ graphPath: "/g.db" }),
    ).rejects.toThrowError(CodebaseValidationError);
  });
});
