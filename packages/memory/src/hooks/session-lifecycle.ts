/**
 * SessionEnd hook — EMA profile update and memory consolidation.
 *
 * Fires when a Claude Code session ends. Reads session event data from
 * stdin, determines the relevant domain, logs the session, and updates
 * the methodology profile for the detected domain via EMA.
 *
 * Consolidation depth is gated by session activity:
 *   - source: Borbely (1982): consolidation pressure accumulates.
 *   - source: Tononi & Cirelli (2003) SHY: wakefulness builds synaptic weight.
 *   - source: Dewar et al. (2012): rest after encoding boosts retention.
 *   - source: McClelland et al. (1995) CLS: interleaved replay for transfer.
 *
 * Happens-before contract (Lamport 1978, §2):
 *   I1: this hook fires AFTER the last tool call in the session.
 *       No ordering assumption with hooks from previous sessions.
 *   I2: profile load MUST complete before the EMA update is applied.
 *       (Causal dependency: apply_session_update reads the loaded profile.)
 *   I3: session log append MUST complete before save (within same process).
 *   I4: profile save targets only the updated domain — does NOT rewrite
 *       other domains. (D5 targeted write invariant from Python source.)
 *   I5: consolidation fires AFTER profile save (best-effort, non-blocking).
 *
 * Timing ambiguity (open question for cross-audit):
 *   SessionEnd has no explicit timeout in the Python source. The hook
 *   runs synchronously. On long sessions (>20 turns) the full dream cycle
 *   (decay + compress + CLS) may take several seconds. There is no
 *   documented Claude Code timeout for SessionEnd — if Claude Code kills
 *   the hook process after an implicit timeout, the consolidation may be
 *   partially applied.
 *   → flagged as OQ-SESSION-END-TIMEOUT for genius cross-audit.
 *
 * Exit codes:
 *   exit 0 → success
 *   exit 1 → failure (profile update failed); logged to stderr
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type SessionEndEvent } from "./types.js";

const LOG_PREFIX = "[methodology-hook]";
const MAX_SESSION_LOG_ENTRIES = 1000;

function log(msg: string): void {
  process.stderr.write(`${LOG_PREFIX} ${msg}\n`);
}

// ── Profile I/O ───────────────────────────────────────────────────────────

function methodologyDir(): string {
  return join(homedir(), ".claude", "methodology");
}

function loadProfiles(): Record<string, unknown> {
  const profilePath = join(methodologyDir(), "profiles.json");
  if (!existsSync(profilePath)) return {};
  try {
    return JSON.parse(readFileSync(profilePath, "utf-8")) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

function saveProfile(domainId: string, profile: unknown): void {
  const dir = methodologyDir();
  mkdirSync(dir, { recursive: true });
  const profilePath = join(dir, "profiles.json");
  const profiles = loadProfiles();
  const domains = (profiles["domains"] ?? {}) as Record<string, unknown>;
  domains[domainId] = profile;
  profiles["domains"] = domains;
  writeFileSync(profilePath, JSON.stringify(profiles, null, 2), "utf-8");
}

// ── Session log I/O ───────────────────────────────────────────────────────

function loadSessionLog(): Record<string, unknown> {
  const logPath = join(methodologyDir(), "session_log.json");
  if (!existsSync(logPath)) return { sessions: [] };
  try {
    return JSON.parse(readFileSync(logPath, "utf-8")) as Record<
      string,
      unknown
    >;
  } catch {
    return { sessions: [] };
  }
}

function saveSessionLog(log: Record<string, unknown>): void {
  const dir = methodologyDir();
  mkdirSync(dir, { recursive: true });
  const logPath = join(dir, "session_log.json");
  writeFileSync(logPath, JSON.stringify(log, null, 2), "utf-8");
}

// ── Domain resolution ─────────────────────────────────────────────────────

function cwdToProjectId(cwd: string | undefined): string | null {
  if (!cwd) return null;
  // Simple hash: last two path components as an identifier
  const parts = cwd.replace(/\/+$/, "").split("/");
  return parts.slice(-2).join("/") || null;
}

function resolveDomain(
  event: SessionEndEvent,
  profiles: Record<string, unknown>,
): string {
  const projId = event.project ?? cwdToProjectId(event.cwd);
  if (!projId) return "unknown";

  const domains = (profiles["domains"] ?? {}) as Record<
    string,
    { projects?: string[] }
  >;
  for (const [domainId, domain] of Object.entries(domains)) {
    if (domain.projects?.includes(projId)) {
      return domainId;
    }
  }

  return "unknown";
}

// ── EMA update ────────────────────────────────────────────────────────────

/**
 * Apply an EMA session update to the domain profile.
 * source: exponential moving average — standard profile-update pattern
 *         in the Python methodology module.
 *
 * EMA: new = α * current_session + (1 - α) * old
 * α is typically 0.1 (slow adaptation) for methodology profiles.
 */
