/**
 * Parity test: get_processes + get_impact + search_codebase
 *
 * Instrument: Rust binary ground truth vs TS adapter Zod validation.
 * Parity definition: all required Zod schema fields present and correctly typed.
 *
 * Fixture: small-python codebase (indexed + resolved + clustered).
 *
 * source: packages/codebase-rust/src/main.rs:2270-2307 — run_get_processes
 * source: packages/codebase-rust/src/main.rs:2313-2347 — run_get_impact
 * source: packages/codebase-rust/src/main.rs:2353-2416 — run_search_codebase
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
  GetProcessesOutputSchema,
  GetImpactOutputSchema,
  SearchCodebaseOutputSchema,
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

describe("parity: get_processes + get_impact + search_codebase", () => {
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
    const d = mkdtempSync(join(tmpdir(), "parity-gr-"));
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

  // ── get_processes ──────────────────────────────────────────────────────────

  it("get_processes: Rust binary returns processCount and processes array", () => {
    if (graphPath === null) return;
    const rustRaw = callRust(BINARY_PATH, "get_processes", { graph_path: graphPath });
    // source: packages/codebase-rust/src/main.rs:2300-2306
    expect(rustRaw).not.toBeNull();
    expect(rustRaw!["status"]).toBe("ok");
    expect(typeof rustRaw!["process_count"]).toBe("number");
    expect(Array.isArray(rustRaw!["processes"])).toBe(true);
  });

  it("get_processes: Zod schema validates camelCase Rust output", () => {
    if (graphPath === null) return;
    const rustRaw = callRust(BINARY_PATH, "get_processes", { graph_path: graphPath });
    expect(rustRaw).not.toBeNull();

    const camelized = deepToCamel(rustRaw) as Record<string, unknown>;
    // source: packages/core/src/ports/codebase-outputs.ts:127-133
    const parseResult = GetProcessesOutputSchema.safeParse(camelized);
    expect(parseResult.success, `Schema validation failed: ${JSON.stringify(parseResult)}`).toBe(true);
    if (parseResult.success) {
      expect(parseResult.data.processCount).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(parseResult.data.processes)).toBe(true);
    }
  });

  it("get_processes: TS adapter and Rust binary agree on processCount", async () => {
    if (graphPath === null) return;
    adapter = await createCodebaseAdapter({ binaryPath: BINARY_PATH });

    const tsResult = await adapter.getProcesses({ graphPath });
    const rustRaw = callRust(BINARY_PATH, "get_processes", { graph_path: graphPath });
    expect(rustRaw).not.toBeNull();

    expect(tsResult.processCount).toBe(rustRaw!["process_count"] as number);
    expect(tsResult.processes.length).toBe((rustRaw!["processes"] as unknown[]).length);
  });

  // ── get_impact ─────────────────────────────────────────────────────────────

  it("get_impact: Rust binary returns communities as array<string>, not array<object> (SCHEMA FIX)", () => {
    if (graphPath === null) return;
    const rustRaw = callRust(BINARY_PATH, "get_impact", {
      graph_path: graphPath, qualified_name: "src/store.py::MemoryStore",
    });
    // source: packages/codebase-rust/src/main.rs:2337-2346
    expect(rustRaw).not.toBeNull();
    expect(rustRaw!["status"]).toBe("ok");

    const communities = rustRaw!["communities"] as unknown[];
    expect(Array.isArray(communities)).toBe(true);
    // KEY ASSERTION: communities contains strings (community IDs), not objects
    if (communities.length > 0) {
      expect(typeof communities[0]).toBe("string");
    }

    const processes = rustRaw!["processes"] as unknown[];
    expect(Array.isArray(processes)).toBe(true);
    // processes is also array<string> (process names)
    if (processes.length > 0) {
      expect(typeof processes[0]).toBe("string");
    }
  });

  it("get_impact: Zod schema (post-fix) validates with array<string> communities", () => {
    if (graphPath === null) return;
    const rustRaw = callRust(BINARY_PATH, "get_impact", {
      graph_path: graphPath, qualified_name: "src/store.py::MemoryStore",
    });
    expect(rustRaw).not.toBeNull();

    const camelized = deepToCamel(rustRaw) as Record<string, unknown>;
    // source: packages/core/src/ports/codebase-outputs.ts — GetImpactOutputSchema (post-fix)
    // communities: z.array(z.string()) — fixed from z.array(z.record(...))
    const parseResult = GetImpactOutputSchema.safeParse(camelized);
    expect(parseResult.success, `Schema validation failed: ${JSON.stringify(parseResult)}`).toBe(true);
    if (parseResult.success) {
      expect(parseResult.data.communitiesAffected).toBeGreaterThanOrEqual(0);
      expect(parseResult.data.processesAffected).toBeGreaterThanOrEqual(0);
      // communities is string[]
      if (parseResult.data.communities.length > 0) {
        expect(typeof parseResult.data.communities[0]).toBe("string");
      }
    }
  });

  it("get_impact: TS adapter and Rust binary agree on communitiesAffected count", async () => {
    if (graphPath === null) return;
    if (adapter === null) {
      adapter = await createCodebaseAdapter({ binaryPath: BINARY_PATH });
    }

    const QN = "src/store.py::MemoryStore";
    const tsResult = await adapter.getImpact({ graphPath, qualifiedName: QN });
    const rustRaw = callRust(BINARY_PATH, "get_impact", {
      graph_path: graphPath, qualified_name: QN,
    });
    expect(rustRaw).not.toBeNull();

    expect(tsResult.communitiesAffected).toBe(rustRaw!["communities_affected"] as number);
    expect(tsResult.processesAffected).toBe(rustRaw!["processes_affected"] as number);
  });

  // ── search_codebase ────────────────────────────────────────────────────────

  it("search_codebase: Rust binary returns resultCount, results, elapsedMs", () => {
    if (graphPath === null) return;
    const rustRaw = callRust(BINARY_PATH, "search_codebase", {
      graph_path: graphPath, query: "memory", limit: 3,
    });
    // source: packages/codebase-rust/src/main.rs:2407-2415
    expect(rustRaw).not.toBeNull();
    expect(rustRaw!["status"]).toBe("ok");
    expect(typeof rustRaw!["result_count"]).toBe("number");
    expect(Array.isArray(rustRaw!["results"])).toBe(true);
    expect(typeof rustRaw!["elapsed_ms"]).toBe("number");
  });

  it("search_codebase: Zod schema validates camelCase Rust output", () => {
    if (graphPath === null) return;
    const rustRaw = callRust(BINARY_PATH, "search_codebase", {
      graph_path: graphPath, query: "memory", limit: 3,
    });
    expect(rustRaw).not.toBeNull();

    const camelized = deepToCamel(rustRaw) as Record<string, unknown>;
    // source: packages/core/src/ports/codebase-outputs.ts:149-156
    const parseResult = SearchCodebaseOutputSchema.safeParse(camelized);
    expect(parseResult.success, `Schema validation failed: ${JSON.stringify(parseResult)}`).toBe(true);
    if (parseResult.success) {
      expect(parseResult.data.resultCount).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(parseResult.data.results)).toBe(true);
      expect(parseResult.data.elapsedMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("search_codebase: TS adapter and Rust binary agree on resultCount for 'memory'", async () => {
    if (graphPath === null) return;
    if (adapter === null) {
      adapter = await createCodebaseAdapter({ binaryPath: BINARY_PATH });
    }

    const QUERY = "memory";
    const LIMIT = 5;

    const tsResult = await adapter.searchCodebase({ graphPath, query: QUERY, limit: LIMIT });
    const rustRaw = callRust(BINARY_PATH, "search_codebase", {
      graph_path: graphPath, query: QUERY, limit: LIMIT,
    });
    expect(rustRaw).not.toBeNull();

    // Parity: same result count
    expect(tsResult.resultCount).toBe(rustRaw!["result_count"] as number);
    expect(tsResult.results.length).toBe((rustRaw!["results"] as unknown[]).length);
  });

  it("search_codebase: results each have name, kind, file_path, score, qualified_name", () => {
    if (graphPath === null) return;
    const rustRaw = callRust(BINARY_PATH, "search_codebase", {
      graph_path: graphPath, query: "store", limit: 3,
    });
    expect(rustRaw).not.toBeNull();
    const results = rustRaw!["results"] as Array<Record<string, unknown>>;
    if (results.length === 0) return;
    // source: packages/codebase-rust/src/main.rs:2395-2405 — result item fields
    for (const r of results) {
      expect(typeof r["name"]).toBe("string");
      expect(typeof r["kind"]).toBe("string");
      expect(typeof r["file_path"]).toBe("string");
      expect(typeof r["score"]).toBe("string"); // score is a string like "1.0000"
      expect(typeof r["qualified_name"]).toBe("string");
    }
  });
});
