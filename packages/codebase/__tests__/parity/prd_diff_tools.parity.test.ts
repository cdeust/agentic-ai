/**
 * Parity test: prepare_prd_input + verify_semantic_diff + detect_changes
 *
 * Instrument: Rust binary ground truth vs TS adapter Zod validation.
 * Parity definition: all required Zod schema fields present; values match.
 *
 * source: packages/codebase-rust/src/main.rs:2837-2889 — do_prepare_prd_input
 * source: packages/codebase-rust/src/main.rs:2916-2970 — do_verify_semantic_diff
 * source: packages/codebase-rust/src/main.rs:2762-2805 — do_detect_changes
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
  PreparePrdInputOutputSchema,
  VerifySemanticDiffOutputSchema,
  DetectChangesOutputSchema,
} from "../../src/index.js";
import type { CodebasePort } from "@agentic/core";

// ── Binary + fixture ──────────────────────────────────────────────────────────

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
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname;
const FIXTURE_REPO = join(REPO_ROOT, "parity-oracle/codebase/fixture-repos/small-python");

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
    input: request + "\n", encoding: "utf-8", timeout: 120_000,
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("parity: prepare_prd_input + verify_semantic_diff + detect_changes", () => {
  if (BINARY_PATH === null) {
    it.todo("requires Rust binary");
    return;
  }
  if (!existsSync(FIXTURE_REPO)) {
    it.todo(`fixture not found at: ${FIXTURE_REPO}`);
    return;
  }

  let adapter: CodebasePort | null = null;
  const tempDirs: string[] = [];
  let graphPath: string | null = null;

  function makeTempDir(): string {
    const d = mkdtempSync(join(tmpdir(), "parity-prd-"));
    tempDirs.push(d);
    return d;
  }

  afterAll(async () => {
    if (adapter !== null) await adapter.dispose();
    for (const d of tempDirs) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });

  it("index + resolve + cluster fixture", () => {
    const outputDir = makeTempDir();
    const indexResult = callRust(BINARY_PATH, "index_codebase", {
      path: FIXTURE_REPO, language: "python", output_dir: outputDir,
    });
    expect(indexResult!["status"]).toBe("ok");
    graphPath = indexResult!["graph_path"] as string;
    callRust(BINARY_PATH, "resolve_graph", { graph_path: graphPath });
    callRust(BINARY_PATH, "cluster_graph", { graph_path: graphPath });
  });

  // ── detect_changes ─────────────────────────────────────────────────────────

  it("detect_changes: Rust returns symbolsAffected/communitiesAffected/processesAffected (not affectedCount/affected)", () => {
    if (graphPath === null) return;
    const rustRaw = callRust(BINARY_PATH, "detect_changes", {
      graph_path: graphPath,
      diff_text: "--- a/src/store.py\n+++ b/src/store.py\n@@ -1,3 +1,4 @@\n+import os\n class MemoryStore:",
    });
    // source: packages/codebase-rust/src/main.rs:2792-2804 — do_detect_changes
    expect(rustRaw).not.toBeNull();
    expect(rustRaw!["status"]).toBe("ok");
    // KEY ASSERTION: the actual Rust field names — NOT affectedCount/affected
    expect(typeof rustRaw!["symbols_affected_count"]).toBe("number");
    expect(typeof rustRaw!["communities_affected_count"]).toBe("number");
    expect(typeof rustRaw!["processes_affected_count"]).toBe("number");
    expect(Array.isArray(rustRaw!["symbols_affected"])).toBe(true);
    expect(Array.isArray(rustRaw!["communities_affected"])).toBe(true);
    expect(Array.isArray(rustRaw!["processes_affected"])).toBe(true);
    // risk_score is a string like "0.0000"
    expect(typeof rustRaw!["risk_score"]).toBe("string");
    // Old fields do NOT exist
    expect(rustRaw!["affected_count"]).toBeUndefined();
    expect(rustRaw!["affected"]).toBeUndefined();
  });

  it("detect_changes: Zod schema (post-fix) validates Rust output with correct key names", () => {
    if (graphPath === null) return;
    const rustRaw = callRust(BINARY_PATH, "detect_changes", {
      graph_path: graphPath,
      diff_text: "--- a/src/models.py\n+++ b/src/models.py\n@@ -1,3 +1,4 @@\n+# comment\n class Memory:",
    });
    expect(rustRaw).not.toBeNull();

    const camelized = deepToCamel(rustRaw) as Record<string, unknown>;
    // source: packages/core/src/ports/codebase-outputs.ts — DetectChangesOutputSchema (post-fix)
    // Fixed: symbolsAffected, symbolsAffectedCount, communitiesAffected, etc.
    // Old wrong schema had: affectedCount, affected
    const parseResult = DetectChangesOutputSchema.safeParse(camelized);
    expect(parseResult.success, `Schema validation failed: ${JSON.stringify(parseResult)}`).toBe(true);
    if (parseResult.success) {
      expect(parseResult.data.symbolsAffectedCount).toBeGreaterThanOrEqual(0);
      expect(parseResult.data.communitiesAffectedCount).toBeGreaterThanOrEqual(0);
      expect(parseResult.data.processesAffectedCount).toBeGreaterThanOrEqual(0);
      expect(typeof parseResult.data.riskScore).toBe("number"); // coerced from string
    }
  });

  it("detect_changes: TS adapter and Rust binary agree on symbolsAffectedCount", async () => {
    if (graphPath === null) return;
    adapter = await createCodebaseAdapter({ binaryPath: BINARY_PATH });

    const DIFF = "--- a/src/store.py\n+++ b/src/store.py\n@@ -1,3 +1,4 @@\n+import logging\n class MemoryStore:";

    const tsResult = await adapter.detectChanges({ graphPath, diffText: DIFF });
    const rustRaw = callRust(BINARY_PATH, "detect_changes", {
      graph_path: graphPath, diff_text: DIFF,
    });
    expect(rustRaw).not.toBeNull();

    expect(tsResult.symbolsAffectedCount).toBe(rustRaw!["symbols_affected_count"] as number);
    expect(tsResult.communitiesAffectedCount).toBe(rustRaw!["communities_affected_count"] as number);
    expect(tsResult.processesAffectedCount).toBe(rustRaw!["processes_affected_count"] as number);
  });

  // ── verify_semantic_diff ───────────────────────────────────────────────────

  it("verify_semantic_diff: Rust returns regressionScore (float), summary (object), verdict (string)", () => {
    if (graphPath === null) return;
    // Create a second graph for comparison
    const outputDir2 = makeTempDir();
    const indexResult2 = callRust(BINARY_PATH, "index_codebase", {
      path: FIXTURE_REPO, language: "python", output_dir: outputDir2,
    });
    const graphPath2 = indexResult2!["graph_path"] as string;

    const rustRaw = callRust(BINARY_PATH, "verify_semantic_diff", {
      before_graph_path: graphPath, after_graph_path: graphPath2,
    });
    // source: packages/codebase-rust/src/main.rs:2951-2969
    expect(rustRaw).not.toBeNull();
    expect(rustRaw!["status"]).toBe("ok");
    expect(typeof rustRaw!["regression_score"]).toBe("number"); // float (NOT string)
    expect(typeof rustRaw!["verdict"]).toBe("string");
    expect(typeof rustRaw!["summary"]).toBe("object");
    expect(rustRaw!["stage"]).toBe(9);
  });

  it("verify_semantic_diff: Zod schema validates camelCase Rust output", () => {
    if (graphPath === null) return;
    const outputDir2 = makeTempDir();
    const indexResult2 = callRust(BINARY_PATH, "index_codebase", {
      path: FIXTURE_REPO, language: "python", output_dir: outputDir2,
    });
    const graphPath2 = indexResult2!["graph_path"] as string;

    const rustRaw = callRust(BINARY_PATH, "verify_semantic_diff", {
      before_graph_path: graphPath, after_graph_path: graphPath2,
    });
    expect(rustRaw).not.toBeNull();

    const camelized = deepToCamel(rustRaw) as Record<string, unknown>;
    // source: packages/core/src/ports/codebase-outputs.ts — VerifySemanticDiffOutputSchema
    const parseResult = VerifySemanticDiffOutputSchema.safeParse(camelized);
    expect(parseResult.success, `Schema validation failed: ${JSON.stringify(parseResult)}`).toBe(true);
    if (parseResult.success) {
      expect(parseResult.data.regressionScore).toBeGreaterThanOrEqual(0);
    }
  });

  it("verify_semantic_diff: TS adapter and Rust binary agree on regressionScore", async () => {
    if (graphPath === null) return;
    if (adapter === null) {
      adapter = await createCodebaseAdapter({ binaryPath: BINARY_PATH });
    }

    const outputDir2 = makeTempDir();
    const indexResult2 = callRust(BINARY_PATH, "index_codebase", {
      path: FIXTURE_REPO, language: "python", output_dir: outputDir2,
    });
    const graphPath2 = indexResult2!["graph_path"] as string;

    const tsResult = await adapter.verifySemanticDiff({
      beforeGraphPath: graphPath, afterGraphPath: graphPath2,
    });
    const rustRaw = callRust(BINARY_PATH, "verify_semantic_diff", {
      before_graph_path: graphPath, after_graph_path: graphPath2,
    });
    expect(rustRaw).not.toBeNull();

    expect(tsResult.regressionScore).toBe(rustRaw!["regression_score"] as number);
  });

  // ── prepare_prd_input ──────────────────────────────────────────────────────

  it("prepare_prd_input: Rust returns artifact_path, runId, findingId, matchedSymbolCount", () => {
    if (graphPath === null) return;

    // Build the prerequisite chain: extract → refine → start → append Q → append A → finalize
    const outputDir = makeTempDir();
    const findingId = "prd-finding-001";
    const runId = "prdrun001";
    const findingPath = join(outputDir, "finding.json");

    writeFileSync(findingPath, JSON.stringify({
      id: findingId, title: "PRD parity test",
      description: "Test for prepare_prd_input schema parity",
      relevance_score: 0.8, relevance_category: "security",
      source_url: "https://example.com",
    }));

    callRust(BINARY_PATH, "extract_finding", {
      finding: findingPath, output_dir: outputDir, run_id: runId,
    });
    callRust(BINARY_PATH, "refine_finding", {
      run_id: runId, finding_id: findingId, output_dir: outputDir,
      refined_prompt: { text: "Analyze this PRD finding", role_hint: "analyst" },
      refinement: {
        added_context: [{ kind: "context", content: "ctx" }],
        orchestrator_version: "1.0.0",
      },
    });
    callRust(BINARY_PATH, "start_verification", {
      run_id: runId, finding_id: findingId, output_dir: outputDir,
    });
    callRust(BINARY_PATH, "append_clarification", {
      run_id: runId, finding_id: findingId, output_dir: outputDir,
      kind: "agent_question", content: "Does this affect prod?",
    });
    callRust(BINARY_PATH, "append_clarification", {
      run_id: runId, finding_id: findingId, output_dir: outputDir,
      kind: "user_answer", content: "Yes.",
    });
    callRust(BINARY_PATH, "finalize_verification", {
      run_id: runId, finding_id: findingId, output_dir: outputDir,
    });

    const rustRaw = callRust(BINARY_PATH, "prepare_prd_input", {
      run_id: runId, finding_id: findingId,
      output_dir: outputDir, graph_path: graphPath,
    });
    // source: packages/codebase-rust/src/main.rs:2876-2888
    expect(rustRaw).not.toBeNull();
    expect(rustRaw!["status"]).toBe("ok");
    expect(rustRaw!["run_id"]).toBe(runId);
    expect(rustRaw!["finding_id"]).toBe(findingId);
    expect(typeof rustRaw!["artifact_path"]).toBe("string");
    expect(typeof rustRaw!["matched_symbol_count"]).toBe("number");
    expect(rustRaw!["stage"]).toBe(4);
  });

  it("prepare_prd_input: Zod schema validates camelCase Rust output", () => {
    if (graphPath === null) return;
    const outputDir = makeTempDir();
    const findingId = "prd-finding-002";
    const runId = "prdrun002";
    const findingPath = join(outputDir, "finding.json");

    writeFileSync(findingPath, JSON.stringify({
      id: findingId, title: "PRD Zod test",
      description: "Zod schema validation for prepare_prd_input",
      relevance_score: 0.7, relevance_category: "performance",
      source_url: "https://example.com",
    }));

    callRust(BINARY_PATH, "extract_finding", {
      finding: findingPath, output_dir: outputDir, run_id: runId,
    });
    callRust(BINARY_PATH, "refine_finding", {
      run_id: runId, finding_id: findingId, output_dir: outputDir,
      refined_prompt: { text: "Refine this finding", role_hint: "analyst" },
      refinement: {
        added_context: [{ kind: "context", content: "ctx" }],
        orchestrator_version: "1.0.0",
      },
    });
    callRust(BINARY_PATH, "start_verification", {
      run_id: runId, finding_id: findingId, output_dir: outputDir,
    });
    callRust(BINARY_PATH, "append_clarification", {
      run_id: runId, finding_id: findingId, output_dir: outputDir,
      kind: "agent_question", content: "Q?",
    });
    callRust(BINARY_PATH, "append_clarification", {
      run_id: runId, finding_id: findingId, output_dir: outputDir,
      kind: "user_answer", content: "A.",
    });
    callRust(BINARY_PATH, "finalize_verification", {
      run_id: runId, finding_id: findingId, output_dir: outputDir,
    });

    const rustRaw = callRust(BINARY_PATH, "prepare_prd_input", {
      run_id: runId, finding_id: findingId,
      output_dir: outputDir, graph_path: graphPath,
    });
    expect(rustRaw).not.toBeNull();

    const camelized = deepToCamel(rustRaw) as Record<string, unknown>;
    // source: packages/core/src/ports/codebase-outputs.ts — PreparePrdInputOutputSchema
    const parseResult = PreparePrdInputOutputSchema.safeParse(camelized);
    expect(parseResult.success, `Schema validation failed: ${JSON.stringify(parseResult)}`).toBe(true);
    if (parseResult.success) {
      expect(parseResult.data.status).toBe("ok");
      expect(parseResult.data.runId).toBe(runId);
      expect(parseResult.data.findingId).toBe(findingId);
    }
  });
});
