/**
 * record-session-end.ts — Record session-end signals and update profiles.
 *
 * Ports: handlers/record_session_end.py (390 LOC, 10 functions)
 *
 * Exposes two handler surfaces:
 *   - recordSessionEnd       — self-contained handler (Eng-12 port): reads and
 *                              writes profiles.json / session_log.json directly
 *                              via fs I/O helpers. Used by the legacy MCP wiring.
 *   - recordSessionEndHandler — thin composition root (Eng-15 port): delegates
 *                              EMA logic to update-profiles.ts. Used by the
 *                              new MCP server wiring that passes a ProfilesStore
 *                              from outside.
 *
 * Both handlers share: RecordSessionEndArgs, RecordSessionEndResult, schema.
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

import {
  buildSessionLogEntry,
  updateProfiles,
  type UpdateProfilesResult,
} from "./update-profiles.js";
import type { ProfilesStore, SessionData } from "../types.js";

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

const CATEGORY_KEYWORDS: Record<string, readonly string[]> = {
  debugging: ["bug", "error", "fix", "crash", "exception", "traceback"],
  architecture: ["design", "architecture", "refactor", "structure", "pattern"],
  performance: ["latency", "performance", "benchmark", "speed", "optimize"],
  documentation: ["docs", "readme", "comment", "docstring", "wiki"],
  testing: ["test", "spec", "assert", "coverage", "mock"],
  devops: ["deploy", "ci", "cd", "docker", "kubernetes", "pipeline"],
};

function categorize(text: string): string {
  const lower = text.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return category;
  }
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

// ── Schema ────────────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/record_session_end.py schema

export const schema = {
  title: "Record session end (incremental profile update)",
  description:
    "Record session-end signals (tools used, duration, turns, keywords) and " +
    "apply an incremental EMA update to the matching domain's cognitive profile. " +
    "Also stores an episodic session-summary memory, runs a session self-critique " +
    "(overall score + top improvement suggestions), and creates prospective triggers " +
    "from any TODO/decision keywords detected in the message stream. " +
    "Normally invoked automatically by the SessionEnd hook — call manually only " +
    "when reconstructing offline sessions. Distinct from `rebuild_profiles` (full " +
    "rescan from scratch) and `query_methodology` (read-only profile retrieval). " +
    "Mutates profiles.json + session-log.json + memories table.",
  inputSchema: {
    type: "object",
    required: ["session_id"],
    properties: {
      session_id: {
        type: "string",
        description:
          "Unique session identifier (Claude Code session UUID or similar). " +
          "Used as the row key in the session log.",
        examples: ["dbaca0ec-b346-464a-84b9-afe97b91d27d"],
      },
      domain: {
        type: "string",
        description: "Cognitive domain ID. Auto-detected from cwd/project if omitted.",
        examples: ["cortex", "auth-service"],
      },
      tools_used: {
        type: "array",
        description: "Names of MCP/CLI tools used during the session.",
        items: { type: "string" },
        default: [],
        examples: [["Read", "Edit", "Bash", "cortex:recall"]],
      },
      duration: {
        type: "number",
        description: "Session duration in milliseconds.",
        minimum: 0,
        examples: [1800000, 3600000],
      },
      turn_count: {
        type: "number",
        description: "Number of assistant turns in the session.",
        minimum: 0,
        examples: [12, 47],
      },
      keywords: {
        type: "array",
        description: "Key topics extracted from the session.",
        items: { type: "string" },
        default: [],
        examples: [["recall", "regression", "pgvector"]],
      },
      cwd: {
        type: "string",
        description: "Working directory the session ran in.",
        examples: ["/Users/alice/code/cortex"],
      },
      project: {
        type: "string",
        description:
          "Claude Code project identifier (slugified path). Falls back to derivation from cwd.",
        examples: ["-Users-alice-code-cortex"],
      },
    },
  },
} as const;

// ── Session memory builder (Eng-15 composition root path) ─────────────────────

interface MemoryArgs {
  content: string;
  tags: string[];
  directory: string;
  domain: string;
  source: string;
  force: boolean;
}

type RememberHandler = (args: MemoryArgs) => Promise<{ stored?: boolean } | undefined>;

/**
 * Build remember-handler args for an episodic session memory.
 *
 * source: cortex@ed33435 mcp_server/handlers/record_session_end.py:_store_session_memory
 */
