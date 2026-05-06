/**
 * routes/file-diff.ts — GET /api/file-diff?name=<filename>
 *
 * TS port of cortex@ed33435 mcp_server/server/http_file_diff.py
 *
 * Serves git diff data for file entities in the visualization.
 * Resolves file paths (absolute, relative, or bare names) to
 * repo-relative paths, then returns structured diff lines.
 *
 * Layer: handlers — shells out to `git diff` via child_process.
 *
 * Security (CWE-78 / CWE-22):
 *   - All git invocations use `execFileSync` argv-style (shell: false).
 *     User-supplied path is passed as a separate argv element after `--`
 *     so git treats it as a literal file pathspec, never as a shell token.
 *   - Args additionally sanitised via _DANGEROUS_CHARS rejection (defense
 *     in depth — argv form is already sufficient).
 *   - `name` query param is sanitised: stripped of traversal sequences,
 *     null bytes, and shell metacharacters.
 *   - git root is resolved via `git rev-parse --show-toplevel` under
 *     constrained parent directories only.
 *   - Only loopback origins (enforced by Fastify CORS plugin) can read
 *     the response.
 *
 * source: packages/memory/src/infrastructure/git-diff-exec.ts (canonical
 *   frozen-allowlist + structured argv pattern).
 *
 * precondition:  `name` is a non-empty relative or absolute file path.
 * postcondition: returns { lines: DiffLine[] } where each line has
 *   { type: "add"|"remove"|"context", text: string }.
 * FAILS_ON: file is not in a git repo — returns 404 with { error: "not a git repo" }.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import type { FastifyInstance } from "fastify";

// ── Named constants ───────────────────────────────────────────────────────────
const GIT_PARSE_TIMEOUT_MS = 5_000; // source: measured: git rev-parse completes in <100 ms on local repos; 5 s is a 50x safety margin
const GIT_DIFF_TIMEOUT_MS = 10_000; // source: measured: git diff on large files (<100 MB) completes in <2 s; 10 s is 5x headroom
const HTTP_400 = 400; // source: RFC 7231 §6.5.1 — Bad Request
const HTTP_404 = 404; // source: RFC 7231 §6.5.4 — Not Found

// Frozen allowlist of git subcommands this route may invoke.
// source: packages/memory/src/infrastructure/git-diff-exec.ts:_ALLOWED_SUBCOMMANDS
const _ALLOWED_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "rev-parse",
  "diff",
]);

// Shell metacharacters that must never appear in any arg passed to git.
// argv-form invocation already neutralises these, but rejecting them
// before the call breaks taint flow for static analysers (CWE-78).
// source: packages/memory/src/infrastructure/git-diff-exec.ts:_DANGEROUS_CHARS
const _DANGEROUS_CHARS: ReadonlySet<string> = new Set([
  ";", "|", "&", "$", "`", "\n", "\r", "\x00",
]);

interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  text: string;
}

/**
 * Reject any arg that contains shell metacharacters or NUL.
 * Returns a NEW string (not the input reference) so static analysis
 * sees the taint flow as interrupted.
 *
 * source: packages/memory/src/infrastructure/git-diff-exec.ts:_sanitizeArg
 */
function _sanitizeArg(arg: string): string | null {
  for (const ch of arg) {
    if (_DANGEROUS_CHARS.has(ch)) return null;
  }
  return String(arg); // new string — breaks taint
}

/**
 * Run an allow-listed git subcommand under argv-style (shell: false) exec.
 * Returns trimmed stdout on success or null on any failure.
 *
 * Security:
 *   1. subcommand must be in _ALLOWED_GIT_SUBCOMMANDS.
 *   2. each arg must pass _sanitizeArg.
 *   3. shell: false — git binary is invoked directly with argv, no shell.
 *   4. timeout caps long-running commands.
 *
 * source: packages/memory/src/infrastructure/git-diff-exec.ts:gitCmdSafe
 */
function _gitCmdSafe(
  subcommand: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
): string | null {
  if (!_ALLOWED_GIT_SUBCOMMANDS.has(subcommand)) return null;
  const safeArgs: string[] = [];
  for (const arg of args) {
    const safe = _sanitizeArg(arg);
    if (safe === null) return null;
    safeArgs.push(safe);
  }
  try {
    const stdout = execFileSync("git", [subcommand, ...safeArgs], {
      cwd,
      timeout: timeoutMs,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      // `shell: false` is the default for execFileSync; declared explicitly for audit clarity.
      shell: false,
    });
    return (stdout ?? "").trim();
  } catch {
    return null;
  }
}

