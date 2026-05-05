/**
 * Pattern blind spot detection helpers.
 *
 * Companion module to blindspot-detector.ts — detects missing exploration,
 * deep-work, and quick-iteration session patterns by comparing domain
 * statistics against global averages.
 *
 * Pure business logic — no I/O.
 *
 * source: cortex@ed33435 mcp_server/core/blindspot_patterns.py
 */

import type { BlindSpot } from "./types.js";

// ── Exploration gap ───────────────────────────────────────────────────────────

/**
 * Check for exploration session gaps vs global average.
 *
 * precondition: domainExplorationRatio in [0, 1], globalExpRatio in [0, 1]
 * postcondition: returns [] or a single-element array with a "pattern" BlindSpot
 *
 * source: cortex@ed33435 mcp_server/core/blindspot_patterns.py:15-50
 */
export function checkExplorationGap(
  domainExplorationRatio: number,
  globalExpRatio: number,
): BlindSpot[] {
  if (domainExplorationRatio === 0 && globalExpRatio >= 0.4) {
    return [
      {
        type: "pattern",
        value: "exploration",
        severity: "high",
        description:
          `This domain has zero exploration sessions (research/architecture),` +
          ` while globally ${(globalExpRatio * 100).toFixed(0)}% of sessions are exploratory.`,
        suggestion:
          "Schedule dedicated research or architecture sessions to avoid tunnel vision.",
      },
    ];
  }
  if (
    domainExplorationRatio > 0 &&
    domainExplorationRatio < globalExpRatio * 0.25 &&
    globalExpRatio >= 0.2
  ) {
    return [
      {
        type: "pattern",
        value: "exploration",
        severity: "medium",
        description:
          `Exploration ratio (${(domainExplorationRatio * 100).toFixed(1)}%) is significantly` +
          ` below global average (${(globalExpRatio * 100).toFixed(1)}%).`,
        suggestion:
          "Increase research/architecture sessions to keep up with global breadth.",
      },
    ];
  }
  return [];
}

// ── Duration bucket counting ──────────────────────────────────────────────────

/**
 * Count short (<10 min) and long (>30 min) sessions.
 *
 * precondition: conversations is an array of conversation records
 * postcondition: returns [shortCount, longCount] where both >= 0
 *
 * source: cortex@ed33435 mcp_server/core/blindspot_patterns.py:53-63
 */
export function countDurationBuckets(
  conversations: Array<{ durationMinutes?: number; duration?: number }>,
): [number, number] {
  let short = 0;
  let long = 0;
  for (const conv of conversations) {
    const dur = conv.durationMinutes ?? conv.duration ?? 0;
    if (dur > 0 && dur < 10) short++;
    if (dur > 30) long++;
  }
  return [short, long];
}

// ── Duration gap detection ────────────────────────────────────────────────────

/**
 * Check for missing deep-work or quick-iteration sessions.
 *
 * precondition: domainTotal > 0 (caller guards), ratios in [0, 1]
 * postcondition: returns BlindSpot[] with type "pattern" for each gap found
 *
 * source: cortex@ed33435 mcp_server/core/blindspot_patterns.py:66-101
 */
export function checkDurationGaps(
  domainTotal: number,
  domainShort: number,
  domainLong: number,
  globalShortRatio: number,
  globalLongRatio: number,
): BlindSpot[] {
  const gaps: BlindSpot[] = [];

  if (domainLong / domainTotal === 0 && globalLongRatio >= 0.3) {
    gaps.push({
      type: "pattern",
      value: "deep-work",
      severity: "medium",
      description:
        `No deep-work sessions (>30 min) found in this domain,` +
        ` while globally ${(globalLongRatio * 100).toFixed(0)}% of sessions are deep.`,
      suggestion:
        "Allocate longer focused sessions for complex problems in this domain.",
    });
  }

  if (domainShort / domainTotal === 0 && globalShortRatio >= 0.3) {
    gaps.push({
      type: "pattern",
      value: "quick-iteration",
      severity: "low",
      description:
        `No short iteration sessions (<10 min) found in this domain,` +
        ` while globally ${(globalShortRatio * 100).toFixed(0)}% of sessions are short.`,
      suggestion:
        "Consider quick experiment or fix sessions to build faster feedback loops.",
    });
  }

  return gaps;
}
