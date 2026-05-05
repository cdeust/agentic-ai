/**
 * Git diff retrieval for file entities.
 *
 * Runs git commands to fetch diff data for files referenced in the
 * knowledge graph. Uses a proper cascade: working tree → staged → last
 * commit → file content at HEAD → historical lookup.
 *
 * Infrastructure layer — I/O via subprocess. The subprocess boundary and
 * argument sanitisation live in git-diff-exec; the result-formatting
 * helpers live in git-diff-format; this module owns the cascade and
 * the whitelist-matching policy.
 *
 * Security (CWE-22 / path-injection):
 *
 *   * _matchInWhitelist always returns a string drawn from the
 *     ``tracked`` set (``git ls-files`` output). It never returns the
 *     user-supplied name, even when they are equal. This explicitly
 *     breaks the taint flow so downstream uses of the returned path are
 *     sanitised.
 *   * _safeJoin uses path.resolve + startsWith(root + sep)
 *     containment — the canonical pattern recognised as a sanitiser
 *     for path-injection.
 *   * Every direct filesystem probe (existsSync, readFileSync)
 *     goes through _safeJoin.
 *
 * source: Cortex mcp_server/infrastructure/git_diff.py
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as nodePath from "node:path";
import {
  _GIT_BINARY,
  getTrackedFiles,
  gitCmdSafe,
} from "./git-diff-exec.js";
import {
  buildResult,
  contentAsContext,
  contentAsDelete,
  contentAsNew,
  type DiffResult,
} from "./git-diff-format.js";

// ── Git root detection ─────────────────────────────────────────────────

/**
 * Find the nearest git repository root.
 * source: git_diff.py:46-61
 */
export function findGitRoot(start?: string): string | null {
  try {
    const result = execFileSync(
      _GIT_BINARY,
      ["rev-parse", "--show-toplevel"],
      {
        cwd: start ?? process.cwd(),
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 5_000,
        shell: false,
      },
    );
    return result.trim() || null;
  } catch {
    return null;
  }
}

// ── Whitelist matching ─────────────────────────────────────────────────

/**
 * Match a user-provided name against the git-tracked whitelist.
 *
 * Returns the canonical tracked path or null if no match. To
 * break the taint flow from the caller's user-controlled ``name``,
 * every return path yields a string drawn from ``tracked`` (the
 * output of ``git ls-files``) — never ``name`` itself, even when
 * equality holds. This is what allows static analysers to see the
 * whitelist as a proper sanitiser.
 *
 * source: git_diff.py:64-78
 */
function _matchInWhitelist(name: string, tracked: Set<string>): string | null {
  const basename = name.includes("/") ? name.split("/").at(-1)! : name;
  for (const t of tracked) {
    if (t === name || t === basename || t.endsWith("/" + basename)) {
      return t; // return canonical tracked path, never the user-supplied name
    }
  }
  return null;
}

/**
 * Resolve a file name to a repo-relative path via the tracked whitelist.
 * source: git_diff.py:81-99
 */
