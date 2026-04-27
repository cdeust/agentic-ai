/**
 * @agentic/parity-runner — shared types.
 *
 * Popperian design principle: every type must be falsifiable.
 * A ParityReport with exit_code 0 makes a testable claim:
 * "zero divergences observed in the fixture corpus." That claim
 * is falsifiable — any new divergence entry falsifies it.
 *
 * source: Popper, K.R. (1959). The Logic of Scientific Discovery, Ch. 3.
 *         "Falsifiability as a Criterion of Demarcation."
 */

// ── Source identifiers ────────────────────────────────────────────────────────

/** Which source repo the runner is comparing against. */
export type SourceId = "cortex" | "codebase" | "prd";

// ── Divergence kinds ──────────────────────────────────────────────────────────

/**
 * The specific structural mismatch found when comparing two values.
 *
 * Adversarial probe note: the most common divergence kinds that a failing
 * port produces are VALUE_MISMATCH (wrong computation) and MISSING_KEY
 * (contract omission). EXTRA_KEY signals the TS port added surface area
 * the Python/Rust source did not expose — also a falsification.
 *
 * source: MASKING.md §5 — harness implementation reference.
 */
export type DivergenceKind =
  | "MISSING_KEY"        // expected key absent in actual
  | "EXTRA_KEY"          // actual has key not in expected (strict mode)
  | "VALUE_MISMATCH"     // values differ after masking
  | "TYPE_MISMATCH"      // typeof differs
  | "BOUNDED_ASSERT_FAIL" // a <MASKED:nondeterministic-but-bounded: ...> predicate failed
  | "ARRAY_LENGTH_MISMATCH"; // arrays have different lengths

/** A single point of divergence between expected and actual output. */
export interface Divergence {
  /** JSON-path-style pointer to the diverging field, e.g. "results[0].score" */
  readonly path: string;
  readonly kind: DivergenceKind;
  readonly expected: unknown;
  readonly actual: unknown;
  /** Human-readable explanation, populated for BOUNDED_ASSERT_FAIL. */
  readonly note?: string | undefined;
}

// ── Per-fixture result ────────────────────────────────────────────────────────

/** Outcome for a single fixture input/expected pair. */
export type FixtureOutcome =
  | { readonly status: "match" }
  | { readonly status: "diverged"; readonly divergences: readonly Divergence[] }
  | { readonly status: "shape_only"; readonly reason: string }
  | { readonly status: "skipped"; readonly reason: string }
  | { readonly status: "error"; readonly error: string };

export interface FixtureResult {
  /** Relative path of the input fixture, e.g. "recall/recall_simple_query.json" */
  readonly fixture: string;
  /** The raw input sent to both implementations. */
  readonly input: Record<string, unknown>;
  /** The expected output (from expected/ file) after masking. */
  readonly expected: Record<string, unknown> | null;
  /** The actual output produced by the TS implementation. */
  readonly tsActual: unknown;
  /** The actual output produced by the live source binary (null if not available). */
  readonly liveActual: unknown | null;
  readonly outcome: FixtureOutcome;
}

// ── RunnerOptions ─────────────────────────────────────────────────────────────

export interface RunnerOptions {
  /** Root directory of the monorepo (used to resolve parity-oracle/). */
  readonly repoRoot: string;
  /**
   * When true, strict mode also asserts that the TS output has NO keys
   * beyond those declared in the expected file. Catches port over-extension.
   * Default: false (extra keys are a warning, not a divergence).
   */
  readonly strictExtraKeys?: boolean;
  /**
   * When true, adversarial probes (mutated inputs) are generated and run
   * alongside the happy-path corpus. Divergences found by probes are
   * first-class findings in the report.
   */
  readonly runAdversarialProbes?: boolean;
}

// ── Master parity report ──────────────────────────────────────────────────────

export interface SourceReport {
  readonly source: SourceId;
  readonly total: number;
  readonly matches: number;
  readonly shapeOnly: number;
  readonly skipped: number;
  readonly errored: number;
  readonly diverged: number;
  readonly fixtures: readonly FixtureResult[];
}

/**
 * The top-level output of `runParityCorpus`.
 *
 * Falsification condition: the 48-hour cutover gate is met when
 *   exit_code === 0 AND divergences.length === 0
 * across ALL three SourceReports over the 48-hour window.
 * Any single divergence entry falsifies the cutover claim.
 *
 * source: PHASE_PLAN.md §"Phase 6" — "48-hour dual-run with zero divergence"
 */
export interface ParityReport {
  readonly generatedAt: string; // ISO 8601 wall-clock; non-deterministic, informational only
  readonly sources: readonly SourceReport[];
  /** All divergences across all sources, flattened for quick scanning. */
  readonly divergences: readonly (Divergence & { fixture: string; source: SourceId })[];
  readonly total: number;
  readonly matches: number;
  readonly diverged: number;
  /** 0 = all matched (or skipped); 1 = at least one divergence. */
  readonly exit_code: 0 | 1;
}
