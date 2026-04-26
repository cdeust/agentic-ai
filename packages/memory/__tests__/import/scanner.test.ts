/**
 * Unit tests for scanner.ts
 *
 * Tests the head+tail JSONL read strategy (ADR-0045 R2) and file discovery.
 * Uses tmp files to avoid dependency on ~/.claude/projects/.
 *
 * source: mcp_server/infrastructure/scanner.py::read_head_tail
 *         mcp_server/handlers/import_sessions.py::_discover_jsonl_files
 *         parity-oracle failure_modes_caught:
 *           "TS port materialises full JSONL file in memory (reverts ADR-0045 R2 OOM fix)"
 *           "subagent JSONL files included despite filter"
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readHeadTail, discoverJsonlFiles } from "../../src/import/scanner.js";
import type { JsonlRecord } from "../../src/import/types.js";

// ── Test fixtures ─────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `cortex-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeJsonl(filePath: string, records: JsonlRecord[]): void {
  const lines = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(filePath, lines, "utf8");
}

// ── readHeadTail ──────────────────────────────────────────────────────────

describe("readHeadTail", () => {
  it("returns [] for nonexistent file", () => {
    expect(readHeadTail(join(tmpDir, "nonexistent.jsonl"))).toEqual([]);
  });

  it("reads a small JSONL file fully", () => {
    const records: JsonlRecord[] = [
      { type: "user", sessionId: "s1", timestamp: "2025-01-01T00:00:00Z" },
      { type: "assistant", sessionId: "s1", timestamp: "2025-01-01T00:00:01Z" },
    ];
    const fpath = join(tmpDir, "session.jsonl");
    writeJsonl(fpath, records);
    const result = readHeadTail(fpath);
    expect(result).toHaveLength(2);
    expect(result[0]?.type).toBe("user");
    expect(result[1]?.type).toBe("assistant");
  });

  it("skips blank lines and malformed JSON", () => {
    const content = '{"type":"user","sessionId":"s1"}\n\nnot-json\n{"type":"assistant"}\n';
    const fpath = join(tmpDir, "session.jsonl");
    writeFileSync(fpath, content, "utf8");
    const result = readHeadTail(fpath);
    expect(result).toHaveLength(2);
  });

  it("returns [] on empty file", () => {
    const fpath = join(tmpDir, "empty.jsonl");
    writeFileSync(fpath, "", "utf8");
    expect(readHeadTail(fpath)).toEqual([]);
  });

  it("does not materialise file beyond HEAD+TAIL bytes (ADR-0045 R2)", () => {
    // source: ADR-0045 R2 — no ingestion path reads whole file into memory
    // We can't directly measure memory, but we CAN verify that a file whose
    // middle records are absent from the result was not fully read.
    // Create a file > 40KB with distinct head/middle/tail records.
    const headRecord: JsonlRecord = { type: "user", sessionId: "head", timestamp: "2025-01-01T00:00:00Z" };
    const middleRecord: JsonlRecord = { type: "user", sessionId: "middle", timestamp: "2025-06-01T00:00:00Z" };
    const tailRecord: JsonlRecord = { type: "user", sessionId: "tail", timestamp: "2025-12-31T00:00:00Z" };

    // Build: 1 head line + many padding lines to push file > 40KB + 1 tail line
    const padding = ' '.repeat(100);
    const paddingRecord: JsonlRecord = { type: "user", sessionId: `pad${padding}` };
    const lines: string[] = [
      JSON.stringify(headRecord),
    ];
    // Add enough padding to exceed HEAD_BYTES (32768) + TAIL_BYTES (8192)
    for (let i = 0; i < 500; i++) {
      lines.push(JSON.stringify({ ...paddingRecord, sessionId: `pad-${i}-${padding}` }));
    }
    lines.push(JSON.stringify(middleRecord)); // this will be in the middle
    for (let i = 0; i < 100; i++) {
      lines.push(JSON.stringify({ ...paddingRecord, sessionId: `pad2-${i}-${padding}` }));
    }
    lines.push(JSON.stringify(tailRecord));
    lines.push(""); // trailing newline

    const fpath = join(tmpDir, "large.jsonl");
    writeFileSync(fpath, lines.join("\n"), "utf8");

    const result = readHeadTail(fpath);
    const sessionIds = result.map((r) => r.sessionId);

    // Head record MUST be present
    expect(sessionIds).toContain("head");
    // Tail record MUST be present
    expect(sessionIds).toContain("tail");
    // Middle record should NOT be present (it's between head and tail windows)
    expect(sessionIds).not.toContain("middle");
  });
});

// ── discoverJsonlFiles ────────────────────────────────────────────────────

describe("discoverJsonlFiles", () => {
  it("returns [] when projectsDir does not exist", () => {
    expect(discoverJsonlFiles(join(tmpDir, "nonexistent"), "")).toEqual([]);
  });

  it("discovers JSONL files under project directories", () => {
    const projDir = join(tmpDir, "-Users-alice-code-cortex");
    mkdirSync(projDir, { recursive: true });
    const fpath = join(projDir, "session-001.jsonl");
    writeFileSync(fpath, '{"type":"user"}\n', "utf8");

    const entries = discoverJsonlFiles(tmpDir, "");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.projectName).toBe("-Users-alice-code-cortex");
    expect(entries[0]?.filePath).toBe(fpath);
  });

  it("filters by project slug", () => {
    const proj1 = join(tmpDir, "project-a");
    const proj2 = join(tmpDir, "project-b");
    mkdirSync(proj1, { recursive: true });
    mkdirSync(proj2, { recursive: true });
    writeFileSync(join(proj1, "s1.jsonl"), '{"type":"user"}\n', "utf8");
    writeFileSync(join(proj2, "s2.jsonl"), '{"type":"user"}\n', "utf8");

    const entries = discoverJsonlFiles(tmpDir, "project-a");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.projectName).toBe("project-a");
  });

  it("excludes files with 'subagent' in filename", () => {
    // source: parity failure_modes_caught — subagent JSONL files included despite filter
    const projDir = join(tmpDir, "my-project");
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, "session.jsonl"), '{"type":"user"}\n', "utf8");
    writeFileSync(join(projDir, "subagent-session.jsonl"), '{"type":"user"}\n', "utf8");

    const entries = discoverJsonlFiles(tmpDir, "");
    const names = entries.map((e) => e.filePath.split("/").pop());
    expect(names).not.toContain("subagent-session.jsonl");
    expect(names).toContain("session.jsonl");
  });

  it("excludes files under paths containing 'subagents'", () => {
    // source: "subagents" in str(f) — import_sessions.py
    const subagentsDir = join(tmpDir, "my-project", "subagents");
    mkdirSync(subagentsDir, { recursive: true });
    writeFileSync(join(subagentsDir, "session.jsonl"), '{"type":"user"}\n', "utf8");

    const entries = discoverJsonlFiles(tmpDir, "");
    expect(entries).toHaveLength(0);
  });

  it("returns entries sorted by project then filename", () => {
    const proj = join(tmpDir, "a-project");
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, "z-session.jsonl"), '{"type":"user"}\n', "utf8");
    writeFileSync(join(proj, "a-session.jsonl"), '{"type":"user"}\n', "utf8");

    const entries = discoverJsonlFiles(tmpDir, "");
    const names = entries.map((e) => e.filePath.split("/").pop());
    expect(names[0]).toBe("a-session.jsonl");
    expect(names[1]).toBe("z-session.jsonl");
  });
});
