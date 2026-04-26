/**
 * Session self-critique — structured reflection for metacognitive improvement.
 *
 * Analyzes tool usage patterns, decision quality signals, and coverage.
 * No LLM calls — pure computation on session data.
 *
 * source: mcp_server/core/session_critique.py
 * source: mcp_server/core/session_critique_format.py
 */

import type { CritiqueResult } from "./types.js";

// ── Expected tool distribution ────────────────────────────────────────────────

/** source: mcp_server/core/session_critique.py EXPECTED_TOOL_DISTRIBUTION */
const EXPECTED_TOOL_DISTRIBUTION: Record<string, number> = {
  Read: 0.25, Edit: 0.15, Write: 0.10, Grep: 0.10,
  Glob: 0.05, Bash: 0.15, Agent: 0.05, WebSearch: 0.05, WebFetch: 0.05,
};

// ── Regex patterns ────────────────────────────────────────────────────────────

/** source: mcp_server/core/session_critique_format.py _REVERSAL_RE */
const REVERSAL_RE = /\b(actually|instead|changed my mind|wait|no,|scratch that|let me redo|on second thought|reverted|rolled back)\b/i;
/** source: mcp_server/core/session_critique_format.py _DECISION_RE */
const DECISION_RE = /\b(decided|chose|switched|went with)\b/i;

// ── Tool usage analysis ───────────────────────────────────────────────────────

function countTools(toolsUsed: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const tool of toolsUsed) counts[tool] = (counts[tool] ?? 0) + 1;
  return counts;
}

function analyzeToolUsage(toolsUsed: string[]): {
  diversityScore: number;
  overReliance: string[];
  underUsed: string[];
  suggestions: string[];
} {
  if (toolsUsed.length === 0) {
    return {
      diversityScore: 0,
      overReliance: [],
      underUsed: Object.keys(EXPECTED_TOOL_DISTRIBUTION),
      suggestions: ["No tools were used in this session"],
    };
  }

  const total = toolsUsed.length;
  const counts = countTools(toolsUsed);
  const diversity = Math.min(1, Object.keys(counts).length / Math.max(1, Object.keys(EXPECTED_TOOL_DISTRIBUTION).length * 0.6));
  const overReliance = Object.entries(counts).filter(([, c]) => c / total > 0.5 && total > 5).map(([t]) => t);
  const underUsed = Object.keys(EXPECTED_TOOL_DISTRIBUTION).filter((t) => !(t in counts));

  const suggestions: string[] = [];
  if (overReliance.length > 0) {
    suggestions.push(`Heavy reliance on ${overReliance.join(", ")} — consider diversifying tool usage`);
  }
  if (underUsed.length > 3) {
    suggestions.push(`Unused tools: ${underUsed.slice(0, 3).join(", ")} — these might have been useful`);
  }
  if (diversity < 0.3) suggestions.push("Very low tool diversity — explore more tools");

  return { diversityScore: Math.round(diversity * 1000) / 1000, overReliance, underUsed, suggestions };
}

// ── Decision analysis ─────────────────────────────────────────────────────────

function analyzeDecisions(memories: Array<{ content?: string; tags?: string[]; confidence?: number }>): {
  decisionCount: number;
  reversalCount: number;
  confidenceAvg: number;
  suggestions: string[];
} {
  const decisions = memories.filter(
    (m) => (m.tags ?? []).some((t) => t.toLowerCase() === "decision") || DECISION_RE.test(m.content ?? ""),
  );
  const reversals = memories.filter((m) => REVERSAL_RE.test(m.content ?? ""));
  const confidences = decisions.map((m) => m.confidence ?? 0.5);
  const avg = confidences.length > 0 ? confidences.reduce((s, c) => s + c, 0) / confidences.length : 0.5;

  const suggestions: string[] = [];
  if (reversals.length > 2) suggestions.push(`${reversals.length} reversals detected — consider more upfront analysis`);
  if (avg < 0.5) suggestions.push("Low average decision confidence — gather more info before deciding");
  if (decisions.length === 0 && memories.length > 5) {
    suggestions.push("No explicit decisions recorded — consider documenting key choices");
  }

  return { decisionCount: decisions.length, reversalCount: reversals.length, confidenceAvg: Math.round(avg * 1000) / 1000, suggestions };
}

