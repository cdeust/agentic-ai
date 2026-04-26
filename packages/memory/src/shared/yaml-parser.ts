/**
 * Lightweight YAML frontmatter parser for memory files.
 *
 * Only supports flat key-value pairs (no nested YAML, no arrays,
 * no multi-line). Memory frontmatter is always flat key-value pairs
 * written by Claude Code itself.
 *
 * Note: This implementation uses regex-based parsing (matching the Python
 * source behavior exactly) rather than a full YAML library. The Python
 * source also uses only regex for this flat-KV case.
 *
 * Port of: mcp_server/shared/yaml_parser.py
 */

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
const KV_RE = /^(\w[\w\s]*?):\s*(.+)$/;

export interface FrontmatterResult {
  readonly meta: Readonly<Record<string, string>>;
  readonly body: string;
}

/**
 * Parse YAML frontmatter from a markdown string.
 *
 * Returns { meta, body } where meta keys are lowercased.
 * If no frontmatter found, meta is empty and body is the full content.
 */
export function parseYamlFrontmatter(content: string | null | undefined): FrontmatterResult {
  if (!content) return { meta: {}, body: "" };

  const match = FRONTMATTER_RE.exec(content);
  if (!match) return { meta: {}, body: content.trim() };

  const meta: Record<string, string> = {};
  const rawMeta = match[1] ?? "";
  for (const line of rawMeta.split("\n")) {
    const kv = KV_RE.exec(line);
    if (kv) {
      const key = (kv[1] ?? "").trim().toLowerCase();
      const val = (kv[2] ?? "").trim();
      meta[key] = val;
    }
  }

  return { meta, body: (match[2] ?? "").trim() };
}
