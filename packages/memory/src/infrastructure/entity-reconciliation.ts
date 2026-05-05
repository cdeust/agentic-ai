/**
 * Entity reconciliation — keep memory_entities coverage high.
 *
 * Builds the windowed maintenance query that closes the retroactive-entity-
 * orphans leak after a one-shot backfill. Run it on the consolidate
 * schedule (daily). Windowing keeps runtime proportional to recent
 * activity, not to store size.
 *
 * Window semantics (both conditions AND'd, NOT OR'd):
 *   - memory is young enough to still be a likely target of new-entity
 *     linkage (default 7 days — consistent with LABILE and EARLY_LTP
 *     cascade stages)
 *   - entity is young enough that it was possibly introduced after the
 *     memory existed (default 24 hours — captures the write path's
 *     entity-creation-after-memory-creation case)
 *
 * Pure business logic. The SQL is returned to a handler / store adapter
 * that runs it. This module has no database driver dependency.
 *
 * Port of: cortex@ed33435 mcp_server/core/entity_reconciliation.py
 *
 * References:
 *   Clean Architecture (Martin 2017) Ch. 20: the SQL is a policy the
 *   core owns; execution is an I/O concern of the store.
 *   cortex-invariants.md I4 and I9.
 */

// ── Defaults ──────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/entity_reconciliation.py:46-48
// Memory age = 7 days matches LABILE+EARLY_LTP cascade stage window
// Entity age = 24h bounds work to the retroactive-creation case
// Min name length = 4 (Option A — Curie audit, drops 117 junk entities)

export const DEFAULT_MEMORY_AGE_DAYS = 7;    // source: cortex@ed33435 mcp_server/core/entity_reconciliation.py:46
export const DEFAULT_ENTITY_AGE_HOURS = 24;  // source: cortex@ed33435 mcp_server/core/entity_reconciliation.py:47
export const DEFAULT_MIN_NAME_LENGTH = 4;    // source: cortex@ed33435 mcp_server/core/entity_reconciliation.py:48

// ── SQL templates ─────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/entity_reconciliation.py:59-81

const RECONCILE_SQL = `
INSERT INTO memory_entities (memory_id, entity_id)
SELECT m.id, e.id
FROM   entities e
JOIN   memories m
  ON   m.content ILIKE '%' || e.name || '%'
WHERE  length(e.name) >= $1
  AND  NOT e.archived
  AND  m.created_at > NOW() - make_interval(days => $2)
  AND  e.created_at > NOW() - make_interval(hours => $3)
ON CONFLICT (memory_id, entity_id) DO NOTHING
`;

const COUNT_ELIGIBLE_SQL = `
SELECT COUNT(*)
FROM   entities e
JOIN   memories m
  ON   m.content ILIKE '%' || e.name || '%'
WHERE  length(e.name) >= $1
  AND  NOT e.archived
  AND  m.created_at > NOW() - make_interval(days => $2)
  AND  e.created_at > NOW() - make_interval(hours => $3)
`;

// ── SQL builders ──────────────────────────────────────────────────────────

/**
 * Return [sql, params] for the windowed memory_entities reconciliation.
 *
 * precondition:  memoryAgeDays >= 1; entityAgeHours >= 1; minNameLength >= 1.
 * postcondition: returned SQL is idempotent (INSERT ... ON CONFLICT DO NOTHING);
 *   params tuple order matches $1, $2, $3 placeholders:
 *   [minNameLength, memoryAgeDays, entityAgeHours].
 *   The SQL never shrinks memory_entities (monotone adds only).
 *
 * source: cortex@ed33435 mcp_server/core/entity_reconciliation.py:84-129
 */
