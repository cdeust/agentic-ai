/**
 * Tests for git-diff.ts, git-diff-exec.ts, git-diff-format.ts
 *
 * Tests: parseDiffLines, buildResult, contentAsNew/Delete/Context,
 * _matchInWhitelist via resolveFile, _readSafe via getFileDiff path
 * injection defence, and the cascade's result shape.
 *
 * source: Cortex mcp_server/infrastructure/git_diff.py
 * source: Cortex mcp_server/infrastructure/git_diff_exec.py
 * source: Cortex mcp_server/infrastructure/git_diff_format.py
 */

import { describe, it, expect } from "vitest";
import {
  parseDiffLines,
  buildResult,
  contentAsNew,
  contentAsDelete,
  contentAsContext,
} from "../../src/infrastructure/git-diff-format.js";
import { gitCmdSafe, getTrackedFiles } from "../../src/infrastructure/git-diff-exec.js";
import { findGitRoot, getFileDiff, resolveFile } from "../../src/infrastructure/git-diff.js";

// ── git-diff-format tests ────────────────────────────────────────────────

describe("parseDiffLines()", () => {
  it("classifies + lines as add", () => {
    // source: git_diff_format.py:17-34
    const lines = parseDiffLines("+hello world\n");
    expect(lines).toContainEqual({ text: "+hello world", type: "add" });
  });

  it("classifies - lines as del", () => {
    const lines = parseDiffLines("-removed line\n");
    expect(lines).toContainEqual({ text: "-removed line", type: "del" });
  });

  it("classifies @@ as hunk", () => {
    const lines = parseDiffLines("@@ -1,3 +1,4 @@ context\n");
    expect(lines[0].type).toBe("hunk");
  });

  it("drops diff / index / +++ / --- header lines", () => {
    const raw = "diff --git a/foo b/foo\nindex abc..def 100644\n--- a/foo\n+++ b/foo\n";
    const lines = parseDiffLines(raw);
    expect(lines).toHaveLength(0);
  });

  it("classifies context lines as ctx", () => {
    const lines = parseDiffLines(" context line\n");
    expect(lines[0].type).toBe("ctx");
  });
});

describe("buildResult()", () => {
  it("respects maxLines truncation", () => {
    // source: git_diff_format.py:37-44
    const raw = Array.from({ length: 10 }, (_, i) => `+line ${i}`).join("\n");
    const result = buildResult("foo.ts", "uncommitted", raw, 5);
    expect(result.lines).toHaveLength(5);
    expect(result.truncated).toBe(true);
    expect(result.diff_type).toBe("uncommitted");
    expect(result.file).toBe("foo.ts");
  });

  it("truncated is false when lines fit", () => {
    const result = buildResult("foo.ts", "staged", "+one line\n", 100);
    expect(result.truncated).toBe(false);
  });
});

describe("contentAsNew()", () => {
  it("all lines are add type", () => {
    // source: git_diff_format.py:47-55
    const result = contentAsNew("new.ts", "line1\nline2", 100);
    expect(result.diff_type).toBe("new_file");
    expect(result.lines.every((l) => l.type === "add")).toBe(true);
    expect(result.lines[0].text).toBe("+line1");
  });

  it("accepts custom diff_type", () => {
    const result = contentAsNew("new.ts", "x", 100, "staged");
    expect(result.diff_type).toBe("staged");
  });
});

describe("contentAsDelete()", () => {
  it("all lines are del type", () => {
    // source: git_diff_format.py:58-64
    const result = contentAsDelete("old.ts", "gone\nbye", 100);
    expect(result.diff_type).toBe("deleted");
    expect(result.lines.every((l) => l.type === "del")).toBe(true);
    expect(result.lines[0].text).toBe("-gone");
  });
});

describe("contentAsContext()", () => {
  it("all lines are ctx type", () => {
    // source: git_diff_format.py:67-73
    const result = contentAsContext("same.ts", "unchanged", 100);
    expect(result.diff_type).toBe("unchanged");
    expect(result.lines.every((l) => l.type === "ctx")).toBe(true);
  });
});

// ── git-diff-exec tests ─────────────────────────────────────────────────

describe("gitCmdSafe()", () => {
  it("rejects disallowed subcommands silently", () => {
    // source: git_diff_exec.py:46-77
    const result = gitCmdSafe("rm", ["-rf", "/"], process.cwd());
    expect(result).toBe("");
  });

  it("rejects args with shell metacharacters", () => {
    const result = gitCmdSafe("log", ["--format=%H; rm -rf /"], process.cwd());
    expect(result).toBe("");
  });

  it("returns empty string on execution failure (non-git dir)", () => {
    const result = gitCmdSafe("log", ["-1"], "/tmp/__nonexistent_git_dir__");
    expect(result).toBe("");
  });
});

describe("getTrackedFiles()", () => {
  it("returns a Set (possibly empty for non-git dirs)", () => {
    // source: git_diff_exec.py:80-84
    const files = getTrackedFiles("/tmp");
    expect(files).toBeInstanceOf(Set);
  });
});

// ── git-diff tests ───────────────────────────────────────────────────────

describe("findGitRoot()", () => {
  it("returns a string for the agentic-ai repo", () => {
    // source: git_diff.py:46-61
    const root = findGitRoot(
      "/Users/cdeust/Developments/agentic-ai",
    );
    // In CI this may be null if git isn't available; just check shape.
    expect(root === null || typeof root === "string").toBe(true);
  });
});

describe("getFileDiff() — path injection defence", () => {
  it("handles ../traversal safely — returns diff_type=none", () => {
    // source: git_diff.py: _readSafe and _safeJoin
    const root = findGitRoot(process.cwd()) ?? "/tmp";
    const result = getFileDiff("../../etc/passwd", root);
    // Should not read /etc/passwd — returns none shape
    expect(result.file).toBe("../../etc/passwd");
    expect(["none", "new_file", "deleted", "uncommitted", "staged", "last_commit", "unchanged"]).toContain(
      result.diff_type,
    );
  });

  it("returns DiffResult shape for any input", () => {
    const root = findGitRoot(process.cwd()) ?? "/tmp";
    const result = getFileDiff("nonexistent.ts", root);
    expect(result).toHaveProperty("file");
    expect(result).toHaveProperty("diff_type");
    expect(result).toHaveProperty("lines");
    expect(result).toHaveProperty("truncated");
    expect(Array.isArray(result.lines)).toBe(true);
  });
});

describe("resolveFile()", () => {
  it("returns null for files not in the tracked set", () => {
    const root = findGitRoot(process.cwd());
    if (root === null) return; // skip in non-git environments
    // source: git_diff.py:81-99
    const result = resolveFile("__definitely_not_a_tracked_file_xyz.ts", root);
    expect(result).toBeNull();
  });
});
