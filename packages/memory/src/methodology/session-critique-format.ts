/**
 * Session critique formatting, scoring, and decision analysis helpers.
 *
 * Companion module to session-critique.ts — handles composite score
 * computation, markdown text formatting, and decision quality analysis.
 *
 * Pure business logic — no I/O.
 *
 * Port of: cortex@ed33435 mcp_server/core/session_critique_format.py
 */

// ── Decision Analysis ─────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/session_critique_format.py:16-25

const REVERSAL_RE = /\b(actually|instead|changed my mind|wait|no,|scratch that|let me redo|on second thought|reverted|rolled back)\b/i;
const DECISION_RE = /\b(decided|chose|switched|went with)\b/i;

/**
 * Check if a memory represents a decision.
 * source: cortex@ed33435 mcp_server/core/session_critique_format.py:28-33
 */
function isDecisionMemory(m: Record<string, unknown>): boolean {
  const tags = (m["tags"] ?? []) as string[];
  const hasDecisionTag = tags.some((t) => typeof t === "string" && t.toLowerCase() === "decision");
  const hasDecisionContent = DECISION_RE.test((m["content"] as string | undefined) ?? "");
  return hasDecisionTag || hasDecisionContent;
}

/**
 * Generate suggestions from decision analysis metrics.
 * source: cortex@ed33435 mcp_server/core/session_critique_format.py:36-56
 */
function decisionSuggestions(
  decisionCount: number,
  reversalCount: number,
  avgConfidence: number,
  memoryCount: number,
): string[] {
  const suggestions: string[] = [];
  if (reversalCount > 2) {
    suggestions.push(`${reversalCount} reversals detected — consider more upfront analysis`);
  }
  if (avgConfidence < 0.5) {
    suggestions.push("Low average decision confidence — gather more info before deciding");
  }
  if (decisionCount === 0 && memoryCount > 5) {
    suggestions.push("No explicit decisions recorded — consider documenting key choices");
  }
  return suggestions;
}

/**
 * Analyze decision quality from session memories.
 *
 * precondition:  memories is an array of memory records.
 * postcondition: returned object has decisionCount, reversalCount,
 *   confidenceAvg, suggestions.
 *
 * source: cortex@ed33435 mcp_server/core/session_critique_format.py:59-91
 */
export function analyzeDecisions(
  memories: Record<string, unknown>[],
  sessionMemories: Record<string, unknown>[] | null = null,
): Record<string, unknown> {
  const decisions = memories.filter((m) => isDecisionMemory(m));
  const reversals = (sessionMemories ?? memories).filter((m) =>
    REVERSAL_RE.test((m["content"] as string | undefined) ?? ""),
  );

  const confidences = decisions.map(
    (m) => (m["confidence"] as number | undefined) ?? 0.5,
  );
  const avgConfidence = confidences.length > 0
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : 0.5;

  return {
    decision_count: decisions.length,
    reversal_count: reversals.length,
    confidence_avg: Math.round(avgConfidence * 1000) / 1000,
    suggestions: decisionSuggestions(
      decisions.length,
      reversals.length,
      avgConfidence,
      memories.length,
    ),
  };
}

// ── Scoring & Formatting ──────────────────────────────────────────────────

/**
 * Compute composite critique score from sub-analyses.
 *
 * precondition:  all analysis objects have required numeric fields.
 * postcondition: result ∈ [0, 1].
 *
 * source: cortex@ed33435 mcp_server/core/session_critique_format.py:97-114
 */
export function computeOverallScore(
  toolAnalysis: Record<string, number>,
  decisionAnalysis: Record<string, number>,
  coverageAnalysis: Record<string, number>,
): number {
  const reversalRatio = Math.min(
    1.0,
    (decisionAnalysis["reversal_count"] ?? 0) /
      Math.max(1, decisionAnalysis["decision_count"] ?? 1),
  );
  const scores = [
    toolAnalysis["diversity_score"] ?? 0,
    1.0 - reversalRatio,
    decisionAnalysis["confidence_avg"] ?? 0,
    coverageAnalysis["breadth_score"] ?? 0,
  ];
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/**
 * Format the critique as a markdown summary.
 *
 * precondition:  overall ∈ [0, 1]; turnCount >= 0.
 * postcondition: returns a markdown string with ## Session Self-Critique header.
 *
 * source: cortex@ed33435 mcp_server/core/session_critique_format.py:117-146
 */
export function formatCritiqueText(
  overall: number,
  toolAnalysis: Record<string, number>,
  decisionAnalysis: Record<string, number>,
  coverageAnalysis: Record<string, number>,
  topSuggestions: string[],
  durationMinutes: number,
  turnCount: number,
): string {
  const lines = ["## Session Self-Critique", ""];

  if (durationMinutes > 0) {
    lines.push(`**Duration**: ${durationMinutes.toFixed(0)} min, ${turnCount} turns`);
    lines.push("");
  }

  lines.push(`**Overall Score**: ${(overall * 100).toFixed(0)}%`);
  lines.push(`- Tool diversity: ${((toolAnalysis["diversity_score"] ?? 0) * 100).toFixed(0)}%`);
  lines.push(`- Decision confidence: ${((decisionAnalysis["confidence_avg"] ?? 0) * 100).toFixed(0)}%`);
  lines.push(`- Exploration breadth: ${((coverageAnalysis["breadth_score"] ?? 0) * 100).toFixed(0)}%`);
  lines.push("");

  if (topSuggestions.length > 0) {
    lines.push("**Improvements**:");
    for (const s of topSuggestions) {
      lines.push(`- ${s}`);
    }
  } else {
    lines.push("*No significant issues detected.*");
  }

  return lines.join("\n");
}
