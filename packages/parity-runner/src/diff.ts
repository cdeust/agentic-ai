/**
 * @agentic/parity-runner — diff.ts
 *
 * JSON-diff helper that respects MASKING.md sentinels.
 *
 * Adversarial design principle (Popper): do not design to confirm;
 * design to falsify. This diff does NOT stop at the first divergence —
 * it collects ALL divergences in a single pass so the report exposes
 * the full falsification surface.
 *
 * Sentinel grammar (source: parity-oracle/cortex/MASKING.md §2, §3):
 *
 *   "<MASKED:nondeterministic>"
 *     → assert key present, skip value comparison.
 *
 *   "<MASKED:nondeterministic-but-bounded: assertHeat(expr)>"
 *     → assert key present; evaluate the boolean expr against actual.
 *     The only supported functions are:
 *       assertHeat(heat < N && heat > M)   — float bounds on any numeric field
 *     Any other expression is a bounded-assert-fail with note "unsupported".
 *
 * Status markers (source: MASKING.md §4):
 *
 *   "_capture_status": "TO-BE-CAPTURED-IN-PHASE-0-DAY-1"
 *     → shape-only mode: assert top-level keys from _required_keys are present.
 *
 *   "_capture_status": "SHAPE-KNOWN-FROM-SOURCE"
 *     → full assertion mode (no special treatment beyond masking).
 */

import type { Divergence, DivergenceKind, FixtureOutcome } from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Exact sentinel for non-deterministic fields. source: MASKING.md §1. */
const SENTINEL_NONDETERMINISTIC = "<MASKED:nondeterministic>";

/** Prefix that introduces a bounded-mask assertion. source: MASKING.md §3. */
const SENTINEL_BOUNDED_PREFIX = "<MASKED:nondeterministic-but-bounded:";

// ── Bounded assertion evaluation ──────────────────────────────────────────────

/**
 * Parse and evaluate a bounded-mask expression against an actual value.
 *
 * Supported grammar:
 *   assertHeat(<field> <op> <n> && <field> <op> <n>)
 *   where op is one of: <, <=, >, >=, ==
 *   and n is a floating-point literal.
 *
 * Returns null if the assertion cannot be parsed (treated as "unsupported").
 *
 * source: MASKING.md §3 — example: "assertHeat(result.heat < 0.8 && result.heat > 0.0)"
 */
function evaluateBoundedAssertion(
  actual: unknown,
  sentinel: string,
  path: string,
): Divergence[] {
  // Extract expression from "...bounded: assertHeat(<expr>)>"
  const exprMatch = sentinel.match(/assertHeat\(([^)]+)\)/);
  if (!exprMatch || exprMatch[1] === undefined) {
    return [
      {
        path,
        kind: "BOUNDED_ASSERT_FAIL" as DivergenceKind,
        expected: sentinel,
        actual,
        note: "unsupported bounded-mask expression; cannot parse",
      },
    ];
  }

  const expr = exprMatch[1].trim();

  // Only numeric actual values can satisfy numeric bounds.
  if (typeof actual !== "number") {
    return [
      {
        path,
        kind: "BOUNDED_ASSERT_FAIL" as DivergenceKind,
        expected: sentinel,
        actual,
        note: `expected a number for bounded assertion; got ${typeof actual}`,
      },
    ];
  }

  // Split on && to handle compound predicates.
  // source: MASKING.md §3 — uses && to compose bounds.
  const clauses = expr.split("&&").map((c) => c.trim());
  const failures: string[] = [];

  for (const clause of clauses) {
    // Parse: <lhs_field> <op> <rhs_number>
    // lhs_field may be dotted ("result.heat") — we always compare against `actual`.
    const clauseMatch = clause.match(
      /^[\w.]+\s*(<=|>=|==|<|>)\s*([0-9]*\.?[0-9]+)$/,
    );
    if (!clauseMatch || clauseMatch[1] === undefined || clauseMatch[2] === undefined) {
      failures.push(`unparseable clause: "${clause}"`);
      continue;
    }
    const op = clauseMatch[1];
    const rhs = parseFloat(clauseMatch[2]);

    let satisfied: boolean;
    switch (op) {
      case "<":
        satisfied = actual < rhs;
        break;
      case "<=":
        satisfied = actual <= rhs;
        break;
      case ">":
        satisfied = actual > rhs;
        break;
      case ">=":
        satisfied = actual >= rhs;
        break;
      case "==":
        satisfied = actual === rhs;
        break;
      default:
        satisfied = false;
        failures.push(`unknown operator: "${op}"`);
        continue;
    }

    if (!satisfied) {
      failures.push(`${actual} ${op} ${rhs} is false`);
    }
  }

  if (failures.length > 0) {
    return [
      {
        path,
        kind: "BOUNDED_ASSERT_FAIL" as DivergenceKind,
        expected: sentinel,
        actual,
        note: failures.join("; "),
      },
    ];
  }

  return [];
}