export function resolveFile(name: string, gitRoot: string): string | null {
  let clean = name.trim().replace(/^["'`]|["'`]$/g, "");
  try {
    if (nodePath.isAbsolute(clean)) {
      clean = nodePath.relative(gitRoot, clean);
    }
  } catch {
    // ignore
  }

  const tracked = getTrackedFiles(gitRoot);
  const match = _matchInWhitelist(clean, tracked);
  if (match) return match;

  const staged = gitCmdSafe("diff", ["--staged", "--name-only"], gitRoot);
  if (staged) {
    return _matchInWhitelist(clean, new Set(staged.split("\n").filter(Boolean)));
  }
  return null;
}

// ── Path-injection sanitiser ───────────────────────────────────────────

/**
 * Join ``relative`` onto ``root`` and confirm the result stays inside.
 *
 * Uses path.resolve on both arguments and checks the canonical
 * containment startsWith(root + sep). This is the pattern CodeQL's
 * py/path-injection query recognises as a sanitiser. Returns the
 * resolved path string or null when the join would escape root.
 *
 * source: git_diff.py:102-118
 */
function _safeJoin(root: string, relative: string): string | null {
  try {
    const rootReal = nodePath.resolve(root);
    const joinedReal = nodePath.resolve(root, relative);
    if (
      joinedReal !== rootReal &&
      !joinedReal.startsWith(rootReal + nodePath.sep)
    ) {
      return null;
    }
    return joinedReal;
  } catch {
    return null;
  }
}

/**
 * Read a file inside gitRoot safely. Returns null for anything outside.
 *
 * CWE-22 defence (path-injection sanitizer):
 *   1. Reject any relative path that is absolute or contains .. segments.
 *   2. Resolve both base and target via path.resolve.
 *   3. startsWith(base + sep) — the containment check. If false we abort.
 *
 * source: git_diff.py:121-153
 */
function _readSafe(gitRoot: string, relative: string): string | null {
  try {
    // Step 1: string-level rejection — catches both absolute inputs
    // and any .. traversal segments before they touch the FS.
    if (!relative || nodePath.isAbsolute(relative) || relative.includes("\x00")) {
      return null;
    }
    const parts = relative.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.some((p) => p === "..")) return null;

    // Step 2: resolve both paths to absolute, canonical form.
    const base = nodePath.resolve(gitRoot);
    const target = nodePath.resolve(base, ...parts);

    // Step 3: containment check.
    if (target !== base && !target.startsWith(base + nodePath.sep)) {
      return null;
    }
    if (!existsSync(target) || !statSync(target).isFile()) return null;
    return readFileSync(target, { encoding: "utf8" });
  } catch {
    return null;
  }
}

// ── Cascade logic ──────────────────────────────────────────────────────

/**
 * Run the working-tree → staged → deleted → last-commit → clean cascade.
 * source: git_diff.py:156-204
 */
function _cascadeForTracked(
  safePath: string,
  tracked: Set<string>,
  stagedFiles: Set<string>,
  gitRoot: string,
  maxLines: number,
): DiffResult {
  let raw = gitCmdSafe("diff", ["--", safePath], gitRoot);
  if (raw) return buildResult(safePath, "uncommitted", raw, maxLines);

  raw = gitCmdSafe("diff", ["--staged", "--", safePath], gitRoot);
  if (raw) return buildResult(safePath, "staged", raw, maxLines);

  // _safeJoin re-validates containment so the path-probe below is
  // provably inside the repo root (silences path-injection warnings).
  const absCheck = _safeJoin(gitRoot, safePath);
  if (absCheck === null) {
    return {
      file: safePath,
      diff_type: "none",
      lines: [],
      truncated: false,
      reason: "path escaped repo root — refusing to resolve",
    };
  }

  if (tracked.has(safePath) && !existsSync(absCheck)) {
    const content = gitCmdSafe("show", ["HEAD:" + safePath], gitRoot);
    if (content) return contentAsDelete(safePath, content, maxLines);
  }

  raw = gitCmdSafe("log", ["-1", "-p", "--format=", "--", safePath], gitRoot);
  if (raw) return buildResult(safePath, "last_commit", raw, maxLines);

  if (stagedFiles.has(safePath) && !tracked.has(safePath)) {
    const wt = _readSafe(gitRoot, safePath);
    if (wt !== null) return contentAsNew(safePath, wt, maxLines, "staged");
  }

  const content = gitCmdSafe("show", ["HEAD:" + safePath], gitRoot);
  if (content) return contentAsContext(safePath, content, maxLines);

  return {
    file: safePath,
    diff_type: "unchanged",
    lines: [],
    truncated: false,
    reason:
      "tracked by git but no content retrievable (submodule or LFS pointer)",
  };
}

function _stagedFilesSet(gitRoot: string): Set<string> {
  /** Return the set of paths currently staged for commit.
   * source: git_diff.py:207-210
   */
  const raw = gitCmdSafe("diff", ["--staged", "--name-only"], gitRoot);
  return raw ? new Set(raw.split("\n").filter(Boolean)) : new Set();
}

/**
 * Cascade: tracked → untracked → historical; always non-empty result.
 *
 * Security: filepath is validated against the tracked + staged
 * whitelist. Direct filesystem reads only happen for files confirmed
 * by git, or for untracked files inside gitRoot (_readSafe uses
 * path.resolve + startsWith to block traversal).
 *
 * source: git_diff.py:213-240
 */
export function getFileDiff(
  filepath: string,
  gitRoot: string,
  maxLines = 80,
): DiffResult {
  const tracked = getTrackedFiles(gitRoot);
  const stagedFiles = _stagedFilesSet(gitRoot);
  const safePath = _matchInWhitelist(
    filepath,
    new Set([...tracked, ...stagedFiles]),
  );
  if (safePath) {
    return _cascadeForTracked(safePath, tracked, stagedFiles, gitRoot, maxLines);
  }

  const wt = _readSafe(gitRoot, filepath);
  if (wt !== null) return contentAsNew(filepath, wt, maxLines);

  const historical = _lookupHistorical(filepath, gitRoot, maxLines);
  if (historical !== null) return historical;

  return {
    file: filepath,
    diff_type: "none",
    lines: [],
    truncated: false,
    reason: "file not tracked, not present, and absent from all git history",
  };
}

// ── Historical lookup (three tiers) ───────────────────────────────────

/**
 * Given the last commit touching the path, return it + its parent.
 * source: git_diff.py:243-251
 */
function _tier1Candidates(sha: string): string[] {
  if (!sha) return [];
  return [sha, sha + "^"];
}

/**
 * source: git_diff.py:254-257
 */
function _deletedResult(
  filepath: string,
  content: string,
  maxLines: number,
  sha: string,
): DiffResult {
  const r = contentAsDelete(filepath, content, maxLines);
  return { ...r, reason: `deleted — recovered from commit ${sha.slice(0, 8)}` };
}

/**
 * Return a deleted_result for sha:filepath if git can show it.
 * source: git_diff.py:260-265
 */
function _tryHistoricalSha(
  filepath: string,
  gitRoot: string,
  sha: string,
  maxLines: number,
): DiffResult | null {
  const content = gitCmdSafe("show", [sha + ":" + filepath], gitRoot);
  if (content) return _deletedResult(filepath, content, maxLines, sha);
  return null;
}

/**
 * Tier 1: last commit touching path (follow renames) + its parent.
 * source: git_diff.py:268-282
 */
function _lookupTier1(
  filepath: string,
  gitRoot: string,
  maxLines: number,
): [DiffResult | null, string] {
  const lastSha = gitCmdSafe(
    "log",
    ["-1", "--all", "--follow", "--format=%H", "--", filepath],
    gitRoot,
  );
  for (const candidate of _tier1Candidates(lastSha)) {
    const hit = _tryHistoricalSha(filepath, gitRoot, candidate, maxLines);
    if (hit !== null) return [hit, lastSha];
  }
  return [null, lastSha];
}

/**
 * Tier 2: explicit last non-deletion commit (!D filter).
 * source: git_diff.py:285-296
 */
function _lookupTier2(
  filepath: string,
  gitRoot: string,
  lastSha: string,
  maxLines: number,
): DiffResult | null {
  const aliveSha = gitCmdSafe(
    "log",
    ["-1", "--all", "--diff-filter=!D", "--format=%H", "--", filepath],
    gitRoot,
  );
  if (aliveSha && aliveSha !== lastSha) {
    return _tryHistoricalSha(filepath, gitRoot, aliveSha, maxLines);
  }
  return null;
}

/**
 * Tier 3: walk full history (cap 50) until one sha yields content.
 * source: git_diff.py:299-315
 */
function _lookupTier3(
  filepath: string,
  gitRoot: string,
  maxLines: number,
): DiffResult | null {
  const allShas = gitCmdSafe(
    "log",
    ["--all", "--follow", "--format=%H", "--", filepath],
    gitRoot,
  );
  if (!allShas) return null;
  for (const shaLine of allShas.split("\n").slice(0, 50)) {
    const sha = shaLine.trim();
    if (!sha) continue;
    const hit = _tryHistoricalSha(filepath, gitRoot, sha, maxLines);
    if (hit !== null) return hit;
  }
  return null;
}

/**
 * Three-tier historical lookup for deleted / renamed paths.
 * source: git_diff.py:319-327
 */
function _lookupHistorical(
  filepath: string,
  gitRoot: string,
  maxLines: number,
): DiffResult | null {
  const [hit1, lastSha] = _lookupTier1(filepath, gitRoot, maxLines);
  if (hit1 !== null) return hit1;
  const hit2 = _lookupTier2(filepath, gitRoot, lastSha, maxLines);
  if (hit2 !== null) return hit2;
  return _lookupTier3(filepath, gitRoot, maxLines);
}
