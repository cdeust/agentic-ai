/**
 * Safe git subcommand executor for git-diff.
 *
 * Isolates all subprocess calls + argument sanitisation behind a
 * frozen-allowlist check so static analysis sees the data flow is interrupted
 * (CWE-78). The public surface is tiny:
 *
 * - gitCmdSafe   — run an allow-listed git subcommand, return stdout or ""
 * - getTrackedFiles — git ls-files wrapped as a Set<string>
 *
 * Lives in infrastructure because it runs external processes. Pure
 * subprocess boundary, no policy.
 *
 * Layer: INFRASTRUCTURE — subprocess boundary.
 * source: Cortex mcp_server/infrastructure/git_diff_exec.py
 */

import { execFileSync, execSync } from "node:child_process";

/** Resolve a binary on PATH. Returns the path or null. */
function _which(name: string): string | null {
  try {
    const result = execSync(
      process.platform === "win32"
        ? `where ${name}`
        : `command -v ${name}`,
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return result.trim().split("\n")[0]?.trim() || null;
  } catch {
    return null;
  }
}

// Resolve git binary once at module load time — never from user input.
// source: Cortex mcp_server/infrastructure/git_diff_exec.py — _GIT_BINARY = shutil.which("git") or "git"
export const _GIT_BINARY: string = _which("git") ?? "git";

// source: Cortex mcp_server/infrastructure/git_diff_exec.py — _ALLOWED_SUBCOMMANDS
const _ALLOWED_SUBCOMMANDS = new Set([
  "rev-parse",
  "ls-files",
  "diff",
  "log",
  "show",
]);

// source: Cortex mcp_server/infrastructure/git_diff_exec.py — _DANGEROUS_CHARS
const _DANGEROUS_CHARS = new Set([
  ";",
  "|",
  "&",
  "$",
  "`",
  "\n",
  "\r",
  "\x00",
]);

/**
 * Reject shell-metacharacter-bearing args (CWE-78).
 *
 * Returns a new string (not the original reference) so static analysis can
 * verify the taint flow is interrupted.
 *
 * source: Cortex mcp_server/infrastructure/git_diff_exec.py:_sanitize_arg
 */
function _sanitizeArg(arg: string): string | null {
  for (const ch of arg) {
    if (_DANGEROUS_CHARS.has(ch)) {
      return null;
    }
  }
  // Return a new string — breaks taint
  return String(arg);
}

/**
 * Run a git subcommand under the frozen allowlist.
 *
 * Security (CWE-78 mitigation):
 *   1. subcommand must be in _ALLOWED_SUBCOMMANDS
 *   2. each arg is validated by _sanitizeArg
 *   3. sanitised args are new string objects (breaks taint)
 *   4. shell: false always
 *   5. _GIT_BINARY was resolved at module load time via which.sync
 *
 * precondition:  cwd is an existing directory path.
 * postcondition: returns stdout string on success (rc=0); returns "" on any
 *   failure (denied subcommand, dangerous arg, timeout, file not found).
 *
 * source: Cortex mcp_server/infrastructure/git_diff_exec.py:git_cmd_safe
 */
export function gitCmdSafe(
  subcommand: string,
  args: string[],
  cwd: string,
): string {
  try {
    if (!_ALLOWED_SUBCOMMANDS.has(subcommand)) {
      return "";
    }
    const safeArgs: string[] = [];
    for (const arg of args) {
      const sanitized = _sanitizeArg(arg);
      if (sanitized === null) {
        return "";
      }
      safeArgs.push(sanitized);
    }
    const stdout = execFileSync(_GIT_BINARY, [subcommand, ...safeArgs], {
      cwd,
      timeout: 10_000, // source: Cortex mcp_server/infrastructure/git_diff_exec.py — subprocess.run timeout=10
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return (stdout ?? "").trim();
  } catch {
    return "";
  }
}

/**
 * Return the set of all git-tracked files inside gitRoot.
 *
 * precondition:  gitRoot is an existing git repository directory.
 * postcondition: returns Set<string> of relative file paths tracked by git;
 *   returns empty Set on any failure.
 *
 * source: Cortex mcp_server/infrastructure/git_diff_exec.py:get_tracked_files
 */
export function getTrackedFiles(gitRoot: string): Set<string> {
  const raw = gitCmdSafe("ls-files", [], gitRoot);
  if (!raw) {
    return new Set();
  }
  return new Set(raw.split("\n").filter(Boolean));
}