// ── Core recursive diff ───────────────────────────────────────────────────────

/**
 * Recursively compare `actual` against `expected`, collecting all divergences.
 *
 * Rules:
 *  1. If expected is SENTINEL_NONDETERMINISTIC → assert key present, skip value.
 *  2. If expected starts with SENTINEL_BOUNDED_PREFIX → evaluate bounded assertion.
 *  3. If types differ → TYPE_MISMATCH (terminal; do not recurse).
 *  4. Arrays → assert equal length; recurse element-wise.
 *  5. Objects → assert all expected keys present in actual; recurse values.
 *     If strictExtraKeys: also assert no extra keys in actual.
 *  6. Primitives → strict equality.
 *
 * source: MASKING.md §5 — "compareWithMasking" reference implementation.
 */
export function compareWithMasking(
  actual: unknown,
  expected: unknown,
  path: string,
  strictExtraKeys = false,
): Divergence[] {
  // Rule 1: non-deterministic sentinel — key-presence only.
  if (expected === SENTINEL_NONDETERMINISTIC) {
    if (actual === undefined || actual === null) {
      return [{ path, kind: "MISSING_KEY", expected, actual }];
    }
    return [];
  }

  // Rule 2: bounded-mask sentinel.
  if (
    typeof expected === "string" &&
    expected.startsWith(SENTINEL_BOUNDED_PREFIX)
  ) {
    return evaluateBoundedAssertion(actual, expected, path);
  }

  // Rule 3: type mismatch.
  if (typeof actual !== typeof expected) {
    // null has typeof "object" — special-case it.
    const actualIsNull = actual === null;
    const expectedIsNull = expected === null;
    if (actualIsNull !== expectedIsNull) {
      return [{ path, kind: "TYPE_MISMATCH", expected, actual }];
    }
    if (!actualIsNull) {
      return [{ path, kind: "TYPE_MISMATCH", expected, actual }];
    }
  }

  // Rule 4: arrays.
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return [{ path, kind: "TYPE_MISMATCH", expected, actual }];
    }
    const divergences: Divergence[] = [];
    if (actual.length !== expected.length) {
      divergences.push({
        path,
        kind: "ARRAY_LENGTH_MISMATCH",
        expected: expected.length,
        actual: actual.length,
      });
      // Still recurse into the overlapping range to surface value divergences.
    }
    const len = Math.min(actual.length, expected.length);
    for (let i = 0; i < len; i++) {
      divergences.push(
        ...compareWithMasking(
          (actual as unknown[])[i],
          (expected as unknown[])[i],
          `${path}[${i}]`,
          strictExtraKeys,
        ),
      );
    }
    return divergences;
  }

  // Rule 5: objects.
  if (
    expected !== null &&
    typeof expected === "object" &&
    !Array.isArray(expected)
  ) {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
      return [{ path, kind: "TYPE_MISMATCH", expected, actual }];
    }

    const divergences: Divergence[] = [];
    const expectedObj = expected as Record<string, unknown>;
    const actualObj = actual as Record<string, unknown>;

    // Skip internal metadata keys from expected files.
    // source: MASKING.md — _capture_status, _schema_shape etc. are metadata, not output fields.
    const METADATA_KEY_PREFIX = "_";

    for (const key of Object.keys(expectedObj)) {
      if (key.startsWith(METADATA_KEY_PREFIX)) continue; // skip metadata

      const childPath = path ? `${path}.${key}` : key;
      if (!(key in actualObj)) {
        divergences.push({
          path: childPath,
          kind: "MISSING_KEY",
          expected: expectedObj[key],
          actual: undefined,
        });
      } else {
        divergences.push(
          ...compareWithMasking(
            actualObj[key],
            expectedObj[key],
            childPath,
            strictExtraKeys,
          ),
        );
      }
    }

    if (strictExtraKeys) {
      for (const key of Object.keys(actualObj)) {
        if (key.startsWith(METADATA_KEY_PREFIX)) continue;
        if (!(key in expectedObj)) {
          const childPath = path ? `${path}.${key}` : key;
          divergences.push({
            path: childPath,
            kind: "EXTRA_KEY",
            expected: undefined,
            actual: actualObj[key],
          });
        }
      }
    }

    return divergences;
  }

  // Rule 6: primitives.
  if (actual !== expected) {
    return [{ path, kind: "VALUE_MISMATCH", expected, actual }];
  }
  return [];
}

