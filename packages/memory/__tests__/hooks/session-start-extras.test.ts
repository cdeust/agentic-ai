/**
 * session-start extras — unit tests for functions ported in Eng-13.
 *
 * Tests the four functions that were missing from the TS port:
 *   - trySetupDb()
 *   - autoBackfill()
 *   - autoWirePipeline()
 *   - lookupCachedGraphPath()
 *   - countSessionFiles()
 *   - detectExternalSources()
 *
 * Invariants tested:
 *   1. trySetupDb() returns null when pluginRoot is empty.
 *   2. trySetupDb() returns null when spawnSync fails or returns empty stdout.
 *   3. autoBackfill() returns 0 when pluginRoot is empty.
 *   4. autoWirePipeline() returns without throwing when pluginRoot is empty.
 *   5. lookupCachedGraphPath() returns null when DB is unreachable.
 *   6. countSessionFiles() returns 0 when the projects dir does not exist.
 *   7. detectExternalSources() returns an array (may be empty) without throwing.
 *   8. buildColdStartMessage skips auto-backfill section when count is 0.
 *   9. buildColdStartMessage includes auto-imported count when > 0.
 *
 * source: cortex@ed33435 mcp_server/hooks/session_start.py
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock node:child_process so spawnSync never actually runs Python.
vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(() => ({ stdout: "", stderr: "", status: 1 })),
  spawn: vi.fn(() => ({
    unref: vi.fn(),
  })),
}));

// Mock pg so lookupCachedGraphPath never connects to a real DB.
vi.mock("pg", () => ({
  default: {
    Client: vi.fn().mockImplementation(() => ({
      connect: vi.fn().mockRejectedValue(new Error("no DB in test")),
      end: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

// Mock node:fs — override existsSync / readdirSync / statSync for tests.
import * as fs from "node:fs";
type FsModule = typeof fs;
vi.mock("node:fs", async (importOriginal: () => Promise<FsModule>) => {
  const original = await importOriginal();
  return {
    ...original,
    existsSync: vi.fn(original.existsSync),
    readdirSync: vi.fn(original.readdirSync),
    statSync: vi.fn(original.statSync),
  };
});

import {
  trySetupDb,
  autoBackfill,
  autoWirePipeline,
  lookupCachedGraphPath,
  countSessionFiles,
  detectExternalSources,
} from "../../src/hooks/session-start.js";

import {
  buildColdStartMessage,
} from "../../src/hooks/session-start-context.js";

import { spawnSync } from "node:child_process";

const mockedSpawnSync = vi.mocked(spawnSync);
const mockedExistsSync = vi.mocked(fs.existsSync);
const mockedReaddirSync = vi.mocked(fs.readdirSync);
const mockedStatSync = vi.mocked(fs.statSync);

// ── Setup / teardown ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: CLAUDE_PLUGIN_ROOT is empty (no plugin installed).
  delete process.env["CLAUDE_PLUGIN_ROOT"];
  delete process.env["DATABASE_URL"];
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── trySetupDb ────────────────────────────────────────────────────────────

describe("trySetupDb", () => {
  it("returns null when CLAUDE_PLUGIN_ROOT is not set", () => {
    const result = trySetupDb();
    expect(result).toBeNull();
    expect(mockedSpawnSync).not.toHaveBeenCalled();
  });

  it("returns null when setup script does not exist at pluginRoot", () => {
    process.env["CLAUDE_PLUGIN_ROOT"] = "/nonexistent/path";
    mockedExistsSync.mockReturnValue(false);

    const result = trySetupDb();
    expect(result).toBeNull();
  });

  it("returns null when spawnSync produces empty stdout", () => {
    process.env["CLAUDE_PLUGIN_ROOT"] = "/fake/root";
    mockedExistsSync.mockReturnValue(true);
    mockedSpawnSync.mockReturnValue({
      stdout: "",
      stderr: "",
      status: 0,
      pid: 1234,
      output: [],
      signal: null,
      error: undefined,
    });

    const result = trySetupDb();
    expect(result).toBeNull();
  });

  it("returns parsed JSON from spawnSync stdout when valid", () => {
    process.env["CLAUDE_PLUGIN_ROOT"] = "/fake/root";
    // existsSync must return true for the setup script path check.
    mockedExistsSync.mockImplementation((p: unknown) =>
      String(p).includes("setup_db.py"),
    );
    mockedSpawnSync.mockReturnValue({
      stdout: JSON.stringify({ status: "ready", memories: 42 }),
      stderr: "",
      status: 0,
      pid: 1234,
      output: [],
      signal: null,
      error: undefined,
    });

    const result = trySetupDb();
    expect(result).not.toBeNull();
    expect(result?.status).toBe("ready");
    expect(result?.memories).toBe(42);
  });
});

// ── autoBackfill ──────────────────────────────────────────────────────────

describe("autoBackfill", () => {
  it("returns 0 when CLAUDE_PLUGIN_ROOT is not set", () => {
    const count = autoBackfill();
    expect(count).toBe(0);
    expect(mockedSpawnSync).not.toHaveBeenCalled();
  });

  it("returns 0 when spawnSync fails (non-zero exit)", () => {
    process.env["CLAUDE_PLUGIN_ROOT"] = "/fake/root";
    mockedSpawnSync.mockReturnValue({
      stdout: "",
      stderr: "error",
      status: 1,
      pid: 1234,
      output: [],
      signal: null,
      error: undefined,
    });

    const count = autoBackfill();
    expect(count).toBe(0);
  });

  it("returns backfilled count from JSON stdout", () => {
    process.env["CLAUDE_PLUGIN_ROOT"] = "/fake/root";
    mockedSpawnSync.mockReturnValue({
      stdout: JSON.stringify({ backfilled: 17, cascade_advanced: 3 }),
      stderr: "",
      status: 0,
      pid: 1234,
      output: [],
      signal: null,
      error: undefined,
    });

    const count = autoBackfill();
    expect(count).toBe(17);
  });
});

// ── autoWirePipeline ──────────────────────────────────────────────────────

describe("autoWirePipeline", () => {
  it("does not throw and does not call spawnSync when pluginRoot is empty", () => {
    expect(() => autoWirePipeline()).not.toThrow();
    expect(mockedSpawnSync).not.toHaveBeenCalled();
  });

  it("calls spawnSync when pluginRoot is set and does not throw", () => {
    process.env["CLAUDE_PLUGIN_ROOT"] = "/fake/root";
    mockedSpawnSync.mockReturnValue({
      stdout: JSON.stringify({ action: "already_present" }),
      stderr: "",
      status: 0,
      pid: 1234,
      output: [],
      signal: null,
      error: undefined,
    });

    // autoWirePipeline reads pluginRoot at call time (Eng-13 fix).
    expect(() => autoWirePipeline()).not.toThrow();
    // spawnSync is called with python3 -c to run pipeline_discovery.
    expect(mockedSpawnSync).toHaveBeenCalledWith(
      "python3",
      expect.arrayContaining(["-c", expect.any(String)]),
      expect.objectContaining({ encoding: "utf-8" }),
    );
  });

  it("does not throw when spawnSync throws", () => {
    process.env["CLAUDE_PLUGIN_ROOT"] = "/fake/root";
    mockedSpawnSync.mockImplementation(() => {
      throw new Error("spawnSync exploded");
    });

    expect(() => autoWirePipeline()).not.toThrow();
  });
});

// ── lookupCachedGraphPath ─────────────────────────────────────────────────

describe("lookupCachedGraphPath", () => {
  it("returns null when DB connection fails (pg import rejected)", async () => {
    const result = await lookupCachedGraphPath("/some/project");
    expect(result).toBeNull();
  });

  it("returns null for empty project root", async () => {
    const result = await lookupCachedGraphPath("");
    expect(result).toBeNull();
  });
});

// ── countSessionFiles ─────────────────────────────────────────────────────

describe("countSessionFiles", () => {
  it("returns 0 when the projects directory does not exist", () => {
    mockedExistsSync.mockReturnValue(false);
    const count = countSessionFiles();
    expect(count).toBe(0);
  });

  it("counts .jsonl files across project subdirectories", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockImplementation((path: unknown) => {
      if (String(path).endsWith("projects")) {
        return ["project-a", "project-b"] as unknown as ReturnType<typeof fs.readdirSync>;
      }
      if (String(path).endsWith("project-a")) {
        return ["session1.jsonl", "session2.jsonl"] as unknown as ReturnType<typeof fs.readdirSync>;
      }
      if (String(path).endsWith("project-b")) {
        return ["session3.jsonl"] as unknown as ReturnType<typeof fs.readdirSync>;
      }
      return [] as unknown as ReturnType<typeof fs.readdirSync>;
    });
    mockedStatSync.mockReturnValue({ isDirectory: () => true } as unknown as ReturnType<typeof fs.statSync>);

    const count = countSessionFiles();
    expect(count).toBe(3);
  });
});

// ── detectExternalSources ─────────────────────────────────────────────────

describe("detectExternalSources", () => {
  it("returns empty array when no external sources are present", () => {
    mockedExistsSync.mockReturnValue(false);
    const sources = detectExternalSources();
    expect(Array.isArray(sources)).toBe(true);
    expect(sources.length).toBe(0);
  });

  it("includes claude-mem when the SQLite file exists", () => {
    mockedExistsSync.mockImplementation((p: unknown) =>
      String(p).includes("claude-mem.db"),
    );
    const sources = detectExternalSources();
    const claudeMem = sources.find((s) => s.name === "claude-mem");
    expect(claudeMem).toBeDefined();
  });

  it("does not throw when readdirSync throws inside Cursor detection", () => {
    mockedExistsSync.mockImplementation((p: unknown) =>
      String(p).includes(".cursor"),
    );
    mockedReaddirSync.mockImplementation(() => {
      throw new Error("permission denied");
    });

    expect(() => detectExternalSources()).not.toThrow();
  });
});

// ── buildColdStartMessage (session-start-context) ─────────────────────────

describe("buildColdStartMessage — auto-backfill path", () => {
  it("shows auto-imported count when > 0", () => {
    const msg = buildColdStartMessage(
      { status: "ready", memories: 0, session_files: 5 },
      17,
    );
    expect(msg).toContain("auto-imported");
    expect(msg).toContain("17 memories");
  });

  it("shows setup-ready message when auto-backfill imported 0", () => {
    const msg = buildColdStartMessage(
      { status: "ready", memories: 0, session_files: 5 },
      0,
    );
    expect(msg).toContain("Auto-import found no memorable items");
  });

  it("shows install instructions when status is needs_install", () => {
    const msg = buildColdStartMessage({ status: "needs_install" }, undefined);
    expect(msg).toContain("brew install postgresql@17");
  });
});
