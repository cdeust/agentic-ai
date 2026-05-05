/**
 * record-session-end.ts — Record session-end signals and update profiles.
 *
 * Ports: handlers/record_session_end.py (390 LOC, 10 functions)
 *
 * Composition root: validates input, resolves domain, logs session,
 * applies incremental EMA update to the matching domain profile,
 * stores an episodic session summary memory, and runs session critique.
 *
 * Normally invoked automatically by the SessionEnd hook. Call manually
 * only when reconstructing offline sessions.
 *
 * source: cortex@ed33435 mcp_server/handlers/record_session_end.py
 *
 * Correctness contract:
 *   pre:  args.session_id is a non-empty string.
 *   post: session log is appended; IF domain profile exists, it is
 *         updated via EMA and persisted (D5: targeted per-domain write).
 *         On any single-step failure, remaining steps are attempted
 *         (best-effort). Returns {domain, profileUpdated, memoryStored, ...}.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Constants ──────────────────────────────────────────────────────────────

// source: cortex@ed33435 mcp_server/handlers/record_session_end.py:_append_session_log — rolling cap
const SESSION_LOG_MAX = 1000;

// source: SI — 60000ms per minute
const MS_PER_MINUTE = 60000;

// source: cortex@ed33435 mcp_server/handlers/record_session_end.py:_build_session_summary — truncation
const SUMMARY_TOP_KEYWORDS = 10;
const SUMMARY_TOP_TOOLS = 10;
const SUMMARY_ROUND_DECIMALS = 10;

// source: cortex@ed33435 mcp_server/handlers/record_session_end.py:_store_session_memory — tag limit
const MEMORY_TAG_KEYWORD_LIMIT = 5;

// source: cortex@ed33435 mcp_server/core/session_critique.py:generate_critique — scoring constants
const CRITIQUE_NEUTRAL_SCORE = 0.5;
const CRITIQUE_LONG_SESSION_TURNS = 50;
const CRITIQUE_LONG_SESSION_PENALTY = 0.1;
const CRITIQUE_LONG_DURATION_MINUTES = 120; // source: cortex@ed33435 mcp_server/core/session_critique.py — 2h session threshold
const CRITIQUE_LONG_DURATION_PENALTY = 0.05; // source: cortex@ed33435 mcp_server/core/session_critique.py — 2h+ score penalty
const CRITIQUE_NO_RECALL_PENALTY = 0.1;
const CRITIQUE_NO_REMEMBER_PENALTY = 0.05; // source: cortex@ed33435 mcp_server/core/session_critique.py — no-remember score penalty
const CRITIQUE_PRODUCTIVE_BONUS = 0.1;
const CRITIQUE_MAX_SUGGESTIONS = 3;

// source: cortex@ed33435 mcp_server/shared/project_ids.py:cwd_to_project_id — last N path components
const PROJECT_ID_PATH_PARTS = -2;

// source: cortex@ed33435 mcp_server/core/profile_builder.py:apply_session_update — EMA alpha
const EMA_ALPHA = 0.1;

// ── I/O helpers ───────────────────────────────────────────────────────────

function methodologyDir(): string {
  return join(homedir(), ".claude", "methodology");
}

function loadProfiles(): Record<string, unknown> {
  const p = join(methodologyDir(), "profiles.json");
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function saveProfile(domainId: string, profile: unknown): void {
  const dir = methodologyDir();
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "profiles.json");
  const profiles = loadProfiles();
  const domains = (profiles["domains"] ?? {}) as Record<string, unknown>;
  domains[domainId] = profile;
  profiles["domains"] = domains;
  writeFileSync(p, JSON.stringify(profiles, null, 2), "utf-8");
}

function loadSessionLog(): { sessions: unknown[] } {
  const p = join(methodologyDir(), "session_log.json");
  if (!existsSync(p)) return { sessions: [] };
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as { sessions: unknown[] };
  } catch {
    return { sessions: [] };
  }
}

function saveSessionLog(log: { sessions: unknown[] }): void {
  const dir = methodologyDir();
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "session_log.json");
  writeFileSync(p, JSON.stringify(log, null, 2), "utf-8");
}

// ── Domain resolution ─────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/record_session_end.py:_resolve_domain

/**
 * Resolve domain ID from explicit arg, cwd, or project.
 *
 * pre:  at least one of domain/cwd/project may be non-null.
 * post: returns a non-empty domain string; defaults to "unknown".
 */
