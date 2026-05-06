/**
 * Parity test: resolve_graph + cluster_graph + get_context
 *
 * Instrument: Rust binary ground truth vs TS adapter Zod validation.
 * Parity definition: all required Zod schema fields present and correctly typed.
 *
 * Fixture: small-python codebase, indexed + resolved + clustered in sequence.
 *
 * source: packages/codebase-rust/src/main.rs:2162-2204 — run_resolve_graph
 * source: packages/codebase-rust/src/main.rs:2210-2263 — run_cluster_graph
 * source: packages/codebase-rust/src/main.rs:2422-2506 — run_get_context
 * source: packages/core/src/ports/codebase-outputs.ts — *OutputSchema
 */

import { describe, it, expect, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  createCodebaseAdapter,
  resolveBinaryPath,
  ResolveGraphOutputSchema,
  ClusterGraphOutputSchema,
  GetContextOutputSchema,
  NotFoundOutputSchema,
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

describe("parity: resolve_graph + cluster_graph + get_context", () => {
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
    const d = mkdtempSync(join(tmpdir(), "parity-gp-"));
    tempDirs.push(d);
    return d;
  }

  afterAll(async () => {
    if (adapter !== null) await adapter.dispose();
    for (const d of tempDirs) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });

  it("index + resolve + cluster fixture for subsequent tests", () => {
    const outputDir = makeTempDir();
    const indexResult = callRust(BINARY_PATH, "index_codebase", {
      path: FIXTURE_REPO, language: "python", output_dir: outputDir,
    });
    expect(indexResult!["status"]).toBe("ok");
    graphPath = indexResult!["graph_path"] as string;

    callRust(BINARY_PATH, "resolve_graph", { graph_path: graphPath });
    callRust(BINARY_PATH, "cluster_graph", { graph_path: graphPath });
  });

  // ── resolve_graph ──────────────────────────────────────────────────────────

  it("resolve_graph: Rust binary returns resolution statistics", () => {
    if (graphPath === null) return;
    const outputDir = makeTempDir();
    const fresh = callRust(BINARY_PATH, "index_codebase", {
      path: FIXTURE_REPO, language: "python", output_dir: outputDir,
    });
    const freshGraph = fresh!["graph_path"] as string;

    const rustRaw = callRust(BINARY_PATH, "resolve_graph", { graph_path: freshGraph });
    // source: packages/codebase-rust/src/main.rs:2189-2203
    expect(rustRaw).not.toBeNull();
    expect(rustRaw!["status"]).toBe("ok");
    expect(typeof rustRaw!["total_edges"]).toBe("number");
    // resolution_rate is a STRING (e.g. "0.48")
    expect(typeof rustRaw!["resolution_rate"]).toBe("string");
    expect(rustRaw!["stage"]).toBe(3);
  });

  it("resolve_graph: Zod schema validates camelCase Rust output (z.coerce handles string rate)", () => {
    if (graphPath === null) return;
    const outputDir = makeTempDir();
    const fresh = callRust(BINARY_PATH, "index_codebase", {
      path: FIXTURE_REPO, language: "python", output_dir: outputDir,
    });
    const freshGraph = fresh!["graph_path"] as string;
    const rustRaw = callRust(BINARY_PATH, "resolve_graph", { graph_path: freshGraph });
    expect(rustRaw).not.toBeNull();

    const camelized = deepToCamel(rustRaw) as Record<string, unknown>;
    // source: packages/core/src/ports/codebase-outputs.ts:93-107 — ResolveGraphOutputSchema
    // resolution_rate → resolutionRate coerced from string via z.coerce.number()
    const parseResult = ResolveGraphOutputSchema.safeParse(camelized);
    expect(parseResult.success, `Schema validation failed: ${JSON.stringify(parseResult)}`).toBe(true);
    if (parseResult.success) {
      expect(parseResult.data.totalEdges).toBeGreaterThanOrEqual(0);
      expect(parseResult.data.resolutionRate).toBeGreaterThanOrEqual(0);
    }
  });

  it("resolve_graph: TS adapter and Rust binary agree on totalEdges", async () => {
    if (graphPath === null) return;
    adapter = await createCodebaseAdapter({ binaryPath: BINARY_PATH });

    const outputDir = makeTempDir();
    // Create fresh graph for TS adapter
    const tsResult = await (async () => {
      const freshIndexed = callRust(BINARY_PATH, "index_codebase", {
        path: FIXTURE_REPO, language: "python", output_dir: outputDir,
      });
      const fg = freshIndexed!["graph_path"] as string;
      return adapter!.resolveGraph({ graphPath: fg });
    })();

    const outputDir2 = makeTempDir();
    const fresh2 = callRust(BINARY_PATH, "index_codebase", {
      path: FIXTURE_REPO, language: "python", output_dir: outputDir2,
    });
    const fg2 = fresh2!["graph_path"] as string;
    const rustRaw = callRust(BINARY_PATH, "resolve_graph", { graph_path: fg2 });
    expect(rustRaw).not.toBeNull();

    // Parity: both should produce the same total_edges for the same fixture
    expect(tsResult.totalEdges).toBe(rustRaw!["total_edges"] as number);
  });

  // ── cluster_graph ──────────────────────────────────────────────────────────
  // NOTE: cluster_graph is NOT idempotent — calling it twice on the same graph
  // returns an error. Each test that needs to call cluster_graph must use a
  // fresh graph (index + resolve, then cluster for the first time).

  it("cluster_graph: Rust binary returns communityCount, modularity (as string), processCount", () => {
    // Fresh graph — cluster_graph is not idempotent (cannot call on already-clustered graph)
    const outputDir = makeTempDir();
    const freshIdx = callRust(BINARY_PATH, "index_codebase", {
      path: FIXTURE_REPO, language: "python", output_dir: outputDir,
    });
    const fg = freshIdx!["graph_path"] as string;
    callRust(BINARY_PATH, "resolve_graph", { graph_path: fg });

    const rustRaw = callRust(BINARY_PATH, "cluster_graph", { graph_path: fg });
    // source: packages/codebase-rust/src/main.rs:2249-2263
    expect(rustRaw).not.toBeNull();
    expect(rustRaw!["status"]).toBe("ok");
    expect(typeof rustRaw!["community_count"]).toBe("number");
    // modularity is a STRING like "0.854890"
    expect(typeof rustRaw!["modularity"]).toBe("string");
    expect(typeof rustRaw!["process_count"]).toBe("number");
    expect(Array.isArray(rustRaw!["clusters"])).toBe(true);
  });

  it("cluster_graph: Zod schema validates (z.coerce handles string modularity)", () => {
    // Fresh graph for this test
    const outputDir = makeTempDir();
    const freshIdx = callRust(BINARY_PATH, "index_codebase", {
      path: FIXTURE_REPO, language: "python", output_dir: outputDir,
    });
    const fg = freshIdx!["graph_path"] as string;
    callRust(BINARY_PATH, "resolve_graph", { graph_path: fg });

    const rustRaw = callRust(BINARY_PATH, "cluster_graph", { graph_path: fg });
    expect(rustRaw).not.toBeNull();

    const camelized = deepToCamel(rustRaw) as Record<string, unknown>;
    // source: packages/core/src/ports/codebase-outputs.ts:110-123
    const parseResult = ClusterGraphOutputSchema.safeParse(camelized);
    expect(parseResult.success, `Schema validation failed: ${JSON.stringify(parseResult)}`).toBe(true);
    if (parseResult.success) {
      expect(parseResult.data.communityCount).toBeGreaterThanOrEqual(0);
      expect(typeof parseResult.data.modularity).toBe("number"); // coerced from string
      expect(parseResult.data.processCount).toBeGreaterThanOrEqual(0);
    }
  });

  it("cluster_graph: TS adapter and Rust binary agree on communityCount", async () => {
    if (adapter === null) {
      adapter = await createCodebaseAdapter({ binaryPath: BINARY_PATH });
    }

    // TS adapter fresh graph
    const outputDir1 = makeTempDir();
    const freshIdx1 = callRust(BINARY_PATH, "index_codebase", {
      path: FIXTURE_REPO, language: "python", output_dir: outputDir1,
    });
    const fg1 = freshIdx1!["graph_path"] as string;
    callRust(BINARY_PATH, "resolve_graph", { graph_path: fg1 });
    const tsResult = await adapter.clusterGraph({ graphPath: fg1 });

    // Rust direct fresh graph
    const outputDir2 = makeTempDir();
    const freshIdx2 = callRust(BINARY_PATH, "index_codebase", {
      path: FIXTURE_REPO, language: "python", output_dir: outputDir2,
    });
    const fg2 = freshIdx2!["graph_path"] as string;
    callRust(BINARY_PATH, "resolve_graph", { graph_path: fg2 });
    const rustRaw = callRust(BINARY_PATH, "cluster_graph", { graph_path: fg2 });
    expect(rustRaw).not.toBeNull();

    // Both should produce the same community count on the same fixture
    expect(tsResult.communityCount).toBeGreaterThan(0);
    expect(tsResult.communityCount).toBe(rustRaw!["community_count"] as number);
  });

  // ── get_context ────────────────────────────────────────────────────────────

  it("get_context: Rust binary returns relationships as OBJECT not array (SCHEMA FIX)", () => {
    if (graphPath === null) return;
    const rustRaw = callRust(BINARY_PATH, "get_context", {
      graph_path: graphPath, qualified_name: "src/store.py::MemoryStore",
    });
    // source: packages/codebase-rust/src/main.rs:2481-2506
    expect(rustRaw).not.toBeNull();
    expect(rustRaw!["status"]).toBe("ok");

    // KEY ASSERTION: relationships is an OBJECT with sub-keys, NOT an array
    const relationships = rustRaw!["relationships"];
    expect(typeof relationships).toBe("object");
    expect(Array.isArray(relationships)).toBe(false);
    // Confirm the expected sub-keys exist
    const rel = relationships as Record<string, unknown>;
    expect(Array.isArray(rel["imports"])).toBe(true);
    expect(Array.isArray(rel["calls"])).toBe(true);
    expect(Array.isArray(rel["imported_by"])).toBe(true);
  });

  it("get_context: Zod schema (post-fix) validates nested relationships object", () => {
    if (graphPath === null) return;
    const rustRaw = callRust(BINARY_PATH, "get_context", {
      graph_path: graphPath, qualified_name: "src/store.py::MemoryStore",
    });
    expect(rustRaw).not.toBeNull();

    const camelized = deepToCamel(rustRaw) as Record<string, unknown>;
    // source: packages/core/src/ports/codebase-outputs.ts — GetContextOutputSchema (post-fix)
    const parseResult = GetContextOutputSchema.safeParse(camelized);
    expect(parseResult.success, `Schema validation failed: ${JSON.stringify(parseResult)}`).toBe(true);
    if (parseResult.success) {
      // symbol is a record
      expect(typeof parseResult.data.symbol).toBe("object");
      // relationships is an object with sub-arrays (not an array)
      const rel = parseResult.data.relationships;
      expect(typeof rel).toBe("object");
      expect(Array.isArray((rel as Record<string, unknown>)["imports"])).toBe(true);
      expect(Array.isArray((rel as Record<string, unknown>)["calls"])).toBe(true);
    }
  });

  it("get_context: not-found returns symbol_not_found error shape", () => {
    if (graphPath === null) return;
    const rustRaw = callRust(BINARY_PATH, "get_context", {
      graph_path: graphPath, qualified_name: "nonexistent::symbol",
    });
    // source: packages/codebase-rust/src/main.rs:2446-2457
    expect(rustRaw).not.toBeNull();
    expect(rustRaw!["status"]).toBe("error");
    expect(rustRaw!["reason"]).toBe("symbol_not_found");

    const camelized = deepToCamel(rustRaw) as Record<string, unknown>;
    const parseResult = NotFoundOutputSchema.safeParse(camelized);
    expect(parseResult.success).toBe(true);
  });

  it("get_context: TS adapter returns GetContextOutput with nested relationships", async () => {
    if (graphPath === null) return;
    if (adapter === null) {
      adapter = await createCodebaseAdapter({ binaryPath: BINARY_PATH });
    }

    const result = await adapter.getContext({
      graphPath, qualifiedName: "src/store.py::MemoryStore",
    });

    // Should parse as GetContextOutput (not NotFoundOutput)
    const parsed = GetContextOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const rel = parsed.data.relationships;
      expect(typeof rel).toBe("object");
      expect(Array.isArray((rel as Record<string, unknown>)["imports"])).toBe(true);
    }
  });
});
