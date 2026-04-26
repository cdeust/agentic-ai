/**
 * Wiki bidirectional link maintenance — pure, deterministic.
 *
 * Links live inside each page under a ``## Related`` section, rendered as
 * a sorted bullet list. ``applyLink`` is idempotent: adding the same link
 * twice produces identical output. Every relation has a fixed inverse so
 * ``wikiLink(a, b, rel)`` can update both pages with the correct symmetry.
 *
 * The relation vocabulary is intentionally small and hardcoded — extending
 * it requires a code change so consumers can rely on canonical semantics.
 *
 * source: mcp_server/core/wiki_links.py
 */

export const RELATIONS: Readonly<Record<string, string>> = {
  supersedes: "superseded_by",
  superseded_by: "supersedes",
  implements: "implemented_by",
  implemented_by: "implements",
  depends_on: "depended_on_by",
  depended_on_by: "depends_on",
  derived_from: "derives",
  derives: "derived_from",
  see_also: "see_also",
} as const;

export const RELATED_HEADING = "## Related";

export interface LinkEntry {
  readonly relation: string;
  readonly target: string;
}

/**
 * Return the inverse relation. Throws on unknown input.
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
  if (!payload.includes(" → ")) return null;
  const [relPart, rest] = payload.split(" → ", 2) as [string, string];
  const rel = relPart.trim();
  if (!RELATIONS[rel]) return null;
  let target = rest.trim();
  if (target.startsWith("[") && target.includes("](") && target.endsWith(")")) {
    target = target.split("](", 2)[1]!.slice(0, -1);
  }
  return { relation: rel, target };
}

function splitBodyAndRelated(body: string): [string, LinkEntry[]] {
  const lines = body.split("\n");
  let headingIdx: number | null = null;
  for (let idx = 0; idx < lines.length; idx++) {
    if (lines[idx]!.trim() === RELATED_HEADING) {
      headingIdx = idx;
      break;
    }
  }
  if (headingIdx === null) return [body, []];

  let before = lines.slice(0, headingIdx);
  const entries: LinkEntry[] = [];
  let idx = headingIdx + 1;
  while (idx < lines.length) {
    const line = lines[idx]!;
    if (line.startsWith("## ")) break;
    const parsed = parseEntry(line);
    if (parsed !== null) entries.push(parsed);
    idx++;
  }
  const after = lines.slice(idx);

  while (before.length > 0 && before[before.length - 1] === "") {
    before = before.slice(0, -1);
  }

  let rebuilt = before.join("\n");
  if (after.length > 0) {
    rebuilt = (rebuilt ? rebuilt + "\n\n" : "") + after.join("\n");
  }

  return [rebuilt, entries];
}

function renderRelated(entries: LinkEntry[]): string {
  if (!entries.length) return "";
  const sorted = [...entries].sort((a, b) => {
    const rc = a.relation.localeCompare(b.relation);
    return rc !== 0 ? rc : a.target.localeCompare(b.target);
  });
  const lines = [RELATED_HEADING, "", ...sorted.map(formatEntry)];
  return lines.join("\n") + "\n";
}

/**
 * Add a link entry to the Related section. Idempotent.
 *
 * Preserves all other sections and the original body verbatim aside from
 * the Related block, which is regenerated sorted.
 */
export function applyLink(body: string, entry: LinkEntry): string {
  if (!RELATIONS[entry.relation]) {
    throw new Error(`unknown relation: ${entry.relation}`);
  }
  const [base, existing] = splitBodyAndRelated(body);
  const merged: LinkEntry[] = [...existing];
  const alreadyPresent = merged.some(
    (e) => e.relation === entry.relation && e.target === entry.target,
  );
  if (!alreadyPresent) merged.push(entry);
  const rendered = renderRelated(merged);
  if (!base) return rendered;
  const separator = base.endsWith("\n") ? "" : "\n";
  return `${base}${separator}\n${rendered}`;
}
