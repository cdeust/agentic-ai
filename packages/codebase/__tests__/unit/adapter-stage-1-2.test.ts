/**
 * Unit tests for Stage 1 and Stage 2 MCP tools in RustPipelineAdapter.
 *
 * Covers: extractFinding, refineFinding (Stage 1a/1b) and
 *         startVerification, appendClarification, finalizeVerification,
 *         abortVerification (Stage 2a–2d).
 *
 * Contract under test:
 *   - Each method forwards the correct tool name to the JsonRpcClient.
 *   - camelCase TS inputs are translated to snake_case before forwarding.
 *   - snake_case Rust outputs are translated to camelCase before returning.
 *     Specifically: run_id → runId, finding_id → findingId,
 *     aborted_at → abortedAt, turn_index → turnIndex.
 *   - Zod output validation is applied; missing required fields raise
 *     CodebaseValidationError (schema drift is not silently accepted).
 *
 * source: docs/ADR/0003 — preconditions are syntactic only
 * source: packages/codebase-rust/src/tool_schemas.rs:52-208 (commit 2cc3780)
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

// ── Stage 1a: extract_finding ─────────────────────────────────────────────────

describe("extractFinding (Stage 1a)", () => {
  // postcondition: tool name is "extract_finding"; deepToCamel translates
  // run_id → runId, finding_id → findingId
  // source: tool_schemas.rs:52-80
  it("happy path — forwards tool name and returns camelCase output", async () => {
    // source: packages/codebase-rust/src/main.rs:886-894 — do_extract_finding
    // stage is a NUMBER (integer 1), not a string like "extracted"
    const rustOutput = {
      status: "ok",
      run_id: "20260506-120000-abc123",
      finding_id: "f-001",
      stage: 1,
      artifact_path: "/out/runs/20260506-120000-abc123/findings/f-001/stage-1.extracted.json",
      bytes_written: 417,
      extractor_version: "1.0.0",
    };
    const client = makeMockClient(async () => makeEnvelope(rustOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    const result = await adapter.extractFinding({
      finding: { title: "SQL injection", severity: "critical" },
      outputDir: "/out",
    });

    const [toolName] = vi.mocked(client.call).mock.calls[0] as [string, Record<string, unknown>];
    expect(toolName).toBe("extract_finding");
    expect(result.status).toBe("ok");
    // deepToCamel: run_id → runId, finding_id → findingId
    expect(result.runId).toBe("20260506-120000-abc123");
    expect(result.findingId).toBe("f-001");
    // stage is integer 1
    expect(result.stage).toBe(1);
  });

  // postcondition: missing required "status" field raises CodebaseValidationError
  it("raises CodebaseValidationError when output is missing required status field", async () => {
    const badOutput = {
      run_id: "r-001",
      finding_id: "f-001",
      // Missing: status (required by ExtractFindingOutputSchema)
    };
    const client = makeMockClient(async () => makeEnvelope(badOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    await expect(
      adapter.extractFinding({
        finding: { title: "XSS", severity: "high" },
        outputDir: "/out",
      }),
    ).rejects.toThrowError(CodebaseValidationError);
  });
});

// ── Stage 1b: refine_finding ──────────────────────────────────────────────────

describe("refineFinding (Stage 1b)", () => {
  // postcondition: snake_case inputs forwarded; output camelCase'd
  // source: tool_schemas.rs:82-136
  it("happy path — translates camelCase input and returns output", async () => {
    const rustOutput = {
      status: "ok",
      run_id: "r-001",
      finding_id: "f-001",
      artifact: "/out/runs/r-001/findings/f-001/stage-1.refined.json",
    };
    const client = makeMockClient(async () => makeEnvelope(rustOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    const result = await adapter.refineFinding({
      runId: "r-001",
      findingId: "f-001",
      outputDir: "/out",
      refinedPrompt: { text: "Explain the SQL injection vector", roleHint: "security-analyst" },
      refinement: {
        addedContext: [{ kind: "code", content: "SELECT * FROM users WHERE id = $input" }],
        orchestratorVersion: "1.0.0",
      },
    });

    const [toolName, params] = vi.mocked(client.call).mock.calls[0] as [string, Record<string, unknown>];
    expect(toolName).toBe("refine_finding");
    // camelCase fields translated to snake_case before forwarding
    expect(params["run_id"]).toBe("r-001");
    expect(params["finding_id"]).toBe("f-001");
    expect(params["output_dir"]).toBe("/out");
    // original camelCase must not appear in Rust params
    expect(params["runId"]).toBeUndefined();
    // deepToCamel: run_id → runId
    expect(result.runId).toBe("r-001");
  });

  // postcondition: missing required "status" raises CodebaseValidationError
  it("raises CodebaseValidationError on missing status field", async () => {
    const badOutput = { run_id: "r-001", finding_id: "f-001" };
    const client = makeMockClient(async () => makeEnvelope(badOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    await expect(
      adapter.refineFinding({
        runId: "r-001",
        findingId: "f-001",
        outputDir: "/out",
        refinedPrompt: { text: "prompt", roleHint: "analyst" },
        refinement: { addedContext: [], orchestratorVersion: "1.0.0" },
      }),
    ).rejects.toThrowError(CodebaseValidationError);
  });
});

// ── Stage 2a: start_verification ─────────────────────────────────────────────

describe("startVerification (Stage 2a)", () => {
  // postcondition: session field returned; tool name correct
  // source: tool_schemas.rs:138-153
  it("happy path — creates session and returns status", async () => {
    const rustOutput = {
      status: "ok",
      run_id: "r-001",
      finding_id: "f-001",
      session: { state: "open", created_at: "2026-05-06T00:00:00Z" },
    };
    const client = makeMockClient(async () => makeEnvelope(rustOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    const result = await adapter.startVerification({
      runId: "r-001",
      findingId: "f-001",
      outputDir: "/out",
    });

    const [toolName] = vi.mocked(client.call).mock.calls[0] as [string, Record<string, unknown>];
    expect(toolName).toBe("start_verification");
    expect(result.status).toBe("ok");
    // deepToCamel: run_id → runId
    expect(result.runId).toBe("r-001");
  });

  it("raises CodebaseValidationError on missing runId in output", async () => {
    const badOutput = { status: "ok", finding_id: "f-001" };
    const client = makeMockClient(async () => makeEnvelope(badOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    await expect(
      adapter.startVerification({ runId: "r-001", findingId: "f-001", outputDir: "/out" }),
    ).rejects.toThrowError(CodebaseValidationError);
  });
});

// ── Stage 2b: append_clarification ───────────────────────────────────────────

describe("appendClarification (Stage 2b)", () => {
  // postcondition: alternation kind is forwarded; turn_index → turnIndex in output
  // source: tool_schemas.rs:155-173
  it("happy path — appends agent_question turn", async () => {
    const rustOutput = {
      status: "ok",
      run_id: "r-001",
      finding_id: "f-001",
      turn_index: 0,
    };
    const client = makeMockClient(async () => makeEnvelope(rustOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    const result = await adapter.appendClarification({
      runId: "r-001",
      findingId: "f-001",
      outputDir: "/out",
      kind: "agent_question",
      content: "Is the injection point validated at the API boundary?",
    });

    const [toolName, params] = vi.mocked(client.call).mock.calls[0] as [string, Record<string, unknown>];
    expect(toolName).toBe("append_clarification");
    expect(params["kind"]).toBe("agent_question");
    expect(result.status).toBe("ok");
    // deepToCamel: turn_index → turnIndex
    expect(result.turnIndex).toBe(0);
  });

  it("raises CodebaseValidationError on missing status field", async () => {
    const badOutput = { run_id: "r-001", finding_id: "f-001", turn_index: 0 };
    const client = makeMockClient(async () => makeEnvelope(badOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    await expect(
      adapter.appendClarification({
        runId: "r-001",
        findingId: "f-001",
        outputDir: "/out",
        kind: "user_answer",
        content: "Yes, validated.",
      }),
    ).rejects.toThrowError(CodebaseValidationError);
  });
});

// ── Stage 2c: finalize_verification ──────────────────────────────────────────

describe("finalizeVerification (Stage 2c)", () => {
  // source: packages/codebase-rust/src/main.rs:1697-1714 — do_finalize_verification
  // SCHEMA FIX: Rust returns verified/transcriptDigest/verifiedPath, NOT sha256/artifact/findingId.
  // runId and findingId are NOT echoed back in the finalize response.
  it("happy path — returns verified=true, transcriptDigest, verifiedPath (not sha256/artifact)", async () => {
    const rustOutput = {
      stage: 2,
      status: "ok",
      state: "finalized",
      verified: true,
      verified_kind: { schema_ok: true, completeness_ok: true, user_acknowledged: true },
      verified_path: "/out/runs/r-001/findings/f-001/stage-2.verified.json",
      turn_count: 2,
      transcript_digest: "ca1f9713e8e13b461306bd027cb49cd366fc23755761c1977b407ac74d28471d",
      digest_algorithm: "sha256",
      transcript_bytes_at_finalize: 218,
      bytes_written: 702,
      verifier_version: "1.0.0",
    };
    const client = makeMockClient(async () => makeEnvelope(rustOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    const result = await adapter.finalizeVerification({
      runId: "r-001",
      findingId: "f-001",
      outputDir: "/out",
    });

    const [toolName] = vi.mocked(client.call).mock.calls[0] as [string, Record<string, unknown>];
    expect(toolName).toBe("finalize_verification");
    expect(result.status).toBe("ok");
    expect(result.verified).toBe(true);
    expect(result.transcriptDigest).toHaveLength(64);
    expect(result.verifiedPath).toBeDefined();
    // runId/findingId are NOT present (Rust does not echo them back)
    expect((result as Record<string, unknown>)["runId"]).toBeUndefined();
    expect((result as Record<string, unknown>)["findingId"]).toBeUndefined();
  });

  it("raises CodebaseValidationError on missing status field in output", async () => {
    // source: FinalizeVerificationOutputSchema requires status (z.string())
    const badOutput = { state: "finalized", verified: true };
    const client = makeMockClient(async () => makeEnvelope(badOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    await expect(
      adapter.finalizeVerification({ runId: "r-001", findingId: "f-001", outputDir: "/out" }),
    ).rejects.toThrowError(CodebaseValidationError);
  });
});

// ── Stage 2d: abort_verification ─────────────────────────────────────────────

describe("abortVerification (Stage 2d)", () => {
  // postcondition: aborted_at → abortedAt in output; reason forwarded
  // source: tool_schemas.rs:192-208
  it("happy path — aborts session and returns abortedAt", async () => {
    const rustOutput = {
      status: "ok",
      run_id: "r-001",
      finding_id: "f-001",
      aborted_at: "2026-05-06T12:00:00Z",
    };
    const client = makeMockClient(async () => makeEnvelope(rustOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    const result = await adapter.abortVerification({
      runId: "r-001",
      findingId: "f-001",
      outputDir: "/out",
      reason: "Caller cancelled the session",
    });

    const [toolName, params] = vi.mocked(client.call).mock.calls[0] as [string, Record<string, unknown>];
    expect(toolName).toBe("abort_verification");
    expect(params["reason"]).toBe("Caller cancelled the session");
    expect(result.status).toBe("ok");
    // deepToCamel: aborted_at → abortedAt
    expect(result.abortedAt).toBe("2026-05-06T12:00:00Z");
  });

  it("raises CodebaseValidationError on missing runId in output", async () => {
    const badOutput = { status: "ok", finding_id: "f-001" };
    const client = makeMockClient(async () => makeEnvelope(badOutput));
    const adapter = new RustPipelineAdapter(makeMockSupervisor(), client);

    await expect(
      adapter.abortVerification({ runId: "r-001", findingId: "f-001", outputDir: "/out" }),
    ).rejects.toThrowError(CodebaseValidationError);
  });
});
