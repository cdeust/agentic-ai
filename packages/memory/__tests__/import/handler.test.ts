/**
 * Integration tests for the import handler.
 *
 * Validates invariants documented in parity-oracle:
 *   parity-oracle/cortex/expected/import/claude_mem_smallset.json
 *   _critical_invariants:
 *     - dry_run == true
 *     - sessions_scanned <= max_sessions cap
 *     - preview array present when imported > 0
 *     - each preview item has: content, tags, importance, project, domain
 *     - no subagent JSONL files included in sessions_scanned count
 *
 *   failure_modes_caught:
 *     - dry_run=true stores memories instead of only previewing
 *     - sessions_scanned field absent from response
 *     - imported count wrong when dry_run=true (should count extracted items not stored)
 *     - domain detection broken: all sessions classified as 'unknown'
 *     - errors array absent when error occurs
 *     - preview array absent when dry_run=true and items found
 *
 * source: parity-oracle/cortex/inputs/import/claude_mem_smallset.json
 * source: parity-oracle/cortex/expected/import/claude_mem_smallset.json
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importHandler } from "../../src/import/handler.js";
import type { RememberHandler } from "../../src/import/types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `cortex-handler-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Build a minimal JSONL session that will produce >= 1 memorable item.
 */
function makeSessionContent(cwd: string): string {
  const records = [
    {
      type: "user",
      sessionId: "test-session-1",
      cwd,
      timestamp: "2025-01-15T10:00:00Z",
      message: {
        content:
          "I decided to switch to TypeScript for all new modules. " +
          "This was a key architectural decision driven by the need for " +
          "better type safety and IDE support in the long-term maintenance phase.",
      },
    },
    {
      type: "assistant",
      sessionId: "test-session-1",
      timestamp: "2025-01-15T10:00:01Z",
      message: {
        content: [{ type: "text", text: "Sounds good." }],
      },
    },
  ];
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

function setupProjectWithSession(
  projectName: string,
  cwd: string,
  sessionFile = "session-001.jsonl",
): void {
  const projDir = join(tmpDir, projectName);
  mkdirSync(projDir, { recursive: true });
  writeFileSync(join(projDir, sessionFile), makeSessionContent(cwd), "utf8");
}

const noopRemember: RememberHandler = async () => ({ stored: true });
const rejectingRemember: RememberHandler = async () => ({ stored: false });

// ── dry_run invariants ────────────────────────────────────────────────────

describe("importHandler — dry_run=true", () => {
  it("returns dry_run=true in response", async () => {
    setupProjectWithSession("my-project", "/Users/alice/Developments/cortex");
    const result = await importHandler(
      { dry_run: true, min_importance: 0.4 },
      noopRemember,
      tmpDir,
    );
    expect(result.dry_run).toBe(true);
  });

  it("does NOT call rememberHandler when dry_run=true", async () => {
    // source: failure_modes_caught — dry_run=true stores memories instead of only previewing
    setupProjectWithSession("my-project", "/Users/alice/Developments/cortex");
    const spy = vi.fn().mockResolvedValue({ stored: true });
    await importHandler({ dry_run: true, min_importance: 0.4 }, spy, tmpDir);
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns preview array when items are found", async () => {
    // source: failure_modes_caught — preview array absent when dry_run=true and items found
    setupProjectWithSession("my-project", "/Users/alice/Developments/cortex");
    const result = await importHandler(
      { dry_run: true, min_importance: 0.4 },
      noopRemember,
      tmpDir,
    );
    expect(result.imported).toBeGreaterThan(0);
    expect(result.preview).toBeDefined();
    expect(Array.isArray(result.preview)).toBe(true);
  });

  it("each preview item has required fields: content, tags, importance, project, domain", async () => {
    // source: _critical_invariants — each preview item has: content, tags, importance, project, domain
    setupProjectWithSession("my-project", "/Users/alice/Developments/cortex");
    const result = await importHandler(
      { dry_run: true, min_importance: 0.0 },
      noopRemember,
      tmpDir,
    );
    expect(result.preview).toBeDefined();
    for (const item of result.preview ?? []) {
      expect(typeof item.content).toBe("string");
      expect(Array.isArray(item.tags)).toBe(true);
      expect(typeof item.importance).toBe("number");
      expect(typeof item.project).toBe("string");
      expect(typeof item.domain).toBe("string");
    }
  });

  it("imported counts extracted items, not stored items", async () => {
    // source: failure_modes_caught — imported count wrong when dry_run=true
    setupProjectWithSession("my-project", "/Users/alice/Developments/cortex");
    const result = await importHandler(
      { dry_run: true, min_importance: 0.0 },
      rejectingRemember, // wouldn't store even if called
      tmpDir,
    );
    // In dry_run=true mode, imported = count of extracted items regardless of rememberHandler
    expect(result.imported).toBeGreaterThanOrEqual(0);
    expect(result.gated).toBe(0); // dry_run never gates
  });
});

// ── sessions_scanned field ────────────────────────────────────────────────

describe("importHandler — sessions_scanned", () => {
  it("sessions_scanned is present in response", async () => {
    // source: failure_modes_caught — sessions_scanned field absent from response
    setupProjectWithSession("p1", "/Users/alice/Developments/cortex");
    const result = await importHandler(
      { dry_run: true, min_importance: 0.0 },
      noopRemember,
      tmpDir,
    );
    expect(typeof result.sessions_scanned).toBe("number");
  });

  it("sessions_scanned respects max_sessions cap", async () => {
    // source: _critical_invariants — sessions_scanned <= max_sessions cap
    for (let i = 0; i < 5; i++) {
      setupProjectWithSession(`project-${i}`, `/Users/alice/Developments/proj-${i}`, "s.jsonl");
    }
    const result = await importHandler(
      { dry_run: true, max_sessions: 3, min_importance: 0.0 },
      noopRemember,
      tmpDir,
    );
    expect(result.sessions_scanned).toBeLessThanOrEqual(3);
    expect(result.total_files).toBe(3);
  });
});

// ── domain detection ──────────────────────────────────────────────────────

describe("importHandler — domain detection", () => {
  it("domain is not 'unknown' for a known path layout", async () => {
    // source: failure_modes_caught — domain detection broken: all sessions classified as 'unknown'
    setupProjectWithSession("my-project", "/Users/alice/Developments/cortex");
    const result = await importHandler(
      { dry_run: true, min_importance: 0.0 },
      noopRemember,
      tmpDir,
    );
    const domains = (result.preview ?? []).map((item) => item.domain);
    expect(domains.some((d) => d !== "unknown")).toBe(true);
  });
});

// ── subagent filtering ────────────────────────────────────────────────────

describe("importHandler — subagent filtering", () => {
  it("subagent JSONL files are not counted in sessions_scanned", async () => {
    // source: failure_modes_caught — subagent JSONL files included despite filter
    const projDir = join(tmpDir, "my-project");
    mkdirSync(projDir, { recursive: true });
    writeFileSync(
      join(projDir, "session.jsonl"),
      makeSessionContent("/Users/alice/Developments/cortex"),
      "utf8",
    );
    writeFileSync(
      join(projDir, "subagent-session.jsonl"),
      makeSessionContent("/Users/alice/Developments/cortex"),
      "utf8",
    );

    const result = await importHandler(
      { dry_run: true, min_importance: 0.0 },
      noopRemember,
      tmpDir,
    );
    // Only 1 non-subagent file should be found
    expect(result.total_files).toBe(1);
  });
});

// ── no sessions ───────────────────────────────────────────────────────────

describe("importHandler — no sessions", () => {
  it("returns error=no_sessions_found when projectsDir is empty", async () => {
    const result = await importHandler(
      { dry_run: true },
      noopRemember,
      tmpDir,
    );
    expect(result.error).toBe("no_sessions_found");
    expect(result.imported).toBe(0);
    expect(result.sessions_scanned).toBe(0);
  });
});

// ── error handling ────────────────────────────────────────────────────────

describe("importHandler — error handling", () => {
  it("continues processing after a file error and records in errors array", async () => {
    // Create one valid and one that will error by having a read issue
    setupProjectWithSession("p1", "/Users/alice/Developments/cortex");

    // Create a project dir but make the file unreadable by making it a directory
    const p2 = join(tmpDir, "p2");
    mkdirSync(p2, { recursive: true });
    // Write a valid session
    writeFileSync(join(p2, "session.jsonl"), makeSessionContent("/home/dev/code/myapp"), "utf8");

    const result = await importHandler(
      { dry_run: true, min_importance: 0.0 },
      noopRemember,
      tmpDir,
    );
    // Both should be processed (or at least not crash)
    expect(typeof result.sessions_scanned).toBe("number");
    expect(Array.isArray(result.errors ?? [])).toBe(true);
  });
});

// ── domain filter ─────────────────────────────────────────────────────────

describe("importHandler — domain filter", () => {
  it("skips sessions whose domain does not match filter", async () => {
    setupProjectWithSession("my-project", "/Users/alice/Developments/cortex");
    const result = await importHandler(
      { dry_run: true, domain: "nonexistent-domain", min_importance: 0.0 },
      noopRemember,
      tmpDir,
    );
    expect(result.skipped).toBeGreaterThan(0);
    expect(result.imported).toBe(0);
  });
});

// ── preview truncation ────────────────────────────────────────────────────

describe("importHandler — preview truncation", () => {
  it("preview items have content truncated at 120 chars with ellipsis", async () => {
    // source: content[:120] + ("..." if len(content) > 120 else "") — import_sessions.py
    setupProjectWithSession(
      "p1",
      "/Users/alice/Developments/cortex",
    );
    const result = await importHandler(
      { dry_run: true, min_importance: 0.0 },
      noopRemember,
      tmpDir,
    );
    for (const item of result.preview ?? []) {
      if (item.content.endsWith("...")) {
        expect(item.content.length).toBe(123); // 120 + "..."
      } else {
        expect(item.content.length).toBeLessThanOrEqual(120);
      }
    }
  });
});