export function buildReconciliationSql(
  memoryAgeDays = DEFAULT_MEMORY_AGE_DAYS,
  entityAgeHours = DEFAULT_ENTITY_AGE_HOURS,
  minNameLength = DEFAULT_MIN_NAME_LENGTH,
): [string, [number, number, number]] {
  if (memoryAgeDays < 1) throw new Error(`memoryAgeDays must be >= 1, got ${memoryAgeDays}`);
  if (entityAgeHours < 1) throw new Error(`entityAgeHours must be >= 1, got ${entityAgeHours}`);
  if (minNameLength < 1) throw new Error(`minNameLength must be >= 1, got ${minNameLength}`);

  const params: [number, number, number] = [minNameLength, memoryAgeDays, entityAgeHours];
  return [RECONCILE_SQL, params];
}

/**
 * Return [sql, params] for counting eligible pairs in the window.
 *
 * precondition:  same as buildReconciliationSql.
 * postcondition: returned SQL selects a single BIGINT (the eligible-pair count).
 *   Used to compute the leak ratio. Read-only query.
 *
 * source: cortex@ed33435 mcp_server/core/entity_reconciliation.py:132-157
 */
export function buildCountEligibleSql(
  memoryAgeDays = DEFAULT_MEMORY_AGE_DAYS,
  entityAgeHours = DEFAULT_ENTITY_AGE_HOURS,
  minNameLength = DEFAULT_MIN_NAME_LENGTH,
): [string, [number, number, number]] {
  if (memoryAgeDays < 1) throw new Error(`memoryAgeDays must be >= 1, got ${memoryAgeDays}`);
  if (entityAgeHours < 1) throw new Error(`entityAgeHours must be >= 1, got ${entityAgeHours}`);
  if (minNameLength < 1) throw new Error(`minNameLength must be >= 1, got ${minNameLength}`);

  const params: [number, number, number] = [minNameLength, memoryAgeDays, entityAgeHours];
  return [COUNT_ELIGIBLE_SQL, params];
}

// ── Leak ratio ────────────────────────────────────────────────────────────

/**
 * Compute the leak ratio for the reconcile job.
 *
 * precondition:  reconciledPairs >= 0; eligiblePairs >= 0;
 *   reconciledPairs <= eligiblePairs.
 * postcondition: result ∈ [0.0, 1.0].
 *   Returns 0.0 when eligiblePairs == 0 (no work → no leak).
 *
 * The ratio is: reconciled / eligible. A value above 0.01 (1%) means
 * the write path is leaking — the ongoing I9 guarantee is not holding.
 *
 * source: cortex@ed33435 mcp_server/core/entity_reconciliation.py:160-201
 *   LEAK_WARNING_THRESHOLD = 0.01 — empirical upper bound for the
 *   retroactive-entity-orphan rate on the darval 66K store (design doc §6).
 */
export function reconcileLeakRatio(
  reconciledPairs: number,
  eligiblePairs: number,
): number {
  if (reconciledPairs < 0) throw new Error(`reconciledPairs must be >= 0, got ${reconciledPairs}`);
  if (eligiblePairs < 0) throw new Error(`eligiblePairs must be >= 0, got ${eligiblePairs}`);
  if (reconciledPairs > eligiblePairs) {
    throw new Error(
      `reconciledPairs (${reconciledPairs}) > eligiblePairs (${eligiblePairs}) — counting bug`,
    );
  }
  if (eligiblePairs === 0) return 0.0;
  return reconciledPairs / eligiblePairs;
}

/**
 * Leak threshold constant.
 *
 * source: cortex@ed33435 mcp_server/core/entity_reconciliation.py:212
 *   Empirical upper bound for the retroactive-entity-orphan rate on the
 *   darval 66K store (design doc §6).
 */
export const LEAK_WARNING_THRESHOLD = 0.01;

/**
 * True if the leak ratio warrants a WARN log to operators.
 *
 * precondition:  0.0 <= ratio <= 1.0.
 * postcondition: returns (ratio > LEAK_WARNING_THRESHOLD).
 *
 * source: cortex@ed33435 mcp_server/core/entity_reconciliation.py:215-223
 */
export function exceedsLeakThreshold(ratio: number): boolean {
  if (ratio < 0.0 || ratio > 1.0) {
    throw new Error(`ratio must be in [0.0, 1.0], got ${ratio}`);
  }
  return ratio > LEAK_WARNING_THRESHOLD;
}
