/**
 * @agentic/parity-runner — report.ts
 *
 * Produces a ParityReport from an array of SourceReports.
 *
 * The report is the terminal artifact of the harness. It is the claim
 * that "these fixtures match (or diverge) between the TS port and the
 * live source binary." exit_code 0 is the falsifiable cutover claim.
 *
 * source: PHASE_PLAN.md §"Phase 6" — "48-hour dual-run with zero divergence."
 */

import type {
  Divergence,
  FixtureResult,
  ParityReport,
  SourceId,
  SourceReport,
} from "./types.js";

// ── SourceReport builder ──────────────────────────────────────────────────────

/** Build a SourceReport from a list of FixtureResults for one source. */
export function buildSourceReport(
  source: SourceId,
  fixtures: readonly FixtureResult[],
): SourceReport {
  let matches = 0;
  let shapeOnly = 0;
  let skipped = 0;
  let errored = 0;
  let diverged = 0;

  for (const f of fixtures) {
    switch (f.outcome.status) {
      case "match":
        matches++;
        break;
      case "shape_only":
        shapeOnly++;
        break;
      case "skipped":
        skipped++;
        break;
      case "error":
        errored++;
        break;
      case "diverged":
        diverged++;
        break;
    }
  }

  return {
    source,
    total: fixtures.length,
    matches,
    shapeOnly,
    skipped,
    errored,
    diverged,
    fixtures,
  };
}

// ── Master report builder ─────────────────────────────────────────────────────

/**
 * Aggregate all SourceReports into a single master ParityReport.
 *
 * Falsification condition: exit_code === 0 iff divergences.length === 0.
 * Any divergence — across any source, any fixture, any probe — falsifies
 * the cutover claim.
 *
 * source: Popper (1959) Ch. 3 §"The Asymmetry between Verification and Falsification."
 *         One counter-instance overrides a thousand confirmations.
 */
export function buildParityReport(
  sources: readonly SourceReport[],
): ParityReport {
  let total = 0;
  let matches = 0;
  let diverged = 0;
  const allDivergences: (Divergence & { fixture: string; source: SourceId })[] =
    [];

  for (const s of sources) {
    total += s.total;
    matches += s.matches + s.shapeOnly; // shape_only counts as a passing check
    diverged += s.diverged + s.errored;

    for (const f of s.fixtures) {
      if (f.outcome.status === "diverged") {
        for (const d of f.outcome.divergences) {
          allDivergences.push({ ...d, fixture: f.fixture, source: s.source });
        }
      }
    }
  }

  const exitCode: 0 | 1 = allDivergences.length === 0 && diverged === 0 ? 0 : 1;

  return {
    generatedAt: new Date().toISOString(),
    sources,
    divergences: allDivergences,
    total,
    matches,
    diverged,
    exit_code: exitCode,
  };
}

// ── Console summary printer ───────────────────────────────────────────────────

/**
 * Print a one-line summary per source to stderr, then a master verdict.
 *
 * Design: stderr only — stdout is reserved for the JSON report piped to files.
 * source: modelcontextprotocol.io/quickstart/server §"Logging in MCP Servers"
 *         (same principle: stdout is a structured channel, stderr is human output).
 */
export function printReport(report: ParityReport): void {
  for (const s of report.sources) {
    const icon = s.diverged === 0 && s.errored === 0 ? "OK" : "FAIL";
    process.stderr.write(
      `[parity:${s.source}] ${icon} ` +
        `total=${s.total} match=${s.matches} shape_only=${s.shapeOnly} ` +
        `skipped=${s.skipped} diverged=${s.diverged} errored=${s.errored}\n`,
    );
  }

  if (report.exit_code === 0) {
    process.stderr.write(
      `[parity] PASS — ${report.matches}/${report.total} fixtures match. ` +
        `exit_code=0\n`,
    );
  } else {
    process.stderr.write(
      `[parity] FAIL — ${report.diverged} divergence(s) found across ` +
        `${report.total} fixtures. exit_code=1\n`,
    );
    // Print first 20 divergences as diagnostic detail.
    // source: Mayo (1996) Ch. 6 — "maximum diagnostic detail on failure."
    const maxPrint = 20; // source: arbitrary readability limit
    const shown = report.divergences.slice(0, maxPrint);
    for (const d of shown) {
      process.stderr.write(
        `  [${d.source}/${d.fixture}] ${d.kind} at "${d.path}" ` +
          `expected=${JSON.stringify(d.expected)} ` +
          `actual=${JSON.stringify(d.actual)}` +
          (d.note ? ` note="${d.note}"` : "") +
          "\n",
      );
    }
    if (report.divergences.length > maxPrint) {
      process.stderr.write(
        `  ... and ${report.divergences.length - maxPrint} more divergence(s) (see JSON report)\n`,
      );
    }
  }
}
