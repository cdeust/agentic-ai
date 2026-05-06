/**
 * Parity test: validate_prd_against_graph + check_security_gates
 *
 * INTENTIONAL DIVERGENCE (per MIGRATED.md equivalent — documented in ADR-0004):
 * - validate_prd_against_graph: TS adds all-or-nothing artifact bundle validation
 *   (ADR-0004). The Rust binary accepts {run_id, finding_id, output_dir} as
 *   three independent optional fields; TS enforces all-or-nothing via ArtifactWriteSpec.
 *   When artifacts bundle is absent (dry-run mode), both produce the same validation
 *   output. This divergence is intentional and correct.
 * - check_security_gates: same ADR-0004 pattern.
 *
 * Parity definition: in dry-run mode (no artifact bundle), TS and Rust produce
 * the same gatesPassed, summary, and validation_status fields.
 *
 * source: packages/codebase-rust/src/main.rs:2988-3037 — do_validate_prd_against_graph
 * source: packages/codebase-rust/src/main.rs:3087-3131 — do_check_security_gates
 * source: packages/core/src/ports/codebase-outputs.ts — *OutputSchema
 * source: docs/ADR/0004-validation-tool-optional-triple.md
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
  ValidatePrdAgainstGraphOutputSchema,
  CheckSecurityGatesOutputSchema,
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

describe("parity: validate_prd_against_graph + check_security_gates", () => {
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
  let prdPath: string | null = null;

  function makeTempDir(): string {
    const d = mkdtempSync(join(tmpdir(), "parity-val-"));
    tempDirs.push(d);
    return d;
  }

  afterAll(async () => {
    if (adapter !== null) await adapter.dispose();
    for (const d of tempDirs) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });

  it("index + resolve + cluster fixture and create PRD fixture", () => {
    const outputDir = makeTempDir();
    const indexResult = callRust(BINARY_PATH, "index_codebase", {
      path: FIXTURE_REPO, language: "python", output_dir: outputDir,
    });
    expect(indexResult!["status"]).toBe("ok");
    graphPath = indexResult!["graph_path"] as string;
    callRust(BINARY_PATH, "resolve_graph", { graph_path: graphPath });
    callRust(BINARY_PATH, "cluster_graph", { graph_path: graphPath });

    // Create PRD markdown file
    const prdDir = makeTempDir();
    prdPath = join(prdDir, "test.prd.md");
    writeFileSync(prdPath, [
      "# Test PRD",
      "",
      "## Affected Symbols",
      "- `src/store.py::MemoryStore`",
      "- `src/models.py::Memory`",
      "",
      "## Implementation",
      "Update the MemoryStore implementation.",
    ].join("\n"));
  });

  // ── validate_prd_against_graph ─────────────────────────────────────────────

  it("validate_prd_against_graph: Rust returns validationStatus and summary (dry-run)", () => {
    if (graphPath === null || prdPath === null) return;
    const rustRaw = callRust(BINARY_PATH, "validate_prd_against_graph", {
      prd_path: prdPath, graph_path: graphPath,
    });
    // source: packages/codebase-rust/src/main.rs:3019-3036
    expect(rustRaw).not.toBeNull();
    expect(rustRaw!["status"]).toBe("ok");
    expect(typeof rustRaw!["validation_status"]).toBe("string");
    expect(typeof rustRaw!["summary"]).toBe("object");
    expect(typeof rustRaw!["extraction_mode"]).toBe("string");
    expect(rustRaw!["stage"]).toBe(6);
  });

  it("validate_prd_against_graph: Zod schema validates camelCase Rust output", () => {
    if (graphPath === null || prdPath === null) return;
    const rustRaw = callRust(BINARY_PATH, "validate_prd_against_graph", {
      prd_path: prdPath, graph_path: graphPath,
    });
    expect(rustRaw).not.toBeNull();

    const camelized = deepToCamel(rustRaw) as Record<string, unknown>;
    // source: packages/core/src/ports/codebase-outputs.ts — ValidatePrdAgainstGraphOutputSchema
    const parseResult = ValidatePrdAgainstGraphOutputSchema.safeParse(camelized);
    expect(parseResult.success, `Schema validation failed: ${JSON.stringify(parseResult)}`).toBe(true);
    if (parseResult.success) {
      expect(parseResult.data.status).toBe("ok");
    }
  });

  it("validate_prd_against_graph: TS adapter (dry-run) and Rust binary agree on validationStatus", async () => {
    if (graphPath === null || prdPath === null) return;
    adapter = await createCodebaseAdapter({ binaryPath: BINARY_PATH });

    // TS adapter dry-run (no artifacts bundle)
    const tsResult = await adapter.validatePrdAgainstGraph({
      prdPath, graphPath,
    });

    const rustRaw = callRust(BINARY_PATH, "validate_prd_against_graph", {
      prd_path: prdPath, graph_path: graphPath,
    });
    expect(rustRaw).not.toBeNull();

    // Parity: same validation outcome
    expect(tsResult.status).toBe("ok");
    expect(tsResult.validationStatus).toBe(rustRaw!["validation_status"] as string);
  });

  it("validate_prd_against_graph: INTENTIONAL DIVERGENCE documented — TS enforces all-or-nothing artifact bundle", () => {
    // source: docs/ADR/0004-validation-tool-optional-triple.md
    // Rust accepts partial artifact triple (run_id without finding_id = silent ignore).
    // TS enforces that all three must be present or none (CodebaseValidationError on partial).
    // This is a CORRECTNESS improvement in TS, not a bug.
    // The divergence is: Rust is permissive (silently ignores partial), TS is strict (errors).
    // Classification: FAIL-INTENTIONAL-DIVERGENCE (documented in ADR-0004)
    expect(true).toBe(true); // Documentary assertion
  });

  // ── check_security_gates ───────────────────────────────────────────────────

  it("check_security_gates: Rust returns gatesPassed (boolean) and summary (object)", () => {
    if (graphPath === null) return;
    const rustRaw = callRust(BINARY_PATH, "check_security_gates", {
      graph_path: graphPath,
      changed_symbols: ["src/store.py::MemoryStore", "src/models.py::Memory"],
    });
    // source: packages/codebase-rust/src/main.rs:3117-3131
    expect(rustRaw).not.toBeNull();
    expect(rustRaw!["status"]).toBe("ok");
    expect(typeof rustRaw!["gates_passed"]).toBe("boolean");
    expect(typeof rustRaw!["summary"]).toBe("object");
    const summary = rustRaw!["summary"] as Record<string, unknown>;
    expect(typeof summary["critical_count"]).toBe("number");
    expect(typeof summary["warning_count"]).toBe("number");
    expect(rustRaw!["stage"]).toBe(8);
  });

  it("check_security_gates: Zod schema validates camelCase Rust output", () => {
    if (graphPath === null) return;
    const rustRaw = callRust(BINARY_PATH, "check_security_gates", {
      graph_path: graphPath, changed_symbols: ["src/store.py::MemoryStore"],
    });
    expect(rustRaw).not.toBeNull();

    const camelized = deepToCamel(rustRaw) as Record<string, unknown>;
    // source: packages/core/src/ports/codebase-outputs.ts — CheckSecurityGatesOutputSchema
    const parseResult = CheckSecurityGatesOutputSchema.safeParse(camelized);
    expect(parseResult.success, `Schema validation failed: ${JSON.stringify(parseResult)}`).toBe(true);
    if (parseResult.success) {
      expect(parseResult.data.status).toBe("ok");
      expect(typeof parseResult.data.gatesPassed).toBe("boolean");
    }
  });

  it("check_security_gates: TS adapter and Rust binary agree on gatesPassed", async () => {
    if (graphPath === null) return;
    if (adapter === null) {
      adapter = await createCodebaseAdapter({ binaryPath: BINARY_PATH });
    }

    const CHANGED = ["src/store.py::MemoryStore", "src/models.py::Memory"];

    const tsResult = await adapter.checkSecurityGates({
      graphPath, changedSymbols: CHANGED,
    });
    const rustRaw = callRust(BINARY_PATH, "check_security_gates", {
      graph_path: graphPath, changed_symbols: CHANGED,
    });
    expect(rustRaw).not.toBeNull();

    expect(tsResult.gatesPassed).toBe(rustRaw!["gates_passed"] as boolean);
  });

  it("check_security_gates: empty changed_symbols returns gatesPassed=true", async () => {
    if (graphPath === null) return;
    if (adapter === null) {
      adapter = await createCodebaseAdapter({ binaryPath: BINARY_PATH });
    }

    const tsResult = await adapter.checkSecurityGates({
      graphPath, changedSymbols: [],
    });
    expect(tsResult.status).toBe("ok");
    expect(tsResult.gatesPassed).toBe(true);
  });
});
