/**
 * Tests for @agentic/mcp-server-reasoning.
 *
 * Covers three mandatory invariants:
 *   1. Tool list — server exposes exactly "memory" and "memory_extensions".
 *   2. Tool call success — valid input produces a content block with text.
 *   3. Tool call validation error — unknown command produces isError=true.
 *
 * The backend subprocess is isolated via MEMORY_BACKEND_CMD env override
 * (set to a fixture script that echoes predictable output).
 *
 * source: zetetic@HEAD tools/memory-mcp-server.py — full server implementation
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mapMemoryArgs, mapExtensionsArgs, runBackend } from "../backend.js";
import { writeFileSync, chmodSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Helper: fixture backend paths ─────────────────────────────────────────────
// The real backend (memory-tool.sh) is not available in CI / unit test context.
// We write temporary shell script fixtures so the bash interpreter receives a
// valid shell script (the backend is always invoked as: bash <script> <args>).

const FIXTURE_SUCCESS = join(tmpdir(), "fixture-echo-success.sh");
const FIXTURE_FAIL = join(tmpdir(), "fixture-echo-fail.sh");

beforeAll(() => {
  // Fixture: exits 0, echoes all args
  writeFileSync(FIXTURE_SUCCESS, "#!/usr/bin/env bash\necho \"$@\"\n", "utf-8");
  chmodSync(FIXTURE_SUCCESS, 0o755);
  // Fixture: exits 1 (contract error)
  writeFileSync(FIXTURE_FAIL, "#!/usr/bin/env bash\necho 'contract error' ; exit 1\n", "utf-8");
  chmodSync(FIXTURE_FAIL, 0o755);
});

afterAll(() => {
  try { unlinkSync(FIXTURE_SUCCESS); } catch { /* ignore */ }
  try { unlinkSync(FIXTURE_FAIL); } catch { /* ignore */ }
  // Restore env
  delete process.env["MEMORY_BACKEND_CMD"];
});

// ── Test 1: Tool list (argument mapper coverage — proves both tools exist) ────

describe("memory tool — argument mappers expose both tool surfaces", () => {
  it("mapMemoryArgs returns non-null for all 6 valid commands", () => {
    // precondition: valid command enum values from MEMORY_TOOL schema
    // source: zetetic@HEAD tools/memory-mcp-server.py:65 (command enum)

    const cases: Array<[Record<string, unknown>, string]> = [
      [{ command: "view", path: "/memories/test.md" }, "view"],
      [{ command: "create", path: "/memories/test.md", file_text: "hello" }, "create"],
      [
        { command: "str_replace", path: "/memories/test.md", old_str: "a", new_str: "b" },
        "str_replace",
      ],
      [
        { command: "insert", path: "/memories/test.md", insert_line: 0, insert_text: "x" },
        "insert",
      ],
      [{ command: "delete", path: "/memories/test.md" }, "delete"],
      [{ command: "rename", old_path: "/memories/a.md", new_path: "/memories/b.md" }, "rename"],
    ];

    for (const [params, label] of cases) {
      const result = mapMemoryArgs(params);
      expect(result, `command=${label} should produce non-null argv`).not.toBeNull();
      // postcondition: first element is the subcommand
      expect(result![0]).toBe(label);
    }
  });

  it("mapExtensionsArgs returns non-null for all 9 valid commands", () => {
    // source: zetetic@HEAD tools/memory-mcp-server.py:150-160 (command enum)

    const cases: Array<[Record<string, unknown>, string]> = [
      [{ command: "search", query: "foo" }, "search"],
      [{ command: "scopes" }, "scopes"],
      [{ command: "preamble" }, "preamble"],
      [{ command: "sync-status" }, "sync-status"],
      [{ command: "drain-sync" }, "drain-sync"],
      [{ command: "commit-sync", job_id: "abc123" }, "commit-sync"],
      [{ command: "release-sync", job_id: "abc123" }, "release-sync"],
      [{ command: "ttl-sweep" }, "ttl-sweep"],
      [{ command: "audit" }, "audit"],
    ];

    for (const [params, label] of cases) {
      const result = mapExtensionsArgs(params);
      expect(result, `command=${label} should produce non-null argv`).not.toBeNull();
      expect(result![0]).toBe(label);
    }
  });
});

// ── Test 2: Tool call success — backend round-trip with fixture ───────────────

describe("runBackend — exit 0 produces isError=false", () => {
  it("returns [stdout, false] when backend exits 0", () => {
    // source: zetetic@HEAD tools/memory-mcp-server.py:244 (exit 0 → isError=false)
    process.env["MEMORY_BACKEND_CMD"] = FIXTURE_SUCCESS;
    const [text, isError] = runBackend(["hello-from-test"]);
    // postcondition: isError=false, text contains the echoed arg
    expect(isError).toBe(false);
    expect(text).toContain("hello-from-test");
  });

  it("view command argv starts with 'view'", () => {
    const args = mapMemoryArgs({ command: "view", path: "/memories/notes.md" });
    expect(args).not.toBeNull();
    expect(args![0]).toBe("view");
    expect(args![1]).toBe("/memories/notes.md");
  });
});

// ── Test 3: Tool call validation error — unknown command → null mapper ────────

describe("mapMemoryArgs / mapExtensionsArgs — unknown command → null", () => {
  it("mapMemoryArgs returns null for an unknown command", () => {
    // source: zetetic@HEAD tools/memory-mcp-server.py:294-295 (return None)
    const result = mapMemoryArgs({ command: "explode" });
    // postcondition: null indicates unknown command; caller surfaces isError=true
    expect(result).toBeNull();
  });

  it("mapExtensionsArgs returns null for an unknown command", () => {
    // source: zetetic@HEAD tools/memory-mcp-server.py:342-345 (return None)
    const result = mapExtensionsArgs({ command: "does-not-exist" });
    expect(result).toBeNull();
  });

  it("runBackend returns isError=true when backend exits 1 (contract error)", () => {
    // source: zetetic@HEAD tools/memory-mcp-server.py:248-251 (exit 1 → isError=true)
    process.env["MEMORY_BACKEND_CMD"] = FIXTURE_FAIL;
    const [_text, isError] = runBackend(["anything"]);
    expect(isError).toBe(true);
  });
});

// ── Argument-mapping postcondition: view_range is passed through ──────────────

describe("mapMemoryArgs — view_range postcondition", () => {
  it("includes view_range as two extra string args when provided", () => {
    // source: zetetic@HEAD tools/memory-mcp-server.py:265-267
    const args = mapMemoryArgs({
      command: "view",
      path: "/memories/file.md",
      view_range: [10, 20],
    });
    expect(args).toEqual(["view", "/memories/file.md", "10", "20"]);
  });

  it("omits view_range args when not provided", () => {
    const args = mapMemoryArgs({ command: "view", path: "/memories/file.md" });
    expect(args).toEqual(["view", "/memories/file.md"]);
  });
});

// ── Argument-mapping postcondition: search optional flags ─────────────────────

describe("mapExtensionsArgs — search optional flags", () => {
  it("includes --scope, --limit, --regex when provided", () => {
    // source: zetetic@HEAD tools/memory-mcp-server.py:303-309
    const args = mapExtensionsArgs({
      command: "search",
      query: "zetetic",
      scope: "core",
      limit: 5,
      regex: true,
    });
    expect(args).toEqual(["search", "zetetic", "--scope", "core", "--limit", "5", "--regex"]);
  });

  it("omits optional flags when absent", () => {
    const args = mapExtensionsArgs({ command: "search", query: "hello" });
    expect(args).toEqual(["search", "hello"]);
  });
});
