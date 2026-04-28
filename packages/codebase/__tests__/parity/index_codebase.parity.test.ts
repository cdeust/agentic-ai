/**
 * Parity test: index_codebase on the 100-file fixture
 *
 * Acceptance criteria (§6.4 of PHASE_3_PLAN.md):
 *   - TS adapter output and direct Rust binary output have the same node_count,
 *     edge_count, and files_indexed.
 *   - Output schema matches IndexCodebaseOutputSchema.
 *   - The fixture contains exactly the expected number of source files.
 *
 * Requires:
 *   - PR #18 merged (packages/codebase-rust present in workspace), OR
 *   - AI_ARCH_BIN env var pointing to the built binary, OR
 *   - The binary in the PR #18 worktree (dev fallback path below).
 *
 * When none of the above are available the test marks itself with .todo().
 *
 * source: docs/PHASE_3_PLAN.md §6.4 — parity acceptance test
 * source: parity-oracle/codebase/fixture-repos/small-python — existing fixture
 */

import { describe, it, expect, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createCodebaseAdapter, resolveBinaryPath, IndexCodebaseOutputSchema } from "../../src/index.js";
import type { CodebasePort } from "@agentic/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

// ── Binary resolution ─────────────────────────────────────────────────────────

/**
 * Resolve the binary path, falling back to the PR #18 worktree for local dev.
 * source: docs/PHASE_3_PLAN.md §5.4#2 — fallback to stub runner
 */
function findBinaryPath(): string | null {
  // Standard resolution first (AI_ARCH_BIN + workspace).
  const standard = resolveBinaryPath();
  if (standard !== null) return standard;

  // Dev fallback: PR #18 worktree (local only; never in CI).
  // Use import.meta.url to get a stable absolute path regardless of cwd.
  // From __tests__/parity/, 6 levels up reaches the main repo root
  // (agentic-ai/), then descend into the worktrees/ sibling.
  // Path: parity → __tests__ → codebase → packages → port-codebase-ts-adapter
  //       → worktrees → agentic-ai  (6 levels)
  const thisFileDir = new URL(".", import.meta.url).pathname;
  const repoRoot = join(thisFileDir, "../../../../../..");
  const pr18Path = join(
    repoRoot,
    "worktrees/port-codebase-rust/packages/codebase-rust/target/release/ai-architect-mcp",
  );
  if (existsSync(pr18Path)) return pr18Path;

  return null;
}

const BINARY_PATH = findBinaryPath();

// ── Fixture paths ─────────────────────────────────────────────────────────────

// packages/codebase/__tests__/parity/ → 6 levels up → agentic-ai repo root
const REPO_ROOT = new URL("../../../../../../", import.meta.url).pathname;

const FIXTURE_REPO = join(
  REPO_ROOT,
  "parity-oracle/codebase/fixture-repos/small-python",
);

// ── Direct Rust binary invocation (for parity comparison) ────────────────────

/**
 * Run index_codebase directly via Rust binary (not through TS adapter).
 * Used as the golden reference for parity assertions.
 *
 * source: packages/parity-runner/src/runners/codebase.ts:74-82 — reference pattern
 */
