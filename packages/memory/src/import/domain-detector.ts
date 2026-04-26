/**
 * Domain label extraction from working-directory paths.
 *
 * Port of: mcp_server/handlers/import_sessions.py::_detect_domain_from_path
 *
 * source: mcp_server/handlers/import_sessions.py::_detect_domain_from_path
 */

// ── Well-known container directory names ──────────────────────────────────
// source: mcp_server/handlers/import_sessions.py — container name set
const CONTAINER_NAMES = new Set([
  "developments",
  "projects",
  "repos",
  "src",
  "code",
]);

/**
 * Extract a domain label from a working-directory path.
 *
 * Walks path components for a known "container" segment (e.g., "projects",
 * "repos") and returns the component immediately after it. Falls back to
 * the last path component, or "unknown" for empty input.
 *
 * Examples:
 *   /Users/alice/Developments/cortex  → "cortex"
 *   /Users/bob/repos/my-app/src       → "my-app"
 *   /tmp                              → "tmp"
 *   ""                                → "unknown"
 *
 * Port of: mcp_server/handlers/import_sessions.py::_detect_domain_from_path
 */
export function detectDomainFromPath(cwd: string): string {
  if (!cwd) return "unknown";

  // Split on both / and \ for cross-platform correctness
  const parts = cwd.split(/[/\\]/).filter((p) => p.length > 0);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part !== undefined && CONTAINER_NAMES.has(part.toLowerCase())) {
      const next = parts[i + 1];
      if (next !== undefined) return next.toLowerCase();
    }
  }

  const last = parts[parts.length - 1];
  return last !== undefined ? last.toLowerCase() : "unknown";
}
