/**
 * Extract tool preferences and session shape from conversation data.
 *
 * Tool stats: ratio + avg-per-session. Session shape: burst / exploration / mixed.
 *
 * Pure business logic — no I/O.
 *
 * Port of: cortex@ed33435 mcp_server/core/session_shape.py
 */

// ── Session shape threshold constants ─────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/session_shape.py:69-70

const BURST_THRESHOLD_MS = 600_000;      // source: cortex@ed33435 mcp_server/core/session_shape.py:69
const EXPLORATION_THRESHOLD_TURNS = 20; // source: cortex@ed33435 mcp_server/core/session_shape.py:70

// ── Tool preferences ──────────────────────────────────────────────────────

/**
 * Count tool usage from a single session's toolsUsed list.
 * source: cortex@ed33435 mcp_server/core/session_shape.py:15-26
 */
function countToolsInSession(toolsUsed: unknown[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of toolsUsed) {
    if (typeof entry === "string") {
      counts[entry] = (counts[entry] ?? 0) + 1;
    } else if (entry && typeof entry === "object") {
      const e = entry as Record<string, unknown>;
      const name = (e["name"] ?? e["tool"] ?? e["toolName"]) as string | undefined;
      const count = ((e["count"] ?? e["uses"]) as number | undefined) ?? 1;
      if (name) {
        counts[name] = (counts[name] ?? 0) + count;
      }
    }
  }
  return counts;
}

/**
 * Compute per-tool ratio and avg-per-session across all conversations.
 *
 * precondition:  conversations is an array.
 * postcondition: returned map keys are tool names; values have ratio and
 *   avgPerSession; sorted by ratio descending.
 *
 * source: cortex@ed33435 mcp_server/core/session_shape.py:29-62
 */
export function extractToolPreferences(
  conversations: Record<string, unknown>[],
): Record<string, { ratio: number; avgPerSession: number }> {
  const totalSessions = conversations.length;
  if (totalSessions === 0) return {};

  const toolStats: Record<string, { sessionsUsing: Set<number>; totalUses: number }> = {};

  conversations.forEach((conv, sessionIdx) => {
    const toolsUsed = ((conv["toolsUsed"] ?? conv["tools_used"]) as unknown[] | undefined) ?? [];
    if (!Array.isArray(toolsUsed)) return;

    const counts = countToolsInSession(toolsUsed);
    for (const [toolName, count] of Object.entries(counts)) {
      if (!toolStats[toolName]) {
        toolStats[toolName] = { sessionsUsing: new Set(), totalUses: 0 };
      }
      toolStats[toolName].sessionsUsing.add(sessionIdx);
      toolStats[toolName].totalUses += count;
    }
  });

  const result: Record<string, { ratio: number; avgPerSession: number }> = {};
  for (const [toolName, stat] of Object.entries(toolStats)) {
    const sessionsUsingCount = stat.sessionsUsing.size;
    const avg = sessionsUsingCount > 0 ? stat.totalUses / sessionsUsingCount : 0;
    result[toolName] = {
      ratio: sessionsUsingCount / totalSessions,
      avgPerSession: avg,
    };
  }

  // Sort by ratio descending
  return Object.fromEntries(
    Object.entries(result).sort(([, a], [, b]) => b.ratio - a.ratio),
  );
}

// ── Session shape ─────────────────────────────────────────────────────────

/**
 * Return an empty session shape when no conversations exist.
 * source: cortex@ed33435 mcp_server/core/session_shape.py:73-81
 */
function emptyShape(): Record<string, unknown> {
  return {
    avgDuration: 0,
    avgTurns: 0,
    avgMessages: 0,
    burstRatio: 0,
    explorationRatio: 0,
    dominantMode: "mixed",
  };
}

/**
 * Extract duration, turn count, and message count from a conversation.
 * source: cortex@ed33435 mcp_server/core/session_shape.py:84-95
 */
function parseSessionMetrics(conv: Record<string, unknown>): [number, number, number] {
  const duration = ((conv["duration"] ?? conv["durationMs"]) as number | undefined) ?? 0;
  const turnCount = ((conv["turnCount"] ?? conv["turns"]) as number | undefined) ?? 0;
  let messageCount = (conv["messageCount"] as number | undefined) ?? 0;
  if (messageCount === 0) {
    const msgs = conv["messages"];
    if (Array.isArray(msgs)) messageCount = msgs.length;
  }
  return [duration, turnCount, messageCount];
}

/**
 * Classify dominant session mode based on ratios.
 * source: cortex@ed33435 mcp_server/core/session_shape.py:98-103
 */
function classifyDominantMode(burstRatio: number, explorationRatio: number): string {
  if (burstRatio > 0.6) return "burst";
  if (explorationRatio > 0.6) return "exploration";
  return "mixed";
}

/**
 * Classify session shape (burst/exploration/mixed) from conversation metadata.
 *
 * precondition:  conversations is an array.
 * postcondition: returned object has avgDuration, avgTurns, avgMessages,
 *   burstRatio, explorationRatio, dominantMode.
 *
 * source: cortex@ed33435 mcp_server/core/session_shape.py:106-140
 *   BURST_THRESHOLD_MS = 600_000; EXPLORATION_THRESHOLD_TURNS = 20
 */
export function extractSessionShape(
  conversations: Record<string, unknown>[],
): Record<string, unknown> {
  const total = conversations.length;
  if (total === 0) return emptyShape();

  let durationSum = 0;
  let turnsSum = 0;
  let messagesSum = 0;
  let burstCount = 0;
  let explorationCount = 0;

  for (const conv of conversations) {
    const [duration, turnCount, messageCount] = parseSessionMetrics(conv);
    durationSum += duration;
    turnsSum += turnCount;
    messagesSum += messageCount;
    if (duration < BURST_THRESHOLD_MS) burstCount++;
    if (turnCount > EXPLORATION_THRESHOLD_TURNS) explorationCount++;
  }

  const burstRatio = burstCount / total;
  const explorationRatio = explorationCount / total;

  return {
    avgDuration: durationSum / total,
    avgTurns: turnsSum / total,
    avgMessages: messagesSum / total,
    burstRatio,
    explorationRatio,
    dominantMode: classifyDominantMode(burstRatio, explorationRatio),
  };
}

// Re-export constants for testing
export { BURST_THRESHOLD_MS, EXPLORATION_THRESHOLD_TURNS };