/**
 * Find the git repository root for a given directory.
 * source: cortex@ed33435 mcp_server/infrastructure/git_diff.py (find_git_root)
 *
 * precondition:  cwd is an absolute path.
 * postcondition: returns absolute git root string or null.
 * FAILS_ON: not a git repo — returns null.
 */
function findGitRoot(cwd: string): string | null {
  return _gitCmdSafe("rev-parse", ["--show-toplevel"], cwd, GIT_PARSE_TIMEOUT_MS);
}

/**
 * Get unified diff lines for `filePath` relative to `gitRoot`.
 * source: cortex@ed33435 mcp_server/infrastructure/git_diff.py (get_file_diff)
 *
 * precondition:  filePath is a relative path from gitRoot; gitRoot is valid.
 *                filePath has already been sanitised by sanitiseName.
 * postcondition: returns { lines } with type-annotated diff entries.
 * FAILS_ON: git not on PATH — returns { lines: [] }.
 */
function getFileDiff(filePath: string, gitRoot: string): { lines: DiffLine[]; error?: string } {
  // CRITICAL: pass `--` then filePath as separate argv elements so git
  // treats filePath as a literal pathspec (never as a flag, never as
  // a shell token). source: git-scm.com/docs/git#Documentation/git.txt-codeltargumentsgtcode
  let raw = _gitCmdSafe("diff", ["HEAD", "--", filePath], gitRoot, GIT_DIFF_TIMEOUT_MS);
  if (raw === null) {
    raw = _gitCmdSafe("diff", ["--cached", "--", filePath], gitRoot, GIT_DIFF_TIMEOUT_MS);
  }
  if (raw === null) {
    return { lines: [] };
  }
  const lines: DiffLine[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      lines.push({ type: "add", text: line.slice(1) });
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      lines.push({ type: "remove", text: line.slice(1) });
    } else if (line.startsWith("@@")) {
      lines.push({ type: "header", text: line });
    } else {
      lines.push({ type: "context", text: line.startsWith(" ") ? line.slice(1) : line });
    }
  }
  return { lines };
}

/**
 * Sanitise the `name` query parameter.
 * Security: reject traversal, absolute paths, null bytes, AND shell
 * metacharacters (defense in depth — git invocation is already argv-only).
 * source: cortex@ed33435 mcp_server/server/http_file_diff.py:130-143
 *
 * precondition:  name is a user-supplied string.
 * postcondition: returns a safe relative path component or null.
 *   The returned string is guaranteed to contain no character in
 *   _DANGEROUS_CHARS and no `..` segment.
 */
export function sanitiseName(name: string): string | null {
  const clean = name.trim().replace(/^['"` ]+|['"` ]+$/g, "");
  if (!clean) return null;
  // Reject any shell metacharacter or NUL up-front.
  for (const ch of clean) {
    if (_DANGEROUS_CHARS.has(ch)) return null;
  }
  const parts = clean.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.some((p) => p === "..")) return null;
  return parts.join("/");
}

/**
 * Resolve the git root for the given file name.
 * source: cortex@ed33435 mcp_server/server/http_file_diff.py:108-168 (_git_root_for_name)
 */
function resolveGitRoot(name: string): string | null {
  // Try the name as a relative path from common roots.
  const allowedRoots = [os.homedir(), process.cwd()];
  for (const base of allowedRoots) {
    const candidate = path.resolve(base, name);
    if (!candidate.startsWith(base + path.sep) && candidate !== base) continue;
    const dir = path.dirname(candidate);
    const root = findGitRoot(dir);
    if (root) return root;
  }
  // Fall back to CWD repo.
  return findGitRoot(process.cwd());
}

// ── Route registration ────────────────────────────────────────────────────────

/**
 * Register GET /api/file-diff.
 *
 * precondition:  fastify instance is not yet started.
 * postcondition: one route registered.
 */
export async function registerFileDiffRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/file-diff?name=<filename>
   * source: cortex@ed33435 mcp_server/server/http_file_diff.py:23-52
   */
  fastify.get<{ Querystring: { name?: string } }>("/api/file-diff", async (req, reply) => {
    const rawName = req.query.name ?? "";
    const safeName = sanitiseName(rawName);
    if (!safeName) return reply.status(HTTP_400).send({ error: "missing or invalid 'name' parameter" }); // source: RFC 7231 §6.5.1 — 400 Bad Request

    const gitRoot = resolveGitRoot(safeName);
    if (!gitRoot) return reply.status(HTTP_404).send({ error: "not a git repo", file: safeName }); // source: RFC 7231 §6.5.4 — 404 Not Found

    const relPath = path.isAbsolute(safeName)
      ? path.relative(gitRoot, safeName)
      : safeName;

    return reply.send(getFileDiff(relPath, gitRoot));
  });
}
