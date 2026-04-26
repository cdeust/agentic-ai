/**
 * SubagentStart hook — automatic agent briefing.
 *
 * When the orchestrator spawns a subagent, retrieves relevant memories
 * for the spawned agent's task context and injects them as a briefing.
 *
 * Paper backing:
 *   - Smith & Vela (2001): context reinstatement d=0.28, ~15-20% boost.
 *     Injecting task-relevant memories at agent start implements reinstatement.
 *   - Wegner (1987) Transactive Memory Systems: directory knowledge —
 *     each agent knows what the team knows. Briefing injects team decisions.
 *   - Collins & Loftus (1975): spreading activation — task description
 *     activates related memory nodes.
 *
 * Happens-before contract (Lamport 1978, §2):
 *   I1: this hook fires BEFORE the subagent's first LLM turn.
 *   I2: specialist agent list loaded at process start; not refreshed
 *       mid-session (acceptable for a hook process lifetime).
 *   I3: agent-scoped query fires before team-decisions query (result
 *       of pass 1 informs remaining budget for pass 2).
 *   I4: no ordering assumption between concurrent SubagentStart hooks
 *       for different subagents spawned in the same parent session.
 *
 * OPEN QUESTION (ambiguous timing):
 *   Whether SubagentStart stdout is injected into the agent's context
 *   window is NOT fully documented in Claude Code. If exit 0 stdout is
 *   NOT injected, this hook still warms access timestamps, improving
 *   subsequent recall for that agent. Requires validation.
 *   → flagged as OQ-SUBAGENT-INJECT for genius cross-audit.
 *
 * Exit codes:
 *   exit 0 + stdout → briefing injected (if Claude Code supports it)
 *   exit 0 + empty  → no briefing (skip conditions met)
 *
 * Timeout: same as UserPromptSubmit (~3s per HOOKS.md Hook 4).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  fetchAgentMemories,
  fetchTeamDecisionsForAgent,
} from "./db.js";
import {
  loadHookConfig,
  HOOK_TIMEOUTS_MS,
  type SubagentStartEvent,
} from "./types.js";

const LOG_PREFIX = "[cortex-agent-briefing]";
const MAX_MEMORIES = 3;
const MIN_HEAT = 0.2;

// Fallback set when ~/.claude/agents/ is absent (e.g., CI without install).
const FALLBACK_AGENTS = new Set([
  "engineer",
  "tester",
  "reviewer",
  "architect",
  "dba",
  "devops",
  "frontend",
  "security",
  "researcher",
  "ux",
]);

// YAML frontmatter name extraction
const YAML_NAME_RE = /^name:\s*['"]?([A-Za-z0-9_.-]+)['"]?\s*$/m;

function log(msg: string): void {
  process.stderr.write(`${LOG_PREFIX} ${msg}\n`);
}

// ── Specialist agent discovery ────────────────────────────────────────────

function parseFrontmatterName(filePath: string): string | null {
  try {
    const head = readFileSync(filePath, "utf-8").slice(0, 4096);
    const m = YAML_NAME_RE.exec(head);
    return m?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

function loadSpecialistAgents(): Set<string> {
  const agentsDir = join(homedir(), ".claude", "agents");
  if (!existsSync(agentsDir)) return FALLBACK_AGENTS;

  const names = new Set<string>();
  try {
    // Scan *.md and genius/*.md
    for (const pattern of [agentsDir, join(agentsDir, "genius")]) {
      if (!existsSync(pattern)) continue;
      for (const entry of readdirSync(pattern)) {
        if (entry === "INDEX.md" || !entry.endsWith(".md")) continue;
        const name = parseFrontmatterName(join(pattern, entry));
        if (name) names.add(name);
      }
    }
  } catch {
    return FALLBACK_AGENTS;
  }
  return names.size > 0 ? names : FALLBACK_AGENTS;
}

// Loaded once at process start (I2 above)
const SPECIALIST_AGENTS = loadSpecialistAgents();

// ── Keyword extraction ────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "the", "and", "for", "that", "this", "with", "from", "your", "have",
  "will", "been", "they", "what", "when", "where", "which", "there",
  "their", "about", "would", "could", "should", "into", "more", "some",
  "than", "them", "then", "these", "those", "each", "make", "like",
  "just", "over", "such", "take", "also", "back", "after", "only",
  "come", "made", "find", "here", "thing", "many", "well", "work",
  "need", "using", "used", "code", "file", "please", "ensure",
]);

function extractTaskKeywords(prompt: string): string[] {
  const words = prompt.slice(0, 500).toLowerCase().split(/\s+/);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of words) {
    const w = raw.replace(/[.,;:!?"'()[\]{}]/g, "");
    if (w.length > 3 && !STOP_WORDS.has(w) && !seen.has(w)) {
      seen.add(w);
      unique.push(w);
    }
    if (unique.length >= 8) break;
  }
  return unique;
}

// ── Main handler ──────────────────────────────────────────────────────────

export async function processEvent(
  event: SubagentStartEvent,
): Promise<void> {
  const agentName = (event.agent_name ?? "").toLowerCase();
  const prompt = event.prompt ?? "";

  if (!SPECIALIST_AGENTS.has(agentName)) {
    log(`skip: agent '${agentName}' not a specialist`);
    return;
  }

  if (prompt.length < 20) {
    log("skip: prompt too short");
    return;
  }

  const keywords = extractTaskKeywords(prompt);
  if (!keywords.length) {
    log("skip: no keywords extracted");
    return;
  }

  const { databaseUrl } = loadHookConfig();

  // I3: pass 1 fires first; remaining budget computed from result length
  const agentMemories = await Promise.race([
    fetchAgentMemories(databaseUrl, agentName, keywords, MIN_HEAT, MAX_MEMORIES),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("agent query timeout")),
        HOOK_TIMEOUTS_MS.SUBAGENT_START - 500,
      ),
    ),
  ]);

  const remaining = MAX_MEMORIES - agentMemories.length;
  const teamDecisions =
    remaining > 0
      ? await fetchTeamDecisionsForAgent(databaseUrl, agentName, remaining)
      : [];

  const memories = [
    ...agentMemories.map((m) => ({
      content: m.content.slice(0, 300),
      source: "agent-prior",
    })),
    ...teamDecisions.map((m) => ({
      content: m.content.slice(0, 300),
      source: `team:${m.agent_context ?? ""}`,
    })),
  ];

  if (!memories.length) {
    log(`skip: no relevant memories for ${agentName}`);
    return;
  }

  const lines: string[] = [`## Cortex Briefing (${agentName})\n`];
  for (const m of memories) {
    const prefix = m.source ? `[${m.source}] ` : "";
    const firstLine = m.content.split("\n")[0]?.slice(0, 200) ?? "";
    lines.push(`- ${prefix}${firstLine}`);
  }
  lines.push("\n*Auto-injected by Cortex. Use `recall` for deeper context.*");

  process.stdout.write(lines.join("\n") + "\n");
  log(`briefed ${agentName} with ${memories.length} memories`);
}

export async function main(): Promise<void> {
  if (process.stdin.isTTY) {
    process.exit(0);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) process.exit(0);

  let event: SubagentStartEvent;
  try {
    event = JSON.parse(raw) as SubagentStartEvent;
  } catch {
    process.exit(0);
  }

  await processEvent(event).catch(() => {});
  process.exit(0);
}

if (process.argv[1]?.endsWith("agent-briefing.js") === true) {
  main().catch(() => process.exit(0));
}
