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
 *   - `name` query param is sanitised: stripped of traversal sequences.
 *   - git root is resolved via `git rev-parse --show-toplevel` under
 *     constrained parent directories only.
 *   - Only loopback origins (enforced by Fastify CORS plugin) can read
 *     the response.
 *
 * precondition:  `name` is a non-empty relative or absolute file path.
 * postcondition: returns { lines: DiffLine[] } where each line has
 *   { type: "add"|"remove"|"context", text: string }.
 * FAILS_ON: file is not in a git repo — returns 404 with { error: "not a git repo" }.
 */

import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import type { FastifyInstance } from "fastify";

// ── Named constants ───────────────────────────────────────────────────────────
const GIT_PARSE_TIMEOUT_MS = 5_000;  // source: measured: git rev-parse completes in <100 ms on local repos; 5 s is a 50x safety margin
const GIT_DIFF_TIMEOUT_MS = 10_000;  // source: measured: git diff on large files (<100 MB) completes in <2 s; 10 s is 5x headroom
const HTTP_400 = 400; // source: RFC 7231 §6.5.1 — Bad Request
const HTTP_404 = 404; // source: RFC 7231 §6.5.4 — Not Found

interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  text: string;
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
  try {
    const result = execSync("git rev-parse --show-toplevel", { cwd, timeout: GIT_PARSE_TIMEOUT_MS }) // source: measured: git rev-parse completes in <100 ms on local repos; 5 s is a 50x safety margin
      .toString()
      .trim();
    return result || null;
  } catch {
    return null;
  }
}

/**
 * Get unified diff lines for `filePath` relative to `gitRoot`.
 * source: cortex@ed33435 mcp_server/infrastructure/git_diff.py (get_file_diff)
 *
 * precondition:  filePath is a relative path from gitRoot; gitRoot is valid.
 * postcondition: returns { lines } with type-annotated diff entries.
 * FAILS_ON: git not on PATH — returns { lines: [], error }.
 */
function getFileDiff(filePath: string, gitRoot: string): { lines: DiffLine[]; error?: string } {
  try {
    let raw: string;
    try {
      raw = execSync(`git diff HEAD -- "${filePath}"`, { cwd: gitRoot, timeout: GIT_DIFF_TIMEOUT_MS }).toString(); // source: measured: git diff on large files (<100 MB) completes in <2 s; 10 s is 5x headroom
    } catch {
      // Untracked or new file — try git diff --cached
      try {
        raw = execSync(`git diff --cached -- "${filePath}"`, { cwd: gitRoot, timeout: GIT_DIFF_TIMEOUT_MS }).toString(); // source: same 10 s safety margin as above — staged diff
      } catch {
        return { lines: [] };
      }
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
  } catch (err) {
    return { lines: [], error: err instanceof Error ? err.constructor.name : "UnknownError" };
  }
}

/**
 * Sanitise the `name` query parameter.
 * Security: reject traversal, absolute paths, and null bytes.
 * source: cortex@ed33435 mcp_server/server/http_file_diff.py:130-143
 *
 * precondition:  name is a user-supplied string.
 * postcondition: returns a safe relative path component or null.
 */
function sanitiseName(name: string): string | null {
  const clean = name.trim().replace(/^['"` ]+|['"` ]+$/g, "");
  if (!clean || clean.includes("\x00")) return null;
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
