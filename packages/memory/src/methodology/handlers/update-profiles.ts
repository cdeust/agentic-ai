/**
 * Handler for incremental EMA profile update at session end.
 *
 * This is the Level-1 update surface exposed to the MCP layer.
 * It is a DIFFERENT operation from rebuild-profiles (full rescan, Level-2):
 *   - update-profiles: one session → one EMA step on the matching domain.
 *   - rebuild-profiles: full rescan → rebuild all domains from scratch.
 *
 * Bateson constraint: do not conflate these two levels. An EMA update is
 * cheap and incremental; a full rebuild is expensive and structural.
 *
 * source: mcp_server/handlers/record_session_end.py
 */

import type { DomainProfile, ProfilesStore, SessionData, SessionLogEntry } from "../types.js";
import { applySessionUpdate } from "../cognitive-profile.js";
import { detectDomain, cwdToProjectId } from "../domain-detector.js";
import { generateCritique } from "../session-critique.js";

// ── Domain resolution ─────────────────────────────────────────────────────────

function resolveDomain(
  domain: string | undefined,
  cwd: string | undefined,
  project: string | undefined,
  profiles: ProfilesStore,
): string {
  if (domain) return domain;
  if (!cwd && !project) return "unknown";

  const projId = project ?? cwdToProjectId(cwd);
  if (projId) {
    for (const [dId, d] of Object.entries(profiles.domains)) {
      if ((d.projects ?? []).includes(projId)) return dId;
    }
    // Derive a domain ID from the project label
    return projId.replace(/^-/, "").replace(/-([a-z])/g, (_m, c: string) => `-${c}`);
  }

  // Fall back to detection
  const detected = detectDomain({ cwd, project }, profiles);
  return detected.domain ?? "unknown";
}

// ── Session summary ───────────────────────────────────────────────────────────

function buildSessionSummary(
  sessionId: string,
  domainId: string,
  keywords: string[],
  toolsUsed: string[],
  turnCount: number | undefined,
  duration: number | undefined,
): string {
  const parts = [`Session ${sessionId} in domain '${domainId}'`];
  if (keywords.length > 0) parts.push(`topics: ${keywords.slice(0, 10).join(", ")}`);
  if (toolsUsed.length > 0) parts.push(`tools: ${toolsUsed.slice(0, 10).join(", ")}`);
  if (turnCount) parts.push(`${turnCount} turns`);
  if (duration) parts.push(`${(duration / 60_000).toFixed(1)}min`);
  return parts.join(" | ");
}

// ── Session log entry ─────────────────────────────────────────────────────────

export function buildSessionLogEntry(
  session: SessionData,
  domainId: string,
  category: string,
): SessionLogEntry {
  return {
    sessionId: session.sessionId,
    domain: domainId,
    timestamp: new Date().toISOString().replace("+00:00", "Z"),
    project: session.project ?? (session.cwd ? cwdToProjectId(session.cwd) : null),
    cwd: session.cwd ?? null,
    duration: session.duration ?? null,
    turnCount: session.turnCount ?? 0,
    toolsUsed: session.toolsUsed ?? [],
    category,
    entryKeywords: session.keywords ?? [],
  };
}

// ── Profile update ────────────────────────────────────────────────────────────

export interface UpdateProfilesResult {
  domain: string;
  profileUpdated: boolean;
  confidence: number;
  sessionSummary: string;
  critique: ReturnType<typeof generateCritique> | null;
  updatedProfile: DomainProfile | null;
}

/**
 * Apply an incremental EMA update to the domain profile for a single session.
 *
 * Returns the updated profile (caller must persist via infrastructure layer).
 *
 * source: mcp_server/handlers/record_session_end.py handler
 */
export function updateProfiles(
  session: SessionData,
  profiles: ProfilesStore,
): UpdateProfilesResult {
  const domainId = resolveDomain(session.domain, session.cwd, session.project, profiles);
  const dp = profiles.domains[domainId];

  if (!dp) {
    return {
      domain: domainId,
      profileUpdated: false,
      confidence: 0,
      sessionSummary: buildSessionSummary(
        session.sessionId, domainId, session.keywords ?? [],
        session.toolsUsed ?? [], session.turnCount, session.duration,
      ),
      critique: null,
      updatedProfile: null,
    };
  }

  applySessionUpdate(dp, {
    duration: session.duration,
    toolsUsed: session.toolsUsed,
    turnCount: session.turnCount,
  });

  const critique = generateCritique(
    session.toolsUsed ?? [],
    [],
    session.duration !== undefined ? session.duration / 60_000 : 0,
    session.turnCount ?? 0,
  );

  return {
    domain: domainId,
    profileUpdated: true,
    confidence: dp.confidence,
    sessionSummary: buildSessionSummary(
      session.sessionId, domainId, session.keywords ?? [],
      session.toolsUsed ?? [], session.turnCount, session.duration,
    ),
    critique,
    updatedProfile: dp,
  };
}