function resolveDomain(
  domain: string | null | undefined,
  cwd: string | null | undefined,
  project: string | null | undefined,
  profiles: Record<string, unknown>,
): string {
  if (domain) return domain;

  const projId = project ?? cwdToProjectId(cwd);
  if (!projId) return "unknown";

  const domains = (profiles["domains"] ?? {}) as Record<string, { projects?: string[] }>;
  for (const [dId, d] of Object.entries(domains)) {
    if (d.projects?.includes(projId)) return dId;
  }

  // Derive from label (lightweight port of domain_id_from_label)
  // source: cortex@ed33435 mcp_server/shared/project_ids.py:domain_id_from_label
  const label = projectIdToLabel(projId);
  return domainIdFromLabel(label);
}

function cwdToProjectId(cwd: string | null | undefined): string | null {
  if (!cwd) return null;
  const parts = cwd.replace(/\/+$/, "").split("/");
  return parts.slice(PROJECT_ID_PATH_PARTS).join("/") || null;
}

function projectIdToLabel(projId: string): string {
  return projId.replace(/-/g, " ").replace(/\//g, " ").trim();
}

function domainIdFromLabel(label: string): string {
  const lower = label.toLowerCase();
  if (lower.includes("cortex") || lower.includes("memory")) return "cortex";
  if (lower.includes("auth") || lower.includes("security")) return "auth";
  if (lower.includes("api") || lower.includes("service")) return "api";
  return "unknown";
}

// ── Session summary ───────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/record_session_end.py:_build_session_summary

/**
 * Build a concise one-line summary of the session.
 *
 * pre:  sessionId and domainId are non-empty strings.
 * post: returns a pipe-separated summary string.
 */
function buildSessionSummary(
  sessionId: string,
  domainId: string,
  category: string,
  keywords: string[],
  toolsUsed: string[],
  turnCount: number | null | undefined,
  duration: number | null | undefined,
): string {
  const parts = [`Session ${sessionId} in domain '${domainId}'`];
  if (category && category !== "general") parts.push(`category: ${category}`);
  if (keywords.length > 0) parts.push(`topics: ${keywords.slice(0, SUMMARY_TOP_KEYWORDS).join(", ")}`);
  if (toolsUsed.length > 0) parts.push(`tools: ${toolsUsed.slice(0, SUMMARY_TOP_TOOLS).join(", ")}`);
  if (turnCount) parts.push(`${turnCount} turns`);
  if (duration) {
    const mins = Math.round(duration / MS_PER_MINUTE * SUMMARY_ROUND_DECIMALS) / SUMMARY_ROUND_DECIMALS;
    parts.push(`${mins}min`);
  }
  return parts.join(" | ");
}

// ── Memory tags ───────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/record_session_end.py:_build_memory_tags

function buildMemoryTags(category: string, keywords: string[]): string[] {
  return [...new Set(["session-summary", category, ...keywords.slice(0, MEMORY_TAG_KEYWORD_LIMIT)])];
}

// ── Categorize ────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/shared/categorizer.py:categorize

function categorize(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("bug") || lower.includes("fix") || lower.includes("error")) return "bug-fix";
  if (lower.includes("feature") || lower.includes("implement") || lower.includes("add")) return "feature";
  if (lower.includes("refactor") || lower.includes("clean") || lower.includes("migrate")) return "refactor";
  if (lower.includes("test") || lower.includes("spec") || lower.includes("assert")) return "testing";
  if (lower.includes("doc") || lower.includes("readme") || lower.includes("comment")) return "documentation";
  if (lower.includes("recall") || lower.includes("memory") || lower.includes("cortex")) return "memory-ops";
  return "general";
}

// ── Session entry ─────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/record_session_end.py:_build_session_entry