function buildSessionMemoryArgs(
  sessionId: string,
  domainId: string,
  cwd: string,
  toolsUsed: string[],
  keywords: string[],
  duration: number | undefined,
  turnCount: number | undefined,
  category: string,
): MemoryArgs {
  const parts = [`Session ${sessionId} in domain '${domainId}'`];
  if (category && category !== "general") parts.push(`category: ${category}`);
  if (keywords.length > 0) parts.push(`topics: ${keywords.slice(0, 10).join(", ")}`);
  if (toolsUsed.length > 0) parts.push(`tools: ${toolsUsed.slice(0, 10).join(", ")}`);
  if (turnCount) parts.push(`${turnCount} turns`);
  if (duration) parts.push(`${(duration / 60_000).toFixed(1)}min`);
  const content = parts.join(" | ");

  const tags = [...new Set(["session-summary", category, ...keywords.slice(0, 5)])];

  return {
    content,
    tags,
    directory: cwd || "",
    domain: domainId,
    source: "session",
    force: false,
  };
}

// ── Handler args + response ───────────────────────────────────────────────────

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

// ── recordSessionEnd — self-contained handler (Eng-12 path) ──────────────

/**
 * Record session-end signals and update cognitive profile.
 *
 * Self-contained: reads/writes profiles.json and session_log.json directly.
 * Used by legacy MCP wiring that does not inject a ProfilesStore.
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

// ── recordSessionEndHandler — composition root (Eng-15 path) ─────────────

/**
 * Record session end: EMA profile update + optional session-memory storage.
 *
 * Thin composition root: delegates EMA logic to update-profiles.ts.
 * Used by new MCP server wiring that injects a ProfilesStore.
 *
 * Pre:  args.session_id is non-empty; profiles is the loaded profiles store.
 * Post: the domain's EMA is updated; a session-summary memory is optionally stored.
 *       Returns { domain, profileUpdated, memoryStored, confidence, critique }.
 *
 * source: cortex@ed33435 mcp_server/handlers/record_session_end.py:handler
 */
export async function recordSessionEndHandler(
  args: RecordSessionEndArgs,
  profiles: ProfilesStore,
  rememberHandler?: RememberHandler,
): Promise<RecordSessionEndResult> {
  const sessionData: SessionData = {
    sessionId: args.session_id,
    domain: args.domain ?? undefined,
    cwd: args.cwd ?? undefined,
    project: args.project ?? undefined,
    duration: args.duration ?? undefined,
    turnCount: args.turn_count ?? undefined,
    toolsUsed: args.tools_used ?? [],
    keywords: args.keywords ?? [],
  };

  const result: UpdateProfilesResult = updateProfiles(sessionData, profiles);

  // Store session-summary episodic memory if a remember handler is provided.
  let memoryStored = false;
  if (rememberHandler) {
    const keywords = args.keywords ?? [];
    const category = keywords.length > 0 ? categorize(keywords.join(" ")) : "general";
    const memArgs = buildSessionMemoryArgs(
      args.session_id,
      result.domain,
      args.cwd ?? "",
      args.tools_used ?? [],
      keywords,
      args.duration ?? undefined,
      args.turn_count ?? undefined,
      category,
    );
    try {
      const memResult = await rememberHandler(memArgs);
      memoryStored = Boolean(memResult?.stored);
    } catch {
      // Non-fatal: session summary memory failure must not abort session end.
    }
  }

  // Map CritiqueResult (camelCase from update-profiles) → snake_case for the
  // shared RecordSessionEndResult interface.
  // source: cortex@ed33435 mcp_server/handlers/record_session_end.py — critique keys
  const critiqueRaw = result.critique;
  const critique = critiqueRaw
    ? {
        overall_score: (critiqueRaw as unknown as { overallScore?: number; overall_score?: number }).overallScore
          ?? (critiqueRaw as unknown as { overall_score?: number }).overall_score
          ?? 0,
        top_suggestions: (critiqueRaw as unknown as { topSuggestions?: string[]; top_suggestions?: string[] }).topSuggestions
          ?? (critiqueRaw as unknown as { top_suggestions?: string[] }).top_suggestions
          ?? [],
      }
    : null;

  return {
    domain: result.domain,
    profileUpdated: result.profileUpdated,
    memoryStored,
    newPatterns: [],
    confidence: result.confidence,
    critique,
  };
}
