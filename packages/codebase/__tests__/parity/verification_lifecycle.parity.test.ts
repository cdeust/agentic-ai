/**
 * Parity test: start_verification + append_clarification +
 *              finalize_verification + abort_verification
 *
 * Instrument: Rust binary ground truth vs TS adapter Zod validation.
 * Operational definition of parity: all required Zod schema fields present
 * in the camelCase-converted Rust output; adapter safeParse succeeds.
 *
 * Fixture: in-memory finding → extract → refine → then lifecycle tools.
 *
 * source: packages/codebase-rust/src/main.rs:1420-1442 — do_start_verification
 * source: packages/codebase-rust/src/main.rs:1530-1545 — do_append_clarification
 * source: packages/codebase-rust/src/main.rs:1690-1715 — do_finalize_verification
 * source: packages/codebase-rust/src/main.rs:1765-1782 — do_abort_verification
 * source: packages/core/src/ports/codebase-outputs.ts — *OutputSchema
 */

import { describe, it, expect, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  createCodebaseAdapter,
  resolveBinaryPath,
  StartVerificationOutputSchema,
  AppendClarificationOutputSchema,
  FinalizeVerificationOutputSchema,
  AbortVerificationOutputSchema,
} from "../../src/index.js";
import type { CodebasePort } from "@agentic/core";

// ── Binary resolution ─────────────────────────────────────────────────────────

function findBinaryPath(): string | null {
  const standard = resolveBinaryPath();
  if (standard !== null) return standard;
  const thisFileDir = new URL(".", import.meta.url).pathname;
  const repoRoot = join(thisFileDir, "../../../../");
  const fallback = join(
    repoRoot,
    "worktrees/port-codebase-rust/packages/codebase-rust/target/release/ai-architect-mcp",
  );
  if (existsSync(fallback)) return fallback;
  return null;
}

const BINARY_PATH = findBinaryPath();

// ── JSON-RPC helper ───────────────────────────────────────────────────────────

