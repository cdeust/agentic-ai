/**
 * Entity name canonicalization — pre-insert case dedup policy.
 *
 * source: Curie I4 completeness audit (2026-04-16) found **111 case-variant
 * duplicate entity groups** on the cortex DB (`Output`/`OUTPUT`,
 * `String`/`STRING`, `DOMAIN`/`domain`, `FilePath`/`filepath`, etc.) across
 * 196 entity rows. The extraction layer was inserting raw names without
 * case normalization, so each variant produced a new row.
 *
 * Policy (2026-04-16):
 *
 *     canonical(name) = name.title() if name is ALL-CAPS AND length >= 5
 *                       else name   (preserve)
 *
 * Rationale for the length >= 5 cutoff:
 *   - Iconic short acronyms (HTTP, JSON, YAML, HTML, CURL, BASH, XML,
 *     CSS, URL, GPT, AI, ML) are semantically load-bearing in all-caps
 *     form; converting `HTTP` → `Http` breaks reader expectation.
 *   - Longer all-caps tokens (OUTPUT, STRING, DOMAIN, STATUS, ERROR,
 *     DEBUG, MACRO) are almost always accidental shout-case.
 *   - A 5-char cutoff preserves HTTP/JSON/YAML/HTML/CURL while collapsing
 *     HTTPS → Https.
 *
 * Port of: mcp_server/shared/entity_canonical.py
 */

// Threshold above which ALL-CAPS tokens are considered accidental
// shout-case rather than intentional acronyms. 5 keeps HTTP/JSON/YAML/
// HTML/CURL intact and collapses HTTPS/XHTML/STORE/DEBUG/OUTPUT/STRING.
const ALLCAPS_TITLE_CUTOFF = 5;

/**
 * Return the canonical form of an entity name per the dedup policy.
 *
 * Examples:
 *   canonicalizeEntityName("OUTPUT")    === "Output"
 *   canonicalizeEntityName("STRING")    === "String"
 *   canonicalizeEntityName("HTTP")      === "HTTP"     // 4-char acronym
 *   canonicalizeEntityName("HTTPS")     === "Https"    // 5-char → title
 *   canonicalizeEntityName("FilePath")  === "FilePath" // preserve camel
 *   canonicalizeEntityName("")          === ""          // empty passes
 */
export function canonicalizeEntityName(name: string): string {
  if (!name) return name;
  const stripped = name.trim();
  if (!stripped) return stripped;

  // ALL-CAPS detection must tolerate digits and underscores (e.g.,
  // `HTTP_2`, `PHASE_3`, `A1B2`) — if the alpha chars are all upper and
  // at least one exists, treat as all-caps for policy purposes.
  const alphaChars = Array.from(stripped).filter((c) => /[a-zA-Z]/.test(c));
  if (alphaChars.length === 0) return stripped; // e.g., "42" or "__"

  const allUpper = alphaChars.every((c) => c === c.toUpperCase() && c !== c.toLowerCase());
  if (allUpper && stripped.length >= ALLCAPS_TITLE_CUTOFF) {
    // Title-case only the alpha segments — preserve underscores/digits
    // so `HTTP_CLIENT` becomes `Http_Client` not `Http_client`.
    return stripped
      .split(/(\W+)/)
      .map((segment) => {
        if (/^\w+$/.test(segment) && segment.length > 0) {
          return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase();
        }
        return segment;
      })
      .join("");
  }
  return stripped;
}
