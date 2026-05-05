/**
 * Phase 2 (ADR-0046) — pure staleness verdict for wiki pages over AST.
 *
 * Complements wiki-staleness (file-existence check) with a symbol-existence
 * check: a page that cites foo.Bar.baz is symbol-stale when that qualified
 * name no longer resolves in AP's code graph.
 *
 * Pure logic — no I/O. The handler owns the AP calls.
 *
 * Port of: cortex@ed33435 mcp_server/core/wiki_symbol_verify.py
 */

// ── Constants ─────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/wiki_symbol_verify.py:18-23

/** Pages with fewer than this many qualname references are exempt. */
export const MIN_SYMBOL_REFS = 3;   // source: cortex@ed33435 mcp_server/core/wiki_symbol_verify.py:18

/** A page is symbol-stale when this fraction of its references cannot be resolved. */
export const STALE_THRESHOLD = 0.5; // source: cortex@ed33435 mcp_server/core/wiki_symbol_verify.py:23

// ── SymbolStalenessDecision ───────────────────────────────────────────────

/**
 * Per-page symbol-staleness verdict.
 * source: cortex@ed33435 mcp_server/core/wiki_symbol_verify.py:26-36
 */
export interface SymbolStalenessDecision {
  readonly pageId: number | string;
  readonly symbolRefs: string[];
  readonly missingRefs: string[];
  readonly isSymbolStaleNow: boolean;
  readonly isSymbolStaleWas: boolean;
  readonly transitioned: boolean;
  readonly rationale: string;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Decide whether a wiki page is symbol-stale.
 *
 * A page is stale iff:
 *   - symbolRefs.length >= MIN_SYMBOL_REFS, AND
 *   - missing / total >= STALE_THRESHOLD.
 *
 * precondition:  existence maps qualname → boolean.
 * postcondition: returned decision is deterministic given same inputs.
 *
 * source: cortex@ed33435 mcp_server/core/wiki_symbol_verify.py:39-88
 *   MIN_SYMBOL_REFS = 3; STALE_THRESHOLD = 0.5
 */
export function evaluateSymbolStaleness(opts: {
  pageId: number | string;
  isSymbolStaleWas: boolean;
  symbolRefs: string[];
  existence: Record<string, boolean>;
}): SymbolStalenessDecision {
  const { pageId, isSymbolStaleWas, symbolRefs, existence } = opts;

  if (symbolRefs.length < MIN_SYMBOL_REFS) {
    return {
      pageId,
      symbolRefs,
      missingRefs: [],
      isSymbolStaleNow: false,
      isSymbolStaleWas,
      transitioned: isSymbolStaleWas, // un-staling counts
      rationale: `too few symbol refs (${symbolRefs.length} < ${MIN_SYMBOL_REFS})`,
    };
  }

  const missing = symbolRefs.filter((q) => !existence[q]);
  const fraction = missing.length / symbolRefs.length;
  const isNow = fraction >= STALE_THRESHOLD;

  return {
    pageId,
    symbolRefs,
    missingRefs: missing,
    isSymbolStaleNow: isNow,
    isSymbolStaleWas,
    transitioned: isNow !== isSymbolStaleWas,
    rationale: `${missing.length}/${symbolRefs.length} symbols missing (${Math.round(fraction * 100)}% — threshold ${Math.round(STALE_THRESHOLD * 100)}%)`,
  };
}
