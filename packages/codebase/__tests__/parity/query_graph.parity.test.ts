/**
 * Parity test: query_graph
 *
 * Instrument: Rust binary ground truth vs TS adapter Zod validation.
 * Parity definition: same columns/rows structure; Zod schema validates.
 *
 * Fixture: small-python codebase (must be indexed first).
 *
 * source: packages/codebase-rust/src/main.rs:1847-1866 — run_query_graph
 * source: packages/core/src/ports/codebase-outputs.ts:57-66 — QueryGraphOutputSchema
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
  QueryGraphOutputSchema,
} from "../../src/index.js";
import type { CodebasePort } from "@agentic/core";

// ── Binary + fixture resolution ───────────────────────────────────────────────

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

describe("parity: query_graph", () => {
  if (BINARY_PATH === null) {
    it.todo("requires Rust binary");
    return;
  }
  if (!existsSync(FIXTURE_REPO)) {
    it.todo(`fixture repo not found at: ${FIXTURE_REPO}`);
    return;
  }

  let adapter: CodebasePort | null = null;
  const tempDirs: string[] = [];
  let graphPath: string | null = null;

  function makeTempDir(): string {
    const d = mkdtempSync(join(tmpdir(), "parity-qg-"));
    tempDirs.push(d);
    return d;
  }

  afterAll(async () => {
    if (adapter !== null) await adapter.dispose();
    for (const d of tempDirs) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });

  it("index fixture to get graphPath", () => {
    const outputDir = makeTempDir();
    const indexResult = callRust(BINARY_PATH, "index_codebase", {
      path: FIXTURE_REPO, language: "python", output_dir: outputDir,
    });
    expect(indexResult).not.toBeNull();
    expect(indexResult!["status"]).toBe("ok");
    graphPath = indexResult!["graph_path"] as string;
    expect(typeof graphPath).toBe("string");
  });

  it("query_graph: Rust binary returns columns, rows, result, elapsed_ms", () => {
    if (graphPath === null) return;
    const rustRaw = callRust(BINARY_PATH, "query_graph", {
      graph_path: graphPath, query: "MATCH (n) RETURN n.name LIMIT 5",
    });
    // source: packages/codebase-rust/src/main.rs:1847 — run_query_graph
    expect(rustRaw).not.toBeNull();
    expect(rustRaw!["status"]).toBe("ok");
    expect(Array.isArray(rustRaw!["columns"])).toBe(true);
    expect(Array.isArray(rustRaw!["rows"])).toBe(true);
    expect(typeof rustRaw!["elapsed_ms"]).toBe("number");
    expect(rustRaw!["stage"]).toBe(3);
  });

  it("query_graph: Zod schema validates camelCase Rust output", () => {
    if (graphPath === null) return;
    const rustRaw = callRust(BINARY_PATH, "query_graph", {
      graph_path: graphPath, query: "MATCH (n) RETURN n.name LIMIT 3",
    });
    expect(rustRaw).not.toBeNull();

    const camelized = deepToCamel(rustRaw) as Record<string, unknown>;
    // source: packages/core/src/ports/codebase-outputs.ts:57-66
    const parseResult = QueryGraphOutputSchema.safeParse(camelized);
    expect(parseResult.success, `Schema validation failed: ${JSON.stringify(parseResult)}`).toBe(true);
    if (parseResult.success) {
      expect(Array.isArray(parseResult.data.columns)).toBe(true);
      expect(Array.isArray(parseResult.data.rows)).toBe(true);
      expect(parseResult.data.elapsedMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("query_graph: TS adapter and Rust binary agree on column names", async () => {
    if (graphPath === null) return;
    adapter = await createCodebaseAdapter({ binaryPath: BINARY_PATH });

    const QUERY = "MATCH (n) RETURN n.name LIMIT 3";

    // TS adapter
    const tsResult = await adapter.queryGraph({ graphPath, query: QUERY });

    // Rust direct
    const rustRaw = callRust(BINARY_PATH, "query_graph", {
      graph_path: graphPath, query: QUERY,
    });
    expect(rustRaw).not.toBeNull();

    // Parity: same column set
    expect(tsResult.columns).toEqual(rustRaw!["columns"] as string[]);
    // Parity: same row count
    const rustRows = rustRaw!["rows"] as unknown[][];
    expect(tsResult.rows.length).toBe(rustRows.length);
  });

  it("query_graph: read-only guard rejects mutation query with error status", () => {
    if (graphPath === null) return;
    // source: packages/codebase-rust/src/main.rs:1878-1881 — FORBIDDEN_CYPHER_KEYWORDS
    const rustRaw = callRust(BINARY_PATH, "query_graph", {
      graph_path: graphPath, query: "CREATE (n:Test) RETURN n",
    });
    expect(rustRaw).not.toBeNull();
    expect(rustRaw!["status"]).toBe("error");
    expect(rustRaw!["reason"]).toBe("read_only_query_required");
  });
});
