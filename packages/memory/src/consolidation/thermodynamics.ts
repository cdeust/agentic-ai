/**
 * Memory thermodynamics — heat, surprise, decay, importance, valence.
 *
 * Pure business logic — no I/O.
 *
 * Key concepts:
 *   - Heat: freshness signal (1.0=hot, 0.0=cold). Decays over time, reheated on access.
 *   - Surprise: novelty signal (1.0=maximally novel). Drives write gate decisions.
 *   - Importance: Edmundson (1969) four-feature scoring (cue + key + title + loc).
 *   - Valence: VADER compound sentiment (Hutto & Gilbert 2014).
 *   - Metamemory: tracks access frequency and usefulness for confidence calibration.
 *
 * Citations:
 *   // source: Ebbinghaus H (1885) "Über das Gedächtnis." R(t) = e^{-t/S}.
 *     Importance and valence modulate S, following the finding that emotional
 *     and meaningful memories decay slower (McGaugh 2004).
 *   // source: Edmundson HP (1969) "New Methods in Automatic Extracting."
 *     JACM 16(2):264-285. Four-feature scoring with validated weights w_cue=2,
 *     w_key=1, w_title=1, w_loc=1.
 *   // source: Hutto CJ & Gilbert E (2014) "VADER: A Parsimonious Rule-based Model
 *     for Sentiment Analysis of Social Media Text." ICWSM.
 *     compound = x / sqrt(x^2 + alpha), alpha=15.
 *   // source: Emotional resistance: time-dependent (Yonelinas & Ritchey 2015).
 *     Emotional advantage grows with delay (Kleinsmith & Kaplan 1963 crossover).
 *
 * Port of: mcp_server/core/thermodynamics.py
 */

// ── Edmundson cue word sets ────────────────────────────────────────────────
// Bonus words: domain-specific high-importance indicators (positive cue)
// Stigma words: low-importance indicators (negative cue)

const BONUS_WORDS = new Set([
  "error", "exception", "traceback", "failed", "failure", "bug", "crash",
  "broken", "timeout", "denied", "rejected", "deprecated", "decided",
  "chose", "switched", "migrated", "selected", "picked", "opted",
  "design", "pattern", "refactor", "architecture", "restructure",
  "modular", "decouple", "abstract", "breaking", "migration", "critical",
  "security", "vulnerability", "performance", "bottleneck", "regression",
  "root cause",
]);

const STIGMA_WORDS = new Set([
  "maybe", "minor", "trivial", "fyi", "note", "aside", "btw",
  "probably", "might", "perhaps", "just", "small",
]);