function applySessionUpdate(
  domainProfile: Record<string, unknown>,
  sessionData: {
    duration?: number;
    tools_used?: string[];
    turn_count?: number;
  },
): void {
  const alpha = 0.1; // EMA smoothing factor
  const turnCount = sessionData.turn_count ?? 0;

  // Update avgTurnCount via EMA
  const prevAvg = (domainProfile["avgTurnCount"] as number | undefined) ?? turnCount;
  domainProfile["avgTurnCount"] = alpha * turnCount + (1 - alpha) * prevAvg;

  // Track session count
  const sessionCount = ((domainProfile["sessionCount"] as number | undefined) ?? 0) + 1;
  domainProfile["sessionCount"] = sessionCount;

  // Record last session timestamp (wall-clock — informational only, not ordering)
  domainProfile["lastSessionAt"] = new Date().toISOString();

  // Tool usage frequency update
  const toolsUsed = sessionData.tools_used ?? [];
  const toolFreq = (domainProfile["toolFrequency"] as Record<string, number> | undefined) ?? {};
  for (const tool of toolsUsed) {
    toolFreq[tool] = ((toolFreq[tool] ?? 0) as number) + 1;
  }
  domainProfile["toolFrequency"] = toolFreq;
}

// ── Session log append ────────────────────────────────────────────────────

function buildSessionEntry(
  event: SessionEndEvent,
  domainId: string,
): Record<string, unknown> {
  return {
    sessionId: event.session_id,
    domain: domainId,
    // NOTE: wall-clock timestamp here is informational only.
    // Causality is established by the happens-before chain, not this timestamp.
    timestamp: new Date().toISOString(),
    project: event.project ?? cwdToProjectId(event.cwd),
    cwd: event.cwd,
    duration: event.duration,
    turnCount: event.turn_count ?? 0,
    toolsUsed: event.tools_used ?? [],
    entryKeywords: event.keywords ?? [],
  };
}

function appendSession(
  sessionLog: Record<string, unknown>,
  entry: Record<string, unknown>,
): void {
  let sessions = (sessionLog["sessions"] as unknown[]) ?? [];
  sessions = [...sessions, entry];
  if (sessions.length > MAX_SESSION_LOG_ENTRIES) {
    sessions = sessions.slice(-MAX_SESSION_LOG_ENTRIES);
  }
  sessionLog["sessions"] = sessions;
}

// ── Consolidation stub ────────────────────────────────────────────────────

async function runConsolidation(turnCount: number): Promise<void> {
  // In the full port: route through consolidation handler (merge order #4).
  // Depth gate:
  //   <5 turns: light (decay only)
  //   5-20 turns: standard (decay + compress)
  //   >20 turns: full dream cycle (decay + compress + CLS)
  // source: Borbely (1982), Tononi & Cirelli (2003), Dewar et al. (2012),
  //         McClelland et al. (1995)
  const mode =
    turnCount < 5 ? "light" : turnCount < 20 ? "standard" : "full";
  log(`consolidation stub: mode=${mode} (wire to consolidation when merged)`);
  // TODO: wire to packages/memory/src/consolidation/ (merge order #4).
}

// ── Main handler ──────────────────────────────────────────────────────────

export async function processEvent(
  event: SessionEndEvent | null,
): Promise<void> {
  if (!event?.session_id) {
    log("No session_id in event, skipping");
    return;
  }

  const profiles = loadProfiles();
  const sessionLog = loadSessionLog();

  const domainId = resolveDomain(event, profiles);
  appendSession(sessionLog, buildSessionEntry(event, domainId));
  saveSessionLog(sessionLog);

  const domains = (profiles["domains"] ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const domainProfile = domains[domainId];

  if (domainProfile) {
    applySessionUpdate(domainProfile, {
      duration: event.duration,
      tools_used: event.tools_used,
      turn_count: event.turn_count,
    });
    // I4: targeted write — does not rewrite other domains.
    saveProfile(domainId, domainProfile);
    log(`Updated profile for domain "${domainId}"`);
  } else {
    log(`No profile for domain "${domainId}", logged session only`);
  }

  // I5: consolidation fires after profile save (best-effort)
  await runConsolidation(event.turn_count ?? 0);
}

export async function main(): Promise<void> {
  if (process.stdin.isTTY) {
    log("No stdin data (TTY mode), exiting");
    process.exit(0);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) {
    log("Empty stdin, exiting");
    process.exit(0);
  }

  let event: SessionEndEvent;
  try {
    event = JSON.parse(raw) as SessionEndEvent;
  } catch (err) {
    log(`Failed to parse event: ${String(err)}`);
    process.exit(0);
  }

  try {
    await processEvent(event);
    process.exit(0);
  } catch (err) {
    log(`Session lifecycle update failed: ${String(err)}`);
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith("session-lifecycle.js") === true) {
  main().catch(() => process.exit(1));
}