function buildSessionEntry(
  sessionId: string,
  domainId: string,
  cwd: string | null | undefined,
  project: string | null | undefined,
  duration: number | null | undefined,
  turnCount: number | null | undefined,
  toolsUsed: string[] | null | undefined,
  category: string,
  keywords: string[] | null | undefined,
): Record<string, unknown> {
  return {
    sessionId,
    domain: domainId,
    // Wall-clock timestamp — informational only; causality determined by
    // happens-before ordering in the session lifecycle hook.
    timestamp: new Date().toISOString(),
    project: project ?? cwdToProjectId(cwd),
    cwd,
    duration,
    turnCount: turnCount ?? 0,
    toolsUsed: toolsUsed ?? [],
    category,
    entryKeywords: keywords ?? [],
  };
}

// ── Append session ────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/record_session_end.py:_append_session_log

function appendSessionLog(log: { sessions: unknown[] }, entry: Record<string, unknown>): void {
  log.sessions.push(entry);
  if (log.sessions.length > SESSION_LOG_MAX) {
    log.sessions = log.sessions.slice(-SESSION_LOG_MAX);
  }
  saveSessionLog(log);
}

// ── EMA profile update ────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/record_session_end.py:_update_profile
// source: cortex@ed33435 mcp_server/core/profile_builder.py:apply_session_update

/**
 * Apply incremental EMA profile update.
 *
 * pre:  profiles is the loaded profile dict; domainId is non-empty.
 * post: IF domain profile exists, it is mutated in-place and persisted via
 *       save_profile (D5: targeted per-domain write). Returns (updated, profile).
 *
 * EMA: new = α * current + (1 − α) * old, α = 0.1
 * source: standard EMA; α=0.1 is the Cortex methodology default.
 */
function updateProfile(
  profiles: Record<string, unknown>,
  domainId: string,
  duration: number | null | undefined,
  toolsUsed: string[] | null | undefined,
  turnCount: number | null | undefined,
): { updated: boolean; profile: Record<string, unknown> | null } {
  const domains = (profiles["domains"] ?? {}) as Record<string, Record<string, unknown>>;
  const dp = domains[domainId];
  if (!dp) return { updated: false, profile: null };

  // EMA smoothing factor — methodology default (see EMA_ALPHA constant above)
  const alpha = EMA_ALPHA;
  const tc = turnCount ?? 0;
  const prevAvg = (dp["avgTurnCount"] as number | undefined) ?? tc;
  dp["avgTurnCount"] = alpha * tc + (1 - alpha) * prevAvg;

  const sessionCount = ((dp["sessionCount"] as number | undefined) ?? 0) + 1;
  dp["sessionCount"] = sessionCount;
  dp["lastSessionAt"] = new Date().toISOString();

  const toolFreq = (dp["toolFrequency"] as Record<string, number> | undefined) ?? {};
  for (const tool of (toolsUsed ?? [])) {
    toolFreq[tool] = ((toolFreq[tool] ?? 0) as number) + 1;
  }
  dp["toolFrequency"] = toolFreq;

  if (duration !== null && duration !== undefined) {
    const prevDuration = (dp["avgDurationMs"] as number | undefined) ?? duration;
    dp["avgDurationMs"] = alpha * duration + (1 - alpha) * prevDuration;
  }

  // D5: write only the one changed domain
  saveProfile(domainId, dp);
  return { updated: true, profile: dp };
}

// ── Session critique ──────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/record_session_end.py:_try_generate_critique
// source: cortex@ed33435 mcp_server/core/session_critique.py:generate_critique

/**
 * Generate session self-critique (non-fatal).
 *
 * pre:  toolsUsed is a string array; duration and turnCount may be null.
 * post: returns a lightweight critique dict or null on failure.
 */
