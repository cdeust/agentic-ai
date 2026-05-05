/**
 * Wiki bidirectional link maintenance — pure, deterministic.
 *
 * Links live inside each page under a ## Related section, rendered as
 * a sorted bullet list. applyLink is idempotent: adding the same link
 * twice produces identical output. Every relation has a fixed inverse so
 * wikiLink(a, b, rel) can update both pages with the correct symmetry.
 *
 * The relation vocabulary is intentionally small and hardcoded — extending
 * it requires a code change so consumers can rely on canonical semantics.
 *
 * Port of: cortex@ed33435 mcp_server/core/wiki_links.py
 */

// ── Relation vocabulary ───────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/wiki_links.py:17-27

export const RELATIONS: Record<string, string> = {
  supersedes: "superseded_by",
  superseded_by: "supersedes",
  implements: "implemented_by",
  implemented_by: "implements",
  depends_on: "depended_on_by",
  depended_on_by: "depends_on",
  derived_from: "derives",
  derives: "derived_from",
  see_also: "see_also",
};

export const RELATED_HEADING = "## Related";

// ── LinkEntry ─────────────────────────────────────────────────────────────

/**
 * A wiki link entry with relation and target path.
 * source: cortex@ed33435 mcp_server/core/wiki_links.py:32-34
 */
export interface LinkEntry {
  readonly relation: string;
  readonly target: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Return the inverse relation. Throws on unknown input.
 * source: cortex@ed33435 mcp_server/core/wiki_links.py:38-40
 */
export function inverseOf(relation: string): string {
  const inv = RELATIONS[relation];
  if (inv === undefined) throw new Error(`unknown relation: ${relation}`);
  return inv;
}

function formatEntry(entry: LinkEntry): string {
  return `- ${entry.relation} → [${entry.target}](${entry.target})`;
}

function parseEntry(line: string): LinkEntry | null {
  const stripped = line.trim();
  if (!stripped.startsWith("- ")) return null;
  const payload = stripped.slice(2);
  const sepIdx = payload.indexOf(" → ");
  if (sepIdx === -1) return null;
  const rel = payload.slice(0, sepIdx).trim();
  if (!(rel in RELATIONS)) return null;
  let target = payload.slice(sepIdx + 3).trim();
  if (target.startsWith("[") && target.includes("](") && target.endsWith(")")) {
    target = target.split("](")[1]!.slice(0, -1);
  }
  return { relation: rel, target };
}

function splitBodyAndRelated(body: string): [string, LinkEntry[]] {
  const lines = body.split("\n");
  let headingIdx: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === RELATED_HEADING) { headingIdx = i; break; }
  }
  if (headingIdx === null) return [body, []];

  const before = lines.slice(0, headingIdx);
  const entries: LinkEntry[] = [];
  let idx = headingIdx + 1;
  while (idx < lines.length) {
    if (lines[idx]!.startsWith("## ")) break;
    const parsed = parseEntry(lines[idx]!);
    if (parsed !== null) entries.push(parsed);
    idx++;
  }
  const after = lines.slice(idx);

  // Drop trailing blank lines from before
  while (before.length > 0 && before[before.length - 1] === "") before.pop();

  let rebuilt = before.join("\n");
  if (after.length > 0) {
    rebuilt = (rebuilt + "\n\n") + after.join("\n");
  }
  return [rebuilt, entries];
}

function renderRelated(entries: LinkEntry[]): string {
  if (entries.length === 0) return "";
  const sorted = [...entries].sort((a, b) => {
    const rc = a.relation.localeCompare(b.relation);
    return rc !== 0 ? rc : a.target.localeCompare(b.target);
  });
  const lines = [RELATED_HEADING, "", ...sorted.map(formatEntry)];
  return lines.join("\n") + "\n";
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Add a link entry to the Related section. Idempotent.
 *
 * Preserves all other sections and the original body verbatim aside from
 * the Related block, which is regenerated sorted.
 *
 * precondition:  entry.relation is in RELATIONS.
 * postcondition: returned string contains a ## Related section with entry.
 *   Calling applyLink twice with the same entry produces the same output.
 *
 * source: cortex@ed33435 mcp_server/core/wiki_links.py:108-124
 */
export function applyLink(body: string, entry: LinkEntry): string {
  if (!(entry.relation in RELATIONS)) {
    throw new Error(`unknown relation: ${entry.relation}`);
  }
  const [base, existing] = splitBodyAndRelated(body);
  const merged = [...existing];
  const alreadyExists = merged.some(
    (e) => e.relation === entry.relation && e.target === entry.target,
  );
  if (!alreadyExists) merged.push(entry);

  const rendered = renderRelated(merged);
  if (!base) return rendered;
  const separator = base.endsWith("\n") ? "" : "\n";
  return `${base}${separator}\n${rendered}`;
}
