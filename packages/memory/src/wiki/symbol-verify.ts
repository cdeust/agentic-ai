/**
 * Phase 2 (ADR-0046) — pure staleness verdict for wiki pages over AST.
 *
 * Complements ``staleness.ts`` (file-existence check) with a symbol-
 * existence check: a page that cites ``foo.Bar.baz`` is *symbol-stale*
 * when that qualified name no longer resolves in AP's code graph.
 *
 * This module owns the verdict; the handler owns the AP calls. The split
 * keeps core I/O-free and testable without mocks.
 *
 * Dependency: cortex-codebase-analysis (WorkflowGraphASTSource) provides
 * the ``verifySymbols`` call that maps qualnames → existence booleans.
 * That port is out of scope for this pass; the dependency is documented here.
 *
 * source: mcp_server/core/wiki_symbol_verify.py
 */

// Pages with fewer than this many qualname references are exempt from
// the symbol-stale signal. Matches the rationale of MIN_FILE_REFS.
export const MIN_SYMBOL_REFS = 3;

// A page is symbol-stale when this fraction of its references cannot be
// resolved. 0.5 matches SYMBOL_STALE_THRESHOLD so the two signals fire at the
// same evidence level.
// source: empirical threshold parity with staleness.SYMBOL_STALE_THRESHOLD
export const SYMBOL_STALE_THRESHOLD = 0.5;

export interface SymbolStalenessDecision {
  readonly page_id: number | string;
  readonly symbol_refs: readonly string[];
  readonly missing_refs: readonly string[];
  readonly is_symbol_stale_now: boolean;
  readonly is_symbol_stale_was: boolean;
  readonly transitioned: boolean;
  readonly rationale: string;
}

export interface EvaluateSymbolStalenessArgs {
  readonly page_id: number | string;
  readonly is_symbol_stale_was: boolean;
  readonly symbol_refs: readonly string[];
  readonly existence: Readonly<Record<string, boolean>>;
}

/**
 * Decide whether a wiki page is symbol-stale.
 *
 * A page is stale iff:
 *   - len(symbol_refs) >= MIN_SYMBOL_REFS, AND
 *   - missing / total >= SYMBOL_STALE_THRESHOLD.
 *
 * The verdict is deterministic — given the same inputs it always
 * returns the same output.
 */
export function evaluateSymbolStaleness(
  args: EvaluateSymbolStalenessArgs,
): SymbolStalenessDecision {
  const { page_id, is_symbol_stale_was, symbol_refs, existence } = args;

  if (symbol_refs.length < MIN_SYMBOL_REFS) {
    return {
      page_id,
      symbol_refs,
      missing_refs: [],
      is_symbol_stale_now: false,
      is_symbol_stale_was,
      transitioned: is_symbol_stale_was,
      rationale: `too few symbol refs (${symbol_refs.length} < ${MIN_SYMBOL_REFS})`,
    };
  }

  const missing = symbol_refs.filter((q) => !existence[q]);
  const fraction = missing.length / symbol_refs.length;
  const isNow = fraction >= SYMBOL_STALE_THRESHOLD;

  return {
    page_id,
    symbol_refs,
    missing_refs: missing,
    is_symbol_stale_now: isNow,
    is_symbol_stale_was,
    transitioned: isNow !== is_symbol_stale_was,
    rationale:
      `${missing.length}/${symbol_refs.length} symbols missing ` +
      `(${Math.round(fraction * 100)}% — threshold ${Math.round(SYMBOL_STALE_THRESHOLD * 100)}%)`,
  };
}