function tryGenerateCritique(
  toolsUsed: string[],
  duration: number | null | undefined,
  turnCount: number | null | undefined,
): { overall_score: number; top_suggestions: string[] } | null {
  try {
    const tc = turnCount ?? 0;
    const durationMin = duration ? duration / MS_PER_MINUTE : 0;

    let score = CRITIQUE_NEUTRAL_SCORE;
    const suggestions: string[] = [];

    // Heuristic critique rules
    // source: cortex@ed33435 mcp_server/core/session_critique.py:generate_critique
    if (tc > CRITIQUE_LONG_SESSION_TURNS) {
      score -= CRITIQUE_LONG_SESSION_PENALTY;
      suggestions.push("Long session — consider breaking into shorter focused sessions.");
    }
    if (durationMin > CRITIQUE_LONG_DURATION_MINUTES) {
      score -= CRITIQUE_LONG_DURATION_PENALTY;
      suggestions.push("Session over 2h — schedule a break/checkpoint.");
    }
    if (!toolsUsed.includes("cortex:recall")) {
      score -= CRITIQUE_NO_RECALL_PENALTY;
      suggestions.push("No recall calls detected — run recall before non-trivial work.");
    }
    if (!toolsUsed.includes("cortex:remember")) {
      score -= CRITIQUE_NO_REMEMBER_PENALTY;
      suggestions.push("No remember calls — key findings may be lost.");
    }
    if (
      toolsUsed.includes("Edit") ||
      toolsUsed.includes("Write") ||
      toolsUsed.includes("Bash")
    ) {
      score += CRITIQUE_PRODUCTIVE_BONUS;
    }

    return {
      overall_score: Math.max(0, Math.min(1, score)),
      top_suggestions: suggestions.slice(0, CRITIQUE_MAX_SUGGESTIONS),
    };
  } catch {
    return null;
  }
}

// ── Handler ───────────────────────────────────────────────────────────────

export interface RecordSessionEndArgs {
  session_id: string;
  domain?: string | null;
  cwd?: string | null;
  project?: string | null;
  tools_used?: string[] | null;
  duration?: number | null;
  turn_count?: number | null;
  keywords?: string[] | null;
}

export interface RecordSessionEndResult {
  domain: string;
  profileUpdated: boolean;
  memoryStored: boolean;
  newPatterns: unknown[];
  confidence: number;
  critique: { overall_score: number; top_suggestions: string[] } | null;
}

/**
 * Record session-end signals and update cognitive profile.
 *
 * source: cortex@ed33435 mcp_server/handlers/record_session_end.py:handler
 */
export async function recordSessionEnd(
  args: RecordSessionEndArgs,
  // Optional: store for session memory persistence
  storeMemory?: (content: string, tags: string[], domain: string, cwd: string) => Promise<boolean>,
): Promise<RecordSessionEndResult> {
  const { session_id, cwd, project, tools_used, duration, turn_count, keywords } = args;

  const profiles = loadProfiles();
  const domainId = resolveDomain(args.domain, cwd, project, profiles);
  const category = keywords?.length ? categorize(keywords.join(" ")) : "general";

  const sessionEntry = buildSessionEntry(
    session_id,
    domainId,
    cwd,
    project,
    duration,
    turn_count,
    tools_used,
    category,
    keywords,
  );
  const sessionLog = loadSessionLog();
  appendSessionLog(sessionLog, sessionEntry);

  const { updated: profileUpdated, profile: dp } = updateProfile(
    profiles,
    domainId,
    duration,
    tools_used,
    turn_count,
  );

  // Store session episodic memory (best-effort)
  let memoryStored = false;
  if (storeMemory) {
    try {
      const summary = buildSessionSummary(
        session_id,
        domainId,
        category,
        keywords ?? [],
        tools_used ?? [],
        turn_count,
        duration,
      );
      const tags = buildMemoryTags(category, keywords ?? []);
      memoryStored = await storeMemory(summary, tags, domainId, cwd ?? "");
    } catch {
      // non-fatal
    }
  }

  const critique = tryGenerateCritique(tools_used ?? [], duration, turn_count);

  return {
    domain: domainId,
    profileUpdated,
    memoryStored,
    newPatterns: [],
    confidence: dp ? (dp["confidence"] as number | undefined) ?? 0 : 0,
    critique,
  };
}

export const schema = {
  title: "Record session end (incremental profile update)",
  description:
    "Record session-end signals (tools used, duration, turns, keywords) " +
    "and apply an incremental EMA update to the matching domain cognitive profile. " +
    "Also stores an episodic session-summary memory and runs a session self-critique. " +
    "Mutates profiles.json + session-log.json + memories table. " +
    "Returns {domain, profileUpdated, memoryStored, critique}.",
  inputSchema: {
    type: "object",
    required: ["session_id"],
    properties: {
      session_id: { type: "string" },
      domain: { type: "string" },
      cwd: { type: "string" },
      project: { type: "string" },
      tools_used: { type: "array", items: { type: "string" } },
      duration: { type: "number" },
      turn_count: { type: "number" },
      keywords: { type: "array", items: { type: "string" } },
    },
  },
};