// ── Shape-only mode ───────────────────────────────────────────────────────────

/**
 * Validate that `actual` contains the keys listed in `_required_keys`.
 * Used for TO-BE-CAPTURED fixtures where only the shape is known.
 *
 * source: MASKING.md §4 — "TO-BE-CAPTURED files are shape-only tests."
 */
export function checkShapeOnly(
  actual: unknown,
  requiredKeys: readonly string[],
): FixtureOutcome {
  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
    return {
      status: "diverged",
      divergences: [
        {
          path: "",
          kind: "TYPE_MISMATCH",
          expected: "object",
          actual: typeof actual,
        },
      ],
    };
  }
  const actualObj = actual as Record<string, unknown>;
  const missingDivergences: Divergence[] = [];
  for (const key of requiredKeys) {
    if (!(key in actualObj)) {
      missingDivergences.push({
        path: key,
        kind: "MISSING_KEY",
        expected: "(required key from _required_keys)",
        actual: undefined,
      });
    }
  }
  if (missingDivergences.length > 0) {
    return { status: "diverged", divergences: missingDivergences };
  }
  return { status: "shape_only", reason: "TO-BE-CAPTURED fixture — shape validated only" };
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Compare a TS implementation's output against an expected fixture file.
 *
 * Returns a FixtureOutcome that signals match, diverged, shape_only, or skipped.
 *
 * The design deliberately collects ALL divergences, not just the first —
 * a Popperian harness must expose the complete falsification surface.
 *
 * source: Popper (1959) Ch. 10 — "The Severity of Tests":
 *         a weak test that confirms is worth nothing; collect everything.
 */
export function diffFixture(
  actual: unknown,
  expected: Record<string, unknown>,
  strictExtraKeys = false,
): FixtureOutcome {
  // Shape-only mode for TO-BE-CAPTURED fixtures.
  if (
    expected["_capture_status"] === "TO-BE-CAPTURED-IN-PHASE-0-DAY-1"
  ) {
    const requiredKeys = (expected["_required_keys"] as string[] | undefined) ?? [];
    return checkShapeOnly(actual, requiredKeys);
  }

  const divergences = compareWithMasking(actual, expected, "", strictExtraKeys);
  if (divergences.length === 0) {
    return { status: "match" };
  }
  return { status: "diverged", divergences };
}