// ── Coverage analysis ─────────────────────────────────────────────────────────

function analyzeCoverage(filesTouched: string[]): {
  breadthScore: number;
  depthScore: number;
  suggestions: string[];
} {
  if (filesTouched.length === 0) return { breadthScore: 0, depthScore: 0, suggestions: [] };

  const uniqueDirs = new Set(filesTouched.filter((f) => f.includes("/")).map((f) => f.split("/").slice(0, -1).join("/")));
  const breadth = Math.min(1, uniqueDirs.size / 5);

  const fileCounts: Record<string, number> = {};
  for (const f of filesTouched) fileCounts[f] = (fileCounts[f] ?? 0) + 1;
  const depth = Math.min(1, Math.max(...Object.values(fileCounts), 0) / 5);

  const suggestions: string[] = [];
  if (breadth < 0.2 && filesTouched.length > 3) suggestions.push("Narrow focus — consider exploring adjacent files/modules");
  if (depth > 0.8 && breadth < 0.3) suggestions.push("Deep but narrow — might be missing the bigger picture");

  return { breadthScore: Math.round(breadth * 1000) / 1000, depthScore: Math.round(depth * 1000) / 1000, suggestions };
}

// ── Composite score ───────────────────────────────────────────────────────────

function computeOverallScore(
  toolDiversity: number,
  reversalCount: number,
  decisionCount: number,
  confidenceAvg: number,
  breadthScore: number,
): number {
  const reversalRatio = Math.min(1, reversalCount / Math.max(1, decisionCount));
  const scores = [toolDiversity, 1 - reversalRatio, confidenceAvg, breadthScore];
  return scores.reduce((s, v) => s + v, 0) / scores.length;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generate a full structured session critique.
 * source: mcp_server/core/session_critique.py generate_critique
 */
export function generateCritique(
  toolsUsed: string[],
  memories: Array<{ content?: string; tags?: string[]; confidence?: number }>,
  durationMinutes: number = 0,
  turnCount: number = 0,
): CritiqueResult {
  const toolAnalysis = analyzeToolUsage(toolsUsed);
  const decisionAnalysis = analyzeDecisions(memories);
  const coverageAnalysis = analyzeCoverage([]);

  const overall = computeOverallScore(
    toolAnalysis.diversityScore,
    decisionAnalysis.reversalCount,
    decisionAnalysis.decisionCount,
    decisionAnalysis.confidenceAvg,
    coverageAnalysis.breadthScore,
  );

  const allSuggestions = [
    ...toolAnalysis.suggestions,
    ...decisionAnalysis.suggestions,
    ...coverageAnalysis.suggestions,
  ];

  const lines: string[] = ["## Session Self-Critique", ""];
  if (durationMinutes > 0) {
    lines.push(`**Duration**: ${durationMinutes.toFixed(0)} min, ${turnCount} turns`, "");
  }
  lines.push(`**Overall Score**: ${(overall * 100).toFixed(0)}%`);
  lines.push(`- Tool diversity: ${(toolAnalysis.diversityScore * 100).toFixed(0)}%`);
  lines.push(`- Decision confidence: ${(decisionAnalysis.confidenceAvg * 100).toFixed(0)}%`);
  lines.push(`- Exploration breadth: ${(coverageAnalysis.breadthScore * 100).toFixed(0)}%`);
  lines.push("");
  if (allSuggestions.length > 0) {
    lines.push("**Improvements**:");
    for (const s of allSuggestions.slice(0, 5)) lines.push(`- ${s}`);
  } else {
    lines.push("*No significant issues detected.*");
  }

  return {
    overallScore: Math.round(overall * 1000) / 1000,
    topSuggestions: allSuggestions.slice(0, 5),
    critiqueText: lines.join("\n"),
  };
}