const CODE_BLOCK_RE = /```|`[^`]+`/;
const FILE_PATH_RE = /(?:\.{0,2}\/)?(?:[\w@.-]+\/)+[\w@.-]+\.\w+/;
const WORD_RE = /[a-z]+(?:'[a-z]+)?/gi;
const ERROR_KW_RE = /\b(error|exception|traceback|failed|failure|bug|crash|broken|timeout|denied|rejected|deprecated)\b/i;
const DECISION_KW_RE = /\b(decided|chose|switched|migrated|selected|picked|opted)\b/i;

// ── Surprise ─────────────────────────────────────────────────────────────────

/**
 * Compute how novel content is relative to existing memories.
 *
 * surprise = 1.0 - max_similarity. Returns 0.5 if no existing memories.
 */
export function computeSurprise(
  _content: string,
  existingSimilarities: readonly number[],
): number {
  if (existingSimilarities.length === 0) return 0.5;
  const maxSim = Math.max(...existingSimilarities);
  return Math.max(0.0, Math.min(1.0, 1.0 - maxSim));
}

/** Apply surprise boost to initial heat. Capped at 1.0. */
export function applySurpriseBoost(
  baseHeat: number,
  surprise: number,
  boostFactor = 0.3,
): number {
  return Math.min(baseHeat + surprise * boostFactor, 1.0);
}

// ── Edmundson Importance ─────────────────────────────────────────────────────

function edmundsonCue(words: string[]): number {
  if (words.length === 0) return 0.0;
  let bonus = 0;
  let stigma = 0;
  for (const w of words) {
    if (BONUS_WORDS.has(w)) bonus++;
    if (STIGMA_WORDS.has(w)) stigma++;
  }
  const raw = (bonus - stigma) / words.length;
  return Math.max(0.0, Math.min(1.0, raw));
}

function edmundsonKey(words: string[]): number {
  if (words.length === 0) return 0.0;
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  if (freq.size < 2) return 0.0;
  const sortedCounts = Array.from(freq.values()).sort((a, b) => b - a);
  const totalMass = sortedCounts.reduce((s, c) => s + c, 0);
  const topK = Math.max(1, Math.floor(sortedCounts.length / 4));
  const topMass = sortedCounts.slice(0, topK).reduce((s, c) => s + c, 0);
  return topMass / totalMass;
}

/**
 * Edmundson (1969) four-feature importance scoring.
 *
 * // source: Edmundson HP (1969) "New Methods in Automatic Extracting."
 *   JACM 16(2):264-285.
 *   importance = w_cue * cue(m) + w_key * key(m) + w_title * title(m) + w_loc * loc(m)
 *   Validated weights: w_cue=2, w_key=1, w_title=1, w_loc=1.
 *
 * Final score normalized to [0, 1].
 */
export function computeImportance(
  content: string,
  tags: readonly string[] | null = null,
): number {
  const words: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(WORD_RE.source, "gi");
  while ((m = re.exec(content)) !== null) {
    words.push(m[0].toLowerCase());
  }

  let cue = edmundsonCue(words);
  // Boost cue for code blocks and file paths (technical cue signals)
  if (CODE_BLOCK_RE.test(content) || FILE_PATH_RE.test(content)) {
    cue = Math.min(1.0, cue + 0.15);
  }

  const key = edmundsonKey(words);

  let title = 0.0;
  if (tags && tags.length > 0) {
    const tagWords = new Set(tags.map((t) => t.toLowerCase()));
    const overlap = [...tagWords].filter((t) => BONUS_WORDS.has(t)).length;
    title = overlap / tags.length;
  }

  const loc = 0.0; // Not applicable for single-unit memories

  // Edmundson validated weights
  const wCue = 2, wKey = 1, wTitle = 1, wLoc = 1;
  const raw = wCue * cue + wKey * key + wTitle * title + wLoc * loc;
  const maxRaw = wCue + wKey + wTitle + wLoc; // 5
  return Math.min(1.0, Math.round((raw / maxRaw) * 10000) / 10000);
}

// ── Decay (Ebbinghaus + modulation) ──────────────────────────────────────────

/**
 * Exponential forgetting: heat(t) = heat(0) * λ^t  (Ebbinghaus 1885).
 *
 * λ (effective decay factor per hour) is modulated by:
 *   - Importance > 0.7: λ increases to importanceDecayFactor (slower decay).
 *     // source: Craik & Lockhart (1972) levels-of-processing.
 *   - |valence|: pushes λ toward 1.0 (emotional memories resist decay).
 *     // source: McGaugh (2004) amygdala modulation of consolidation.
 *     // source: Emotional resistance: time-dependent (Yonelinas & Ritchey 2015).
 *     // source: Emotional advantage grows with delay (Kleinsmith & Kaplan 1963 crossover).
 *   - confidence: minor λ increase. Engineering decision — no paper.
 *
 * Constants: decayFactor=0.95 and importanceDecayFactor=0.998 are tuned
 * to produce reasonable half-lives (~14h normal, ~346h important) for a
 * memory system operating at hours/days timescale. Not from any paper.
 *
 * Precision note: JS uses IEEE 754 double (same as Python float). The
 * time_saturation formula 1 - exp(-hours) is identical. No epsilon needed.
 */
export function computeDecay(
  currentHeat: number,
  hoursElapsed: number,
  importance = 0.5,
  valence = 0.0,
  confidence = 1.0,
  opts: {
    decayFactor?: number;
    importanceDecayFactor?: number;
    emotionalDecayResistance?: number;
  } = {},
): number {
  if (hoursElapsed <= 0) return currentHeat;

  const {
    decayFactor = 0.95,
    importanceDecayFactor = 0.998,
    emotionalDecayResistance = 0.5,
  } = opts;

  const base = importance > 0.7 ? importanceDecayFactor : decayFactor;

  // Emotional resistance: time-dependent (Yonelinas & Ritchey 2015).
  // Emotional advantage grows with delay (Kleinsmith & Kaplan 1963 crossover).
  // At t=0: no resistance. At t>>1h: full resistance (up to 30% at |v|=1).
  const timeSaturation = 1.0 - Math.exp(-hoursElapsed);
  const emotionalMod =
    1.0 + Math.abs(valence) * emotionalDecayResistance * timeSaturation;
  let effective = 1.0 - (1.0 - base) / emotionalMod;

  // Confidence modifier
  const confidenceMod = 1.0 + confidence * 0.1;
  effective = 1.0 - (1.0 - effective) / confidenceMod;

  effective = Math.max(0.0, Math.min(effective, 1.0));
  return currentHeat * Math.pow(effective, hoursElapsed);
}

// ── Session Coherence ─────────────────────────────────────────────────────────

/**
 * Boost heat for memories created within the current session window.
 *
 * Prevents "I just told you this" by keeping active context elevated.
 * Engineering decision — no paper source.
 */
export function computeSessionCoherence(
  heat: number,
  createdAtIso: string,
  bonus = 0.2,
  windowHours = 4.0,
): number {
  try {
    const memDt = new Date(createdAtIso);
    if (isNaN(memDt.getTime())) return heat;
    const hours = (Date.now() - memDt.getTime()) / 3_600_000;
    if (hours < windowHours) {
      const freshness = 1.0 - hours / windowHours;
      return Math.min(heat + bonus * freshness, 1.0);
    }
  } catch {
    // ignore
  }
  return heat;
}

// ── Metamemory ────────────────────────────────────────────────────────────────

/**
 * Update confidence after enough data points.
 * Returns null if not enough data (fewer than 4 accesses).
 *
 * Loosely inspired by Nelson & Narens (1990) metamemory framework but
 * implemented as a simple ratio, not their full monitoring-control model.
 */
export function computeMetamemoryConfidence(
  accessCount: number,
  usefulCount: number,
): number | null {
  if (accessCount <= 3) return null;
  return usefulCount / accessCount;
}

// ── Content Classification ────────────────────────────────────────────────────

/** Check if content contains error/exception keywords. */
export function isErrorContent(content: string): boolean {
  return ERROR_KW_RE.test(content);
}

/** Check if content contains decision keywords. */
export function isDecisionContent(content: string): boolean {
  return DECISION_KW_RE.test(content);
}