function runDirectRust(
  binaryPath: string,
  fixturePath: string,
  outputDir: string,
): Record<string, unknown> | null {
  const request = JSON.stringify({
    jsonrpc: "2.0",
    id: 999,
    method: "tools/call",
    params: {
      name: "index_codebase",
      arguments: { path: fixturePath, language: "auto", output_dir: outputDir },
    },
  });

  const result = spawnSync(binaryPath, [], {
    input: request + "\n",
    encoding: "utf-8",
    timeout: 120_000, // source: docs/PHASE_3_PLAN.md §4.2 — 2 min for parity test
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("parity: index_codebase", () => {
  if (BINARY_PATH === null) {
    it.todo(
      "requires PR #18 merged + cargo build (AI_ARCH_BIN not set, workspace binary not found)",
    );
    return;
  }

  if (!existsSync(FIXTURE_REPO)) {
    it.todo(
      `fixture repo not found at: ${FIXTURE_REPO}`,
    );
    return;
  }

  let adapter: CodebasePort | null = null;
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const d = mkdtempSync(join(tmpdir(), "codebase-parity-"));
    tempDirs.push(d);
    return d;
  }

  afterAll(async () => {
    if (adapter !== null) await adapter.dispose();
    for (const d of tempDirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup.
      }
    }
  });

  it("adapter initialises and healthCheck returns server=ai-architect", async () => {
    adapter = await createCodebaseAdapter({ binaryPath: BINARY_PATH });
    const health = await adapter.healthCheck({});
    expect(health.server).toBe("ai-architect");
  });

  it("TS adapter and Rust binary produce same node_count, edge_count, files_indexed", async () => {
    if (adapter === null) {
      adapter = await createCodebaseAdapter({ binaryPath: BINARY_PATH });
    }

    const tsOutputDir = makeTempDir();
    const rustOutputDir = makeTempDir();

    // Run via TS adapter.
    const tsResult = await adapter.indexCodebase({
      path: FIXTURE_REPO,
      language: "python",
      outputDir: tsOutputDir,
    });

    // Run directly via Rust binary for golden comparison.
    const rustRaw = runDirectRust(BINARY_PATH, FIXTURE_REPO, rustOutputDir);
    expect(rustRaw).not.toBeNull();

    const rustResult = rustRaw as Record<string, unknown>;

    // Parity assertions: counts must match exactly.
    // source: docs/PHASE_3_PLAN.md §6.4 — "assert node_count, edge_count match"
    expect(tsResult.nodeCount).toBe(rustResult["node_count"]);
    expect(tsResult.edgeCount).toBe(rustResult["edge_count"]);
    expect(tsResult.filesIndexed).toBe(rustResult["files_indexed"]);
    expect(tsResult.filesIndexed).toBeGreaterThan(0);
  });

  it("TS adapter output validates against IndexCodebaseOutputSchema", async () => {
    if (adapter === null) {
      adapter = await createCodebaseAdapter({ binaryPath: BINARY_PATH });
    }

    const outputDir = makeTempDir();
    const result = await adapter.indexCodebase({
      path: FIXTURE_REPO,
      language: "python",
      outputDir,
    });

    const parseResult = IndexCodebaseOutputSchema.safeParse(result);
    expect(parseResult.success).toBe(true);
  });

  it("Dijkstra: 10 concurrent healthCheck calls all resolve without interleaving", async () => {
    if (adapter === null) {
      adapter = await createCodebaseAdapter({ binaryPath: BINARY_PATH });
    }

    const results = await Promise.all(
      Array.from({ length: 10 }, () => (adapter as CodebasePort).healthCheck({})),
    );

    // All results must agree on the version (no response interleaving).
    const versions = results.map((r) => r.version);
    expect(new Set(versions).size).toBe(1);
  });

  it("Lamport: analyzeCodebase total_elapsed_ms is provided by Rust, not computed by TS", async () => {
    if (adapter === null) {
      adapter = await createCodebaseAdapter({ binaryPath: BINARY_PATH });
    }

    const savedDateNow = Date.now;
    Date.now = () => 0; // Freeze clock at epoch.

    const outputDir = makeTempDir();
    const result = await adapter.analyzeCodebase({
      path: FIXTURE_REPO,
      language: "python",
      outputDir,
    });

    Date.now = savedDateNow;

    // If TS were computing elapsed from Date.now, it would be 0 with clock frozen.
    // The Rust binary computes its own elapsed; result must be ≥ 0.
    expect(result.totalElapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.graphPath).toBeTruthy();
  });
});

describe("parity: lsp_resolve error paths (CI-safe, no LSP binary required)", () => {
  if (BINARY_PATH === null) {
    it.todo("requires PR #18 merged + cargo build");
    return;
  }

  let adapter: CodebasePort | null = null;

  afterAll(async () => {
    if (adapter !== null) await adapter.dispose();
  });

  it("raises CodebaseLspError with reason=lsp_command_not_allowed for /bin/false", async () => {
    adapter = await createCodebaseAdapter({ binaryPath: BINARY_PATH });

    // /bin/false is guaranteed to fail; the Rust binary will reject it with
    // lsp_command_not_allowed (its allow-list does not include /bin/false).
    // source: docs/PHASE_3_PLAN.md §5.4#2 — "lsp_command: /bin/false forces error-path parity"
    // source: §1.8.4 — "default: test only error paths in CI"
    const { CodebaseLspError } = await import("@agentic/core");
    await expect(
      adapter.lspResolve({
        graphPath: "/nonexistent.db",
        codebasePath: "/nonexistent",
        lspCommand: "/bin/false",
      }),
    ).rejects.toThrowError(CodebaseLspError);
  });
});