function callRust(
  binaryPath: string,
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> | null {
  const request = JSON.stringify({
    jsonrpc: "2.0", id: 999, method: "tools/call",
    params: { name: toolName, arguments: args },
  });
  const result = spawnSync(binaryPath, [], {
    input: request + "\n", encoding: "utf-8", timeout: 60_000,
  });
  if (result.status !== 0 || result.error) return null;
  try {
    const parsed = JSON.parse(result.stdout) as {
      result?: { content?: Array<{ text?: string }> };
    };
    const text = parsed.result?.content?.[0]?.text;
    if (text === undefined) return null;
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function deepToCamel(val: unknown): unknown {
  if (Array.isArray(val)) return val.map(deepToCamel);
  if (val !== null && typeof val === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      const camel = k.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
      result[camel] = deepToCamel(v);
    }
    return result;
  }
  return val;
}

// ── Fixture setup helper ──────────────────────────────────────────────────────

function setupFindingForVerification(
  binaryPath: string,
  outputDir: string,
  runId: string,
  findingId: string,
): void {
  const findingPath = join(outputDir, `${findingId}.json`);
  writeFileSync(findingPath, JSON.stringify({
    id: findingId,
    title: `Parity test: ${findingId}`,
    description: "Verification lifecycle parity test",
    relevance_score: 0.7,
    relevance_category: "security",
    source_url: "https://example.com",
  }));
  callRust(binaryPath, "extract_finding", {
    finding: findingPath, output_dir: outputDir, run_id: runId,
  });
  callRust(binaryPath, "refine_finding", {
    run_id: runId, finding_id: findingId, output_dir: outputDir,
    refined_prompt: { text: "Analyze this finding", role_hint: "analyst" },
    refinement: {
      added_context: [{ kind: "context", content: "ctx" }],
      orchestrator_version: "1.0.0",
    },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("parity: start_verification + append_clarification + finalize_verification + abort_verification", () => {
  if (BINARY_PATH === null) {
    it.todo("requires Rust binary");
    return;
  }

  let adapter: CodebasePort | null = null;
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const d = mkdtempSync(join(tmpdir(), "parity-verif-"));
    tempDirs.push(d);
    return d;
  }

  afterAll(async () => {
    if (adapter !== null) await adapter.dispose();
    for (const d of tempDirs) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });

  // ── start_verification ─────────────────────────────────────────────────────

  it("start_verification: Rust returns state=open with runId and findingId", () => {
    const outputDir = makeTempDir();
    setupFindingForVerification(BINARY_PATH, outputDir, "startrun001", "sv-finding-001");

    const rustRaw = callRust(BINARY_PATH, "start_verification", {
      run_id: "startrun001", finding_id: "sv-finding-001", output_dir: outputDir,
    });
    // source: packages/codebase-rust/src/main.rs:1433-1441
    expect(rustRaw).not.toBeNull();
    expect(rustRaw!["status"]).toBe("ok");
    expect(rustRaw!["state"]).toBe("open");
    expect(rustRaw!["run_id"]).toBe("startrun001");
    expect(rustRaw!["finding_id"]).toBe("sv-finding-001");
    expect(rustRaw!["stage"]).toBe(2);
  });

  it("start_verification: Zod schema validates camelCase Rust output", () => {
    const outputDir = makeTempDir();
    setupFindingForVerification(BINARY_PATH, outputDir, "startrun002", "sv-finding-002");

    const rustRaw = callRust(BINARY_PATH, "start_verification", {
      run_id: "startrun002", finding_id: "sv-finding-002", output_dir: outputDir,
    });
    expect(rustRaw).not.toBeNull();

    const camelized = deepToCamel(rustRaw) as Record<string, unknown>;
    // source: packages/core/src/ports/codebase-outputs.ts — StartVerificationOutputSchema
    const parseResult = StartVerificationOutputSchema.safeParse(camelized);
    expect(parseResult.success, `Schema validation failed: ${JSON.stringify(parseResult)}`).toBe(true);
    if (parseResult.success) {
      expect(parseResult.data.status).toBe("ok");
      expect(parseResult.data.runId).toBe("startrun002");
      expect(parseResult.data.findingId).toBe("sv-finding-002");
    }
  });

  // ── append_clarification ───────────────────────────────────────────────────

  it("append_clarification: Rust returns seq/state/turnCount without runId/findingId (SCHEMA FIX)", () => {
    const outputDir = makeTempDir();
    setupFindingForVerification(BINARY_PATH, outputDir, "appendrun001", "ac-finding-001");
    callRust(BINARY_PATH, "start_verification", {
      run_id: "appendrun001", finding_id: "ac-finding-001", output_dir: outputDir,
    });

    const rustRaw = callRust(BINARY_PATH, "append_clarification", {
      run_id: "appendrun001", finding_id: "ac-finding-001",
      output_dir: outputDir, kind: "agent_question",
      content: "Does this affect production?",
    });
    // source: packages/codebase-rust/src/main.rs:1538-1544 — do_append_clarification
    // Rust does NOT echo back run_id or finding_id. This is a known semantic choice:
    // the response conveys the resulting state, not the request context.
    expect(rustRaw).not.toBeNull();
    expect(rustRaw!["status"]).toBe("ok");
    expect(rustRaw!["state"]).toBe("waiting_for_user");
    expect(rustRaw!["seq"]).toBe(0);
    expect(rustRaw!["turn_count"]).toBe(1);
    // Confirm absence — this is the documented divergence the schema fix corrects
    expect(rustRaw!["run_id"]).toBeUndefined();
    expect(rustRaw!["finding_id"]).toBeUndefined();
  });

  it("append_clarification: Zod schema (post-fix) validates Rust output without runId/findingId", () => {
    const outputDir = makeTempDir();
    setupFindingForVerification(BINARY_PATH, outputDir, "appendrun002", "ac-finding-002");
    callRust(BINARY_PATH, "start_verification", {
      run_id: "appendrun002", finding_id: "ac-finding-002", output_dir: outputDir,
    });

    const rustRaw = callRust(BINARY_PATH, "append_clarification", {
      run_id: "appendrun002", finding_id: "ac-finding-002",
      output_dir: outputDir, kind: "agent_question", content: "Test question?",
    });
    expect(rustRaw).not.toBeNull();

    const camelized = deepToCamel(rustRaw) as Record<string, unknown>;
    // source: packages/core/src/ports/codebase-outputs.ts — AppendClarificationOutputSchema
    // Fixed schema: no longer requires runId/findingId (they are not in Rust response)
    const parseResult = AppendClarificationOutputSchema.safeParse(camelized);
    expect(parseResult.success, `Schema validation failed: ${JSON.stringify(parseResult)}`).toBe(true);
    if (parseResult.success) {
      expect(parseResult.data.status).toBe("ok");
      expect(parseResult.data.state).toBe("waiting_for_user");
      expect(parseResult.data.seq).toBe(0);
      expect(parseResult.data.turnCount).toBe(1);
    }
  });

  // ── finalize_verification ─────────────────────────────────────────────────

  it("finalize_verification: Rust returns verified/transcriptDigest (not sha256/artifact)", () => {
    const outputDir = makeTempDir();
    setupFindingForVerification(BINARY_PATH, outputDir, "finalrun001", "fv-finding-001");
    callRust(BINARY_PATH, "start_verification", {
      run_id: "finalrun001", finding_id: "fv-finding-001", output_dir: outputDir,
    });
    callRust(BINARY_PATH, "append_clarification", {
      run_id: "finalrun001", finding_id: "fv-finding-001",
      output_dir: outputDir, kind: "agent_question", content: "Question?",
    });
    callRust(BINARY_PATH, "append_clarification", {
      run_id: "finalrun001", finding_id: "fv-finding-001",
      output_dir: outputDir, kind: "user_answer", content: "Answer.",
    });

    const rustRaw = callRust(BINARY_PATH, "finalize_verification", {
      run_id: "finalrun001", finding_id: "fv-finding-001", output_dir: outputDir,
    });
    // source: packages/codebase-rust/src/main.rs:1697-1714 — do_finalize_verification
    // Rust does NOT return runId, findingId, sha256, or artifact.
    expect(rustRaw).not.toBeNull();
    expect(rustRaw!["status"]).toBe("ok");
    expect(rustRaw!["state"]).toBe("finalized");
    expect(rustRaw!["verified"]).toBe(true);
    expect(typeof rustRaw!["transcript_digest"]).toBe("string");
    expect(typeof rustRaw!["verified_path"]).toBe("string");
    // Confirm absent fields that old schema incorrectly required
    expect(rustRaw!["run_id"]).toBeUndefined();
    expect(rustRaw!["finding_id"]).toBeUndefined();
    expect(rustRaw!["sha256"]).toBeUndefined();
    expect(rustRaw!["artifact"]).toBeUndefined();
  });

  it("finalize_verification: Zod schema (post-fix) validates Rust output", () => {
    const outputDir = makeTempDir();
    setupFindingForVerification(BINARY_PATH, outputDir, "finalrun002", "fv-finding-002");
    callRust(BINARY_PATH, "start_verification", {
      run_id: "finalrun002", finding_id: "fv-finding-002", output_dir: outputDir,
    });
    callRust(BINARY_PATH, "append_clarification", {
      run_id: "finalrun002", finding_id: "fv-finding-002",
      output_dir: outputDir, kind: "agent_question", content: "Q?",
    });
    callRust(BINARY_PATH, "append_clarification", {
      run_id: "finalrun002", finding_id: "fv-finding-002",
      output_dir: outputDir, kind: "user_answer", content: "A.",
    });

    const rustRaw = callRust(BINARY_PATH, "finalize_verification", {
      run_id: "finalrun002", finding_id: "fv-finding-002", output_dir: outputDir,
    });
    expect(rustRaw).not.toBeNull();

    const camelized = deepToCamel(rustRaw) as Record<string, unknown>;
    // source: packages/core/src/ports/codebase-outputs.ts — FinalizeVerificationOutputSchema
    const parseResult = FinalizeVerificationOutputSchema.safeParse(camelized);
    expect(parseResult.success, `Schema validation failed: ${JSON.stringify(parseResult)}`).toBe(true);
    if (parseResult.success) {
      expect(parseResult.data.status).toBe("ok");
      expect(parseResult.data.verified).toBe(true);
      expect(typeof parseResult.data.transcriptDigest).toBe("string");
    }
  });

  // ── abort_verification ─────────────────────────────────────────────────────

  it("abort_verification: Rust returns runId/findingId/abortedAt/state=aborted", () => {
    const outputDir = makeTempDir();
    setupFindingForVerification(BINARY_PATH, outputDir, "abortrun001", "av-finding-001");
    callRust(BINARY_PATH, "start_verification", {
      run_id: "abortrun001", finding_id: "av-finding-001", output_dir: outputDir,
    });

    const rustRaw = callRust(BINARY_PATH, "abort_verification", {
      run_id: "abortrun001", finding_id: "av-finding-001",
      output_dir: outputDir, reason: "parity test abort",
    });
    // source: packages/codebase-rust/src/main.rs:1773-1781 — do_abort_verification
    expect(rustRaw).not.toBeNull();
    expect(rustRaw!["status"]).toBe("ok");
    expect(rustRaw!["state"]).toBe("aborted");
    expect(rustRaw!["run_id"]).toBe("abortrun001");
    expect(rustRaw!["finding_id"]).toBe("av-finding-001");
    expect(typeof rustRaw!["aborted_at"]).toBe("string");
  });

  it("abort_verification: Zod schema validates camelCase Rust output", () => {
    const outputDir = makeTempDir();
    setupFindingForVerification(BINARY_PATH, outputDir, "abortrun002", "av-finding-002");
    callRust(BINARY_PATH, "start_verification", {
      run_id: "abortrun002", finding_id: "av-finding-002", output_dir: outputDir,
    });

    const rustRaw = callRust(BINARY_PATH, "abort_verification", {
      run_id: "abortrun002", finding_id: "av-finding-002", output_dir: outputDir,
    });
    expect(rustRaw).not.toBeNull();

    const camelized = deepToCamel(rustRaw) as Record<string, unknown>;
    // source: packages/core/src/ports/codebase-outputs.ts — AbortVerificationOutputSchema
    const parseResult = AbortVerificationOutputSchema.safeParse(camelized);
    expect(parseResult.success, `Schema validation failed: ${JSON.stringify(parseResult)}`).toBe(true);
    if (parseResult.success) {
      expect(parseResult.data.status).toBe("ok");
      expect(parseResult.data.runId).toBe("abortrun002");
      expect(parseResult.data.findingId).toBe("av-finding-002");
      expect(typeof parseResult.data.abortedAt).toBe("string");
    }
  });

  // ── TS adapter full lifecycle ─────────────────────────────────────────────

  it("TS adapter: full lifecycle start→append→finalize validates against all schemas", async () => {
    const outputDir = makeTempDir();
    const findingId = "ts-lifecycle-001";
    const runId = "tslifecycle001";

    const findingPath = join(outputDir, `${findingId}.json`);
    writeFileSync(findingPath, JSON.stringify({
      id: findingId, title: "TS lifecycle test", description: "Full lifecycle parity",
      relevance_score: 0.8, relevance_category: "security", source_url: "https://example.com",
    }));

    adapter = await createCodebaseAdapter({ binaryPath: BINARY_PATH });

    await adapter.extractFinding({ finding: findingPath, outputDir, runId });
    await adapter.refineFinding({
      runId, findingId, outputDir,
      refinedPrompt: { text: "Full lifecycle test", roleHint: "analyst" },
      refinement: {
        addedContext: [{ kind: "context", content: "ctx" }],
        orchestratorVersion: "1.0.0",
      },
    });

    const startResult = await adapter.startVerification({ runId, findingId, outputDir });
    expect(startResult.status).toBe("ok");
    expect(startResult.runId).toBe(runId);

    const appendResult = await adapter.appendClarification({
      runId, findingId, outputDir, kind: "agent_question", content: "Is this in prod?",
    });
    expect(appendResult.status).toBe("ok");
    // source: packages/codebase-rust/src/main.rs:1538 — seq is 0-indexed turn index
    expect(appendResult.seq).toBe(0);

    const answerResult = await adapter.appendClarification({
      runId, findingId, outputDir, kind: "user_answer", content: "Yes.",
    });
    expect(answerResult.status).toBe("ok");
    expect(answerResult.state).toBe("waiting_for_agent");

    const finalResult = await adapter.finalizeVerification({ runId, findingId, outputDir });
    expect(finalResult.status).toBe("ok");
    expect(finalResult.verified).toBe(true);
    expect(typeof finalResult.transcriptDigest).toBe("string");
  });
});
