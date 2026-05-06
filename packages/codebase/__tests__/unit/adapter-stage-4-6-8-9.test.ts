/**
 * Unit tests for Stage 4, 6, 8, and 9 MCP tools in RustPipelineAdapter.
 *
 * Covers: preparePrdInput (Stage 4), validatePrdAgainstGraph (Stage 6),
 *         checkSecurityGates (Stage 8), verifySemanticDiff (Stage 9).
 *
 * Priority 1 (ADR-0004 partial-triple divergence):
 *   validatePrdAgainstGraph and checkSecurityGates have an intentional TS-vs-Rust
 *   divergence documented in MIGRATED.md and ADR-0004: the TS adapter enforces an
 *   all-or-nothing artifact triple via a single `artifacts?` bundle. Partial triples
 *   (run_id without output_dir) are a type error at compile time, not a silent
 *   no-op as in the Rust binary.
 *
 * Contract under test:
 *   - preparePrdInput: graphPath is camelCase → snake_case; output camelCase'd.
 *   - validatePrdAgainstGraph dry-run: NO run_id/finding_id/output_dir forwarded.
 *   - validatePrdAgainstGraph write-artifacts: ALL three forwarded as snake_case.
 *   - checkSecurityGates: same dry-run / write-artifacts enforcement as above.
 *   - verifySemanticDiff: before/after graph paths forwarded as snake_case;
 *     dangling_refs → danglingRefs, new_unresolved → newUnresolved.
 *   - Zod output validation applied; missing required fields raise
 *     CodebaseValidationError.
 *
 * source: docs/ADR/0004-validation-tool-optional-triple.md
 * source: cutover-staging/automatised-pipeline/MIGRATED.md §Users who call...
 * source: packages/codebase-rust/src/tool_schemas.rs:492-564 (commit 2cc3780)
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

// ── Stage 4: prepare_prd_input ────────────────────────────────────────────────

describe("preparePrdInput (Stage 4)", () => {
  // postcondition: artifact path and matched symbols returned; graphPath snake_case'd
  // source: tool_schemas.rs:492-508
  it("happy path — bundles finding + graph intel into stage-4 artifact", async () => {
    const rustOutput = {
      status: "ok",
      run_id: "r-001",
      finding_id: "f-001",
      artifact: "/out/runs/r-001/findings/f-001/stage-4.prd_input.json",
      symbols: [{ name: "verify_token", file: "src/auth.rs" }],
    };
    const client = makeMockClient(async () => makeEnvelope(rustOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    const result = await adapter.preparePrdInput({
      runId: "r-001",
      findingId: "f-001",
      outputDir: "/out",
      graphPath: "/g.db",
    });

    const [toolName, params] = vi.mocked(client.call).mock.calls[0] as [string, Record<string, unknown>];
    expect(toolName).toBe("prepare_prd_input");
    // camelCase → snake_case on input
    expect(params["graph_path"]).toBe("/g.db");
    expect(params["graphPath"]).toBeUndefined();
    expect(result.status).toBe("ok");
    // deepToCamel: finding_id → findingId
    expect(result.findingId).toBe("f-001");
  });

  it("raises CodebaseValidationError when status is missing", async () => {
    const badOutput = { run_id: "r-001", finding_id: "f-001" };
    const client = makeMockClient(async () => makeEnvelope(badOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    await expect(
      adapter.preparePrdInput({
        runId: "r-001",
        findingId: "f-001",
        outputDir: "/out",
        graphPath: "/g.db",
      }),
    ).rejects.toThrowError(CodebaseValidationError);
  });
});

// ── Stage 6: validate_prd_against_graph — PRIORITY 1 (ADR-0004) ──────────────

describe("validatePrdAgainstGraph (Stage 6) — ADR-0004 partial-triple enforcement", () => {
  // Invariant: the Rust binary's all-or-nothing triple semantics are enforced
  // at the TS layer via the `artifacts` bundle field on the input schema.
  //
  // Postcondition A (dry-run): when artifacts is absent, NO triple fields reach Rust.
  // Postcondition B (write-artifacts): when artifacts is present, all three sub-fields
  //   are forwarded as top-level snake_case params.
  // Postcondition C: the TS `artifacts` bundle wrapper is NOT forwarded to Rust.
  //
  // source: docs/ADR/0004-validation-tool-optional-triple.md
  // source: cutover-staging/automatised-pipeline/MIGRATED.md §Users who call...

  it("dry-run mode — no run_id/finding_id/output_dir forwarded to Rust", async () => {
    const rustOutput = {
      status: "ok",
      gates_passed: true,
      hallucinations: [],
      warnings: [],
      critical_count: 0,
      warning_count: 0,
    };
    const client = makeMockClient(async () => makeEnvelope(rustOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    await adapter.validatePrdAgainstGraph({
      prdPath: "/out/prd.md",
      graphPath: "/g.db",
    });

    const [, params] = vi.mocked(client.call).mock.calls[0] as [string, Record<string, unknown>];
    // Postcondition A: no triple fields in dry-run
    expect(params["run_id"]).toBeUndefined();
    expect(params["finding_id"]).toBeUndefined();
    expect(params["output_dir"]).toBeUndefined();
    // Postcondition C: the bundle wrapper must not reach Rust
    expect(params["artifacts"]).toBeUndefined();
  });

  it("write-artifacts mode — all three triple fields forwarded as snake_case to Rust", async () => {
    const rustOutput = {
      status: "ok",
      gates_passed: true,
      hallucinations: [],
      warnings: [],
      critical_count: 0,
      warning_count: 0,
    };
    const client = makeMockClient(async () => makeEnvelope(rustOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    await adapter.validatePrdAgainstGraph({
      prdPath: "/out/prd.md",
      graphPath: "/g.db",
      artifacts: {
        runId: "r-001",
        findingId: "f-001",
        outputDir: "/out",
      },
    });

    const [toolName, params] = vi.mocked(client.call).mock.calls[0] as [string, Record<string, unknown>];
    expect(toolName).toBe("validate_prd_against_graph");
    // Postcondition B: all three forwarded as snake_case
    expect(params["run_id"]).toBe("r-001");
    expect(params["finding_id"]).toBe("f-001");
    expect(params["output_dir"]).toBe("/out");
    // Postcondition C: the TS bundle wrapper must not appear
    expect(params["artifacts"]).toBeUndefined();
  });

  it("happy path — returns gatesPassed and camelCase'd counts", async () => {
    const rustOutput = {
      status: "ok",
      gates_passed: false,
      hallucinations: [{ symbol: "NonExistentFn", axis: "hallucination", severity: "critical" }],
      warnings: [],
      critical_count: 1,
      warning_count: 0,
    };
    const client = makeMockClient(async () => makeEnvelope(rustOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    const result = await adapter.validatePrdAgainstGraph({
      prdPath: "/out/prd.md",
      graphPath: "/g.db",
    });

    expect(result.status).toBe("ok");
    // gates_passed → gatesPassed, critical_count → criticalCount
    expect(result.gatesPassed).toBe(false);
    expect(result.criticalCount).toBe(1);
  });

  // postcondition: missing required "status" raises CodebaseValidationError
  it("raises CodebaseValidationError when output is missing status field", async () => {
    const badOutput = { gates_passed: true };
    const client = makeMockClient(async () => makeEnvelope(badOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    await expect(
      adapter.validatePrdAgainstGraph({
        prdPath: "/out/prd.md",
        graphPath: "/g.db",
      }),
    ).rejects.toThrowError(CodebaseValidationError);
  });
});

// ── Stage 8: check_security_gates — PRIORITY 1 (ADR-0004) ────────────────────

describe("checkSecurityGates (Stage 8) — ADR-0004 partial-triple enforcement", () => {
  // Same ADR-0004 invariant as validatePrdAgainstGraph.
  // source: docs/ADR/0004-validation-tool-optional-triple.md

  it("dry-run mode — no run_id/finding_id/output_dir forwarded to Rust", async () => {
    const rustOutput = {
      status: "ok",
      gates_passed: true,
      flags: [],
      critical_count: 0,
    };
    const client = makeMockClient(async () => makeEnvelope(rustOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    await adapter.checkSecurityGates({
      graphPath: "/g.db",
      changedSymbols: ["src/auth.rs::verify_token"],
    });

    const [, params] = vi.mocked(client.call).mock.calls[0] as [string, Record<string, unknown>];
    expect(params["run_id"]).toBeUndefined();
    expect(params["finding_id"]).toBeUndefined();
    expect(params["output_dir"]).toBeUndefined();
    expect(params["artifacts"]).toBeUndefined();
  });

  it("write-artifacts mode — all three triple fields forwarded as snake_case", async () => {
    const rustOutput = {
      status: "ok",
      gates_passed: true,
      flags: [],
      critical_count: 0,
    };
    const client = makeMockClient(async () => makeEnvelope(rustOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    await adapter.checkSecurityGates({
      graphPath: "/g.db",
      changedSymbols: ["src/auth.rs::verify_token"],
      artifacts: {
        runId: "r-001",
        findingId: "f-001",
        outputDir: "/out",
      },
    });

    const [toolName, params] = vi.mocked(client.call).mock.calls[0] as [string, Record<string, unknown>];
    expect(toolName).toBe("check_security_gates");
    expect(params["run_id"]).toBe("r-001");
    expect(params["finding_id"]).toBe("f-001");
    expect(params["output_dir"]).toBe("/out");
    expect(params["artifacts"]).toBeUndefined();
  });

  it("happy path — changedSymbols forwarded as snake_case; gatesPassed camelCase'd", async () => {
    const rustOutput = {
      status: "ok",
      gates_passed: false,
      flags: [
        { gate: "S1_auth_critical_touch", severity: "critical", symbols: ["src/auth.rs::verify_token"] },
      ],
      critical_count: 1,
    };
    const client = makeMockClient(async () => makeEnvelope(rustOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    const result = await adapter.checkSecurityGates({
      graphPath: "/g.db",
      changedSymbols: ["src/auth.rs::verify_token"],
    });

    const [, params] = vi.mocked(client.call).mock.calls[0] as [string, Record<string, unknown>];
    // changed_symbols forwarded as snake_case array
    expect(params["changed_symbols"]).toEqual(["src/auth.rs::verify_token"]);
    expect(params["changedSymbols"]).toBeUndefined();
    // gates_passed → gatesPassed, critical_count → criticalCount
    expect(result.gatesPassed).toBe(false);
    expect(result.criticalCount).toBe(1);
  });

  it("raises CodebaseValidationError when gatesPassed is missing", async () => {
    const badOutput = { status: "ok", flags: [], critical_count: 0 };
    const client = makeMockClient(async () => makeEnvelope(badOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    await expect(
      adapter.checkSecurityGates({
        graphPath: "/g.db",
        changedSymbols: [],
      }),
    ).rejects.toThrowError(CodebaseValidationError);
  });
});

// ── Stage 9: verify_semantic_diff ─────────────────────────────────────────────

describe("verifySemanticDiff (Stage 9)", () => {
  // postcondition: regressionScore returned; dangling_refs → danglingRefs;
  //                new_unresolved → newUnresolved; new_cycles → newCycles
  // source: tool_schemas.rs:549-564
  it("happy path — returns regression score with camelCase'd diff fields", async () => {
    const rustOutput = {
      regression_score: 0.5,
      nodes_added: 3,
      nodes_removed: 1,
      edges_added: 8,
      edges_removed: 2,
      dangling_refs: ["src/removed.rs::gone_fn"],
      new_unresolved: [],
      new_cycles: [],
    };
    const client = makeMockClient(async () => makeEnvelope(rustOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    const result = await adapter.verifySemanticDiff({
      beforeGraphPath: "/before.db",
      afterGraphPath: "/after.db",
    });

    const [toolName, params] = vi.mocked(client.call).mock.calls[0] as [string, Record<string, unknown>];
    expect(toolName).toBe("verify_semantic_diff");
    // camelCase → snake_case on input
    expect(params["before_graph_path"]).toBe("/before.db");
    expect(params["after_graph_path"]).toBe("/after.db");
    expect(params["beforeGraphPath"]).toBeUndefined();
    // snake_case → camelCase on output
    expect(result.regressionScore).toBe(0.5);
    expect(result.nodesAdded).toBe(3);
    // dangling_refs → danglingRefs; the snake_case key must not appear
    expect(result.danglingRefs).toEqual(["src/removed.rs::gone_fn"]);
    expect(result.newUnresolved).toEqual([]);
    expect(result.newCycles).toEqual([]);
  });

  it("raises CodebaseValidationError when regressionScore is missing", async () => {
    const badOutput = { nodes_added: 0, nodes_removed: 0 };
    const client = makeMockClient(async () => makeEnvelope(badOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    await expect(
      adapter.verifySemanticDiff({
        beforeGraphPath: "/before.db",
        afterGraphPath: "/after.db",
      }),
    ).rejects.toThrowError(CodebaseValidationError);
  });
});
