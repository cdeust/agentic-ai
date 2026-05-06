/**
 * Parity test: extract_finding + refine_finding
 *
 * Instrument: Rust binary ground truth vs TS adapter Zod validation.
 * Operational definition of parity: all required Zod schema fields are present
 * in the camelCase-converted Rust output and the adapter's safeParse succeeds.
 *
 * Fixture: minimal inline finding object (no graph required).
 *
 * source: packages/codebase-rust/src/main.rs:862-895 — do_extract_finding
 * source: packages/codebase-rust/src/main.rs:1079-1089 — do_refine_finding
 * source: packages/core/src/ports/codebase-outputs.ts — ExtractFindingOutputSchema
 * source: packages/core/src/ports/codebase-outputs.ts — RefineFindingOutputSchema
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
  ExtractFindingOutputSchema,
  RefineFindingOutputSchema,
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
    jsonrpc: "2.0",
    id: 999,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  });
  const result = spawnSync(binaryPath, [], {
    input: request + "\n",
    encoding: "utf-8",
    timeout: 60_000,
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

describe("parity: extract_finding + refine_finding", () => {
  if (BINARY_PATH === null) {
    it.todo("requires Rust binary (AI_ARCH_BIN not set, workspace binary not found)");
    return;
  }

  let adapter: CodebasePort | null = null;
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const d = mkdtempSync(join(tmpdir(), "parity-stage1-"));
    tempDirs.push(d);
    return d;
  }

  afterAll(async () => {
    if (adapter !== null) await adapter.dispose();
    for (const d of tempDirs) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });

  // ── extract_finding ────────────────────────────────────────────────────────

  it("extract_finding: Rust binary returns status=ok with findingId and runId", () => {
    const outputDir = makeTempDir();
    const findingPath = join(outputDir, "finding.json");
    writeFileSync(findingPath, JSON.stringify({
      id: "parity-finding-ext-001",
      title: "Parity test finding",
      description: "Schema parity test for extract_finding",
      relevance_score: 0.7,
      relevance_category: "security",
      source_url: "https://example.com",
    }));

    const rustRaw = callRust(BINARY_PATH, "extract_finding", {
      finding: findingPath,
      output_dir: outputDir,
      run_id: "parityrun001",
    });
    // source: packages/codebase-rust/src/main.rs:886-894 — success response shape
    expect(rustRaw).not.toBeNull();
    expect(rustRaw!["status"]).toBe("ok");
    expect(rustRaw!["finding_id"]).toBe("parity-finding-ext-001");
    expect(rustRaw!["run_id"]).toBe("parityrun001");
    expect(rustRaw!["stage"]).toBe(1);
    expect(typeof rustRaw!["artifact_path"]).toBe("string");
  });

  it("extract_finding: Zod schema validates camelCase-converted Rust output", () => {
    const outputDir = makeTempDir();
    const findingPath = join(outputDir, "finding.json");
    writeFileSync(findingPath, JSON.stringify({
      id: "parity-finding-ext-002",
      title: "Schema validation test",
      description: "Testing ExtractFindingOutputSchema",
      relevance_score: 0.5,
      relevance_category: "performance",
      source_url: "https://example.com",
    }));

    const rustRaw = callRust(BINARY_PATH, "extract_finding", {
      finding: findingPath,
      output_dir: outputDir,
      run_id: "parityrun002",
    });
    expect(rustRaw).not.toBeNull();

    const camelized = deepToCamel(rustRaw) as Record<string, unknown>;
    // source: packages/core/src/ports/codebase-outputs.ts:238-245 — ExtractFindingOutputSchema
    const parseResult = ExtractFindingOutputSchema.safeParse(camelized);
    expect(parseResult.success, `Schema validation failed: ${JSON.stringify(parseResult)}`).toBe(true);
    if (parseResult.success) {
      expect(parseResult.data.status).toBe("ok");
      expect(parseResult.data.runId).toBe("parityrun002");
      expect(parseResult.data.findingId).toBe("parity-finding-ext-002");
    }
  });

  it("extract_finding: TS adapter and Rust binary agree on runId and findingId", async () => {
    const outputDir = makeTempDir();
    const adapterOutputDir = makeTempDir();
    const findingPath = join(outputDir, "finding.json");
    const findingData = {
      id: "parity-finding-ext-003",
      title: "Adapter parity test",
      description: "Comparing TS adapter vs Rust binary output",
      relevance_score: 0.6,
      relevance_category: "maintainability",
      source_url: "https://example.com",
    };
    writeFileSync(findingPath, JSON.stringify(findingData));

    adapter = await createCodebaseAdapter({ binaryPath: BINARY_PATH });

    // TS adapter call
    const tsResult = await adapter.extractFinding({
      finding: findingPath,
      outputDir: adapterOutputDir,
      runId: "parityrun003",
    });

    // Rust binary direct call (independent method)
    const rustOutputDir = makeTempDir();
    const rustRaw = callRust(BINARY_PATH, "extract_finding", {
      finding: findingPath,
      output_dir: rustOutputDir,
      run_id: "parityrun003",
    });
    expect(rustRaw).not.toBeNull();

    // Parity: structural shape
    expect(tsResult.status).toBe("ok");
    expect(tsResult.runId).toBe("parityrun003");
    expect(tsResult.findingId).toBe("parity-finding-ext-003");
    // Rust reference
    expect(rustRaw!["run_id"]).toBe("parityrun003");
    expect(rustRaw!["finding_id"]).toBe("parity-finding-ext-003");
    expect(rustRaw!["status"]).toBe("ok");
  });

  // ── refine_finding ─────────────────────────────────────────────────────────

  it("refine_finding: Rust binary returns status=ok with findingId and runId after extract", () => {
    const outputDir = makeTempDir();
    const findingPath = join(outputDir, "finding.json");
    writeFileSync(findingPath, JSON.stringify({
      id: "parity-finding-ref-001",
      title: "Refine test finding",
      description: "Testing refine_finding schema",
      relevance_score: 0.8,
      relevance_category: "security",
      source_url: "https://example.com",
    }));

    // Must extract first
    const extractResult = callRust(BINARY_PATH, "extract_finding", {
      finding: findingPath,
      output_dir: outputDir,
      run_id: "refinerun001",
    });
    expect(extractResult!["status"]).toBe("ok");

    const rustRaw = callRust(BINARY_PATH, "refine_finding", {
      run_id: "refinerun001",
      finding_id: "parity-finding-ref-001",
      output_dir: outputDir,
      refined_prompt: {
        text: "Analyze the security implications",
        role_hint: "security_analyst",
        token_estimate: 50,
      },
      refinement: {
        added_context: [
          { kind: "code_snippet", content: "def auth(): pass", provenance: "src/auth.py" },
        ],
        orchestrator_version: "1.0.0",
      },
    });
    // source: packages/codebase-rust/src/main.rs:1079-1089 — do_refine_finding
    expect(rustRaw).not.toBeNull();
    expect(rustRaw!["status"]).toBe("ok");
    expect(rustRaw!["finding_id"]).toBe("parity-finding-ref-001");
    expect(rustRaw!["run_id"]).toBe("refinerun001");
    expect(rustRaw!["stage"]).toBe(1);
    expect(typeof rustRaw!["artifact_path"]).toBe("string");
  });

  it("refine_finding: Zod schema validates camelCase-converted Rust output", () => {
    const outputDir = makeTempDir();
    const findingPath = join(outputDir, "finding.json");
    writeFileSync(findingPath, JSON.stringify({
      id: "parity-finding-ref-002",
      title: "Refine Zod test",
      description: "Testing RefineFindingOutputSchema",
      relevance_score: 0.9,
      relevance_category: "performance",
      source_url: "https://example.com",
    }));

    callRust(BINARY_PATH, "extract_finding", {
      finding: findingPath, output_dir: outputDir, run_id: "refinerun002",
    });

    const rustRaw = callRust(BINARY_PATH, "refine_finding", {
      run_id: "refinerun002",
      finding_id: "parity-finding-ref-002",
      output_dir: outputDir,
      refined_prompt: { text: "Analyze performance impact", role_hint: "perf" },
      refinement: {
        added_context: [{ kind: "context", content: "perf data" }],
        orchestrator_version: "1.0.0",
      },
    });
    expect(rustRaw).not.toBeNull();

    const camelized = deepToCamel(rustRaw) as Record<string, unknown>;
    // source: packages/core/src/ports/codebase-outputs.ts — RefineFindingOutputSchema
    const parseResult = RefineFindingOutputSchema.safeParse(camelized);
    expect(parseResult.success, `Schema validation failed: ${JSON.stringify(parseResult)}`).toBe(true);
    if (parseResult.success) {
      expect(parseResult.data.status).toBe("ok");
      expect(parseResult.data.runId).toBe("refinerun002");
      expect(parseResult.data.findingId).toBe("parity-finding-ref-002");
    }
  });
});
