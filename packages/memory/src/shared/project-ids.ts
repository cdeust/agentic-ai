/**
 * Bidirectional conversion between filesystem paths, Claude project IDs,
 * human-readable labels, and domain identifiers.
 *
 * Claude Code stores project data in directories named by mangled filesystem paths.
 *
 *   POSIX example:    /Users/dev/cortex          -> -Users-dev-cortex
 *   Windows example:  C:\\Users\\michael.crawford -> c--users-michael-crawford
 *   Git-Bash form:    /c/users/michael.crawford  -> c--users-michael-crawford
 *
 * Path normalization is an abstraction barrier — consumers of cwdToProjectId
 * must not need to know the source OS. The shape of the input path (drive
 * letter, backslash, leading single-letter directory) determines the dialect,
 * never the host OS. The function is therefore deterministic across platforms
 * and idempotent on canonical slugs already on disk.
 *
 * Port of: cortex@4260a99 mcp_server/shared/project_ids.py (issue #18 fix)
 */

const STRIP_PREFIX_RE = /^-?Users-[^-]+(-Documents)?(-Developments)?-/;
const NON_ALNUM_RE = /[^a-z0-9]+/g;
const LEADING_TRAILING_DASH_RE = /^-|-$/g;

// Drive-letter prefix: "C:", "C:/", "C:\\". The colon is the structural marker.
const WINDOWS_DRIVE_RE = /^[A-Za-z]:/;
// Git-Bash drive translation: "/c/...", "/C/...". The single-letter directory
// at root is the structural marker. We convert to drive form and reuse the
// Windows normalizer to keep one canonical slug per logical path.
const GITBASH_DRIVE_RE = /^\/([A-Za-z])\//;
// Whole-string non-alphanumeric (incl. ':', '\\', '/', '.') for Windows slug.
const WINDOWS_SLUG_RE = /[^a-z0-9]/g;

function isWindowsPath(path: string): boolean {
  return WINDOWS_DRIVE_RE.test(path);
}

/** Convert '/c/users/foo' → 'c:/users/foo'. Returns null if not Git-Bash. */
function gitbashToWindows(path: string): string | null {
  const m = GITBASH_DRIVE_RE.exec(path);
  if (!m) return null;
  const drive = m[1];
  return `${drive}:/${path.slice(3)}`;
}

/**
 * Normalize a Windows-style absolute path to its on-disk Claude slug.
 *
 * Lowercase, then replace each non-alphanumeric character with a single '-'.
 * Per-character (not per-run) substitution is intentional: it matches the
 * Claude Code convention where 'C:\\Users' becomes 'c--users' (two dashes
 * from ':' and '\\').
 */
function windowsSlug(path: string): string {
  return path.toLowerCase().replace(WINDOWS_SLUG_RE, "-");
}

/**
 * Convert a working directory path to a Claude project ID.
 *
 * Preconditions:
 *   - cwd is null, undefined, empty, or a filesystem path in any platform's
 *     syntax (POSIX, Windows forward-slash, Windows backslash, Git-Bash).
 * Postconditions:
 *   - Returns null when cwd is null/undefined/empty.
 *   - Returns the slug Claude Code uses as its on-disk project directory
 *     name for that path.
 *   - Idempotent on canonical slugs already on disk: passing back a
 *     previously-produced slug returns the same slug.
 *
 * source: cortex@4260a99 mcp_server/shared/project_ids.py:cwd_to_project_id (issue #18)
 */
export function cwdToProjectId(cwd: string | null | undefined): string | null {
  if (!cwd) return null;

  // Git-Bash drive translation '/c/...' canonicalizes to Windows form first.
  const gb = gitbashToWindows(cwd);
  if (gb !== null) return windowsSlug(gb);

  // Windows absolute path: full lowercase + per-char non-alnum→'-'.
  if (isWindowsPath(cwd)) return windowsSlug(cwd);

  // POSIX or already-a-slug path: case-preserving, only path separators
  // become dashes. Backslashes are normalized for safety on mixed inputs
  // (e.g., a slug pasted into a Windows shell that escaped its own seps).
  return cwd.replace(/\\/g, "/").replace(/\//g, "-");
}

/**
 * Convert a Claude project ID to a human-readable label.
 *
 * Strips common path prefixes (Users, Documents, Developments)
 * and replaces dashes with spaces.
 */
export function projectIdToLabel(projectId: string | null | undefined): string {
  if (!projectId) return "Unknown";
  const result = projectId.replace(STRIP_PREFIX_RE, "").replace(/-/g, " ").trim();
  return result || projectId;
}

/**
 * Convert a human-readable label to a kebab-case domain ID.
 */
export function domainIdFromLabel(label: string | null | undefined): string {
  if (!label) return "";
  const result = label.toLowerCase().replace(NON_ALNUM_RE, "-");
  return result.replace(LEADING_TRAILING_DASH_RE, "");
}
