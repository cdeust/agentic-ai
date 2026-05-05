/**
 * LoCoMo dataset loader (locomo10.json) — port of cortex/benchmarks/locomo/data.py.
 *
 * The LoCoMo dataset (Maharana et al., ACL 2024) contains 10 multi-session
 * conversations and 1,986 QA pairs. The same JSON file is read by both the
 * Python and TS runners; this loader mirrors data.py:9-90 byte-for-byte.
 *
 * source: cortex@1ef1376 benchmarks/locomo/data.py:9-90
 * source: Maharana et al. (2024). "Evaluating Long-Term Conversational Memory
 *   of LLM Agents." ACL 2024.
 */

import { readFileSync, existsSync } from "node:fs";

// source: cortex@1ef1376 benchmarks/locomo/data.py:9-15
export const CATEGORY_NAMES: Record<number, string> = {
  1: "single_hop",
  2: "multi_hop",
  3: "temporal",
  4: "open_domain",
  5: "adversarial",
};

export interface LocomoTurn {
  readonly speaker: string;
  readonly text: string;
}

export interface LocomoSession {
  readonly session_idx: number;
  readonly date: string;
  /** Pre-formatted "[Date: …]\n[speaker]: text\n…" blob ingested as one memory. */
  readonly content: string;
  readonly turns: readonly LocomoTurn[];
  readonly user_content: string;
}

export interface LocomoQA {
  readonly question: string;
  readonly evidence?: readonly string[];
  readonly category?: number;
}

export interface LocomoConversation {
  readonly conversation: Record<string, unknown>;
  readonly qa: readonly LocomoQA[];
}

const EVIDENCE_REF_RE = /^D(\d+):(\d+)$/;

/**
 * Parse "D1:3"-style evidence refs into [session_idx, turn_idx] pairs.
 *
 * source: cortex@1ef1376 benchmarks/locomo/data.py:23-30
 */
export function parseEvidenceRefs(
  evidence: readonly string[] | undefined,
): Array<[number, number]> {
  if (!evidence) return [];
  const refs: Array<[number, number]> = [];
  for (const ref of evidence) {
    const m = EVIDENCE_REF_RE.exec(ref);
    if (m && m[1] !== undefined && m[2] !== undefined) {
      refs.push([parseInt(m[1], 10), parseInt(m[2], 10)]);
    }
  }
  return refs;
}

// Upper bound on session indices — matches Python's range(1, 100). source: data.py:35
const MAX_SESSION_INDEX = 100;

/**
 * Build per-session pre-formatted memory content from a conversation dict.
 *
 * Each session emits one memory whose body is the [Date: …] header plus
 * "[speaker]: text" lines, joined by newlines — identical to Python's output.
 *
 * source: cortex@1ef1376 benchmarks/locomo/data.py:33-66
 */
export function extractSessions(
  conversation: Record<string, unknown>,
): LocomoSession[] {
  const sessions: LocomoSession[] = [];
  const speakerA = String(conversation["speaker_a"] ?? "");
  for (let i = 1; i < MAX_SESSION_INDEX; i++) {
    const key = `session_${i}`;
    if (!(key in conversation)) break;
    const turnsRaw = conversation[key];
    if (!Array.isArray(turnsRaw) || turnsRaw.length === 0) continue;
    const turns = turnsRaw as LocomoTurn[];
    const date = String(conversation[`session_${i}_date_time`] ?? "");
    const parts: string[] = [];
    if (date) parts.push(`[Date: ${date}]`);
    for (const turn of turns) {
      const speaker = turn.speaker ?? "User";
      parts.push(`[${speaker}]: ${turn.text ?? ""}`);
    }
    const userContent = turns
      .filter((t) => (t.speaker ?? "") === speakerA)
      .map((t) => t.text ?? "")
      .join("\n");
    sessions.push({
      session_idx: i,
      date,
      content: parts.join("\n"),
      turns,
      user_content: userContent,
    });
  }
  return sessions;
}

/**
 * Locate locomo10.json on disk. Searches in order:
 *   1. CORTEX_LOCOMO_PATH env var (explicit override)
 *   2. ../cortex/benchmarks/locomo/locomo10.json (sibling repo)
 *   3. ../../cortex/benchmarks/locomo/locomo10.json (one level up)
 *
 * Returns null when not found; caller decides whether to skip or fail.
 *
 * source: monorepo convention — sibling-repo path discovery for benchmark
 *   datasets that are too large to vendor.
 */
export function findLocomoDataset(): string | null {
  const explicit = process.env["CORTEX_LOCOMO_PATH"];
  if (explicit && existsSync(explicit)) return explicit;
  const candidates = [
    "/Users/cdeust/Developments/cortex/benchmarks/locomo/locomo10.json",
    "../cortex/benchmarks/locomo/locomo10.json",
    "../../cortex/benchmarks/locomo/locomo10.json",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/**
 * Load and parse locomo10.json.
 *
 * precondition: path points to a readable JSON file matching the LoCoMo schema.
 * postcondition: returns one LocomoConversation per top-level array entry.
 */
export function loadLocomo(path: string): LocomoConversation[] {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as LocomoConversation[];
}
