/**
 * Bidirectional conversion between filesystem paths, Claude project IDs,
 * human-readable labels, and domain identifiers.
 *
 * Claude Code stores project data in directories named by mangled
 * filesystem paths (e.g., "-Users-dev-myproject").
 *
 * Port of: mcp_server/shared/project_ids.py
 */

const STRIP_PREFIX_RE = /^-?Users-[^-]+(-Documents)?(-Developments)?-/;
const NON_ALNUM_RE = /[^a-z0-9]+/g;
const LEADING_TRAILING_DASH_RE = /^-|-$/g;

/**
 * Convert a working directory path to a Claude project ID.
 *
 * POSIX: /Users/dev/cortex -> -Users-dev-cortex
 * Windows: C:\\Users\\dev\\cortex -> C--Users-dev-cortex
 *
 * Backslashes are normalized to forward slashes first so Windows paths
 * produce the same dash-separated project ID shape as POSIX paths.
 */
export function cwdToProjectId(cwd: string | null | undefined): string | null {
  if (!cwd) return null;
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
