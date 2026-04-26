/**
 * Minimal VADER sentiment analysis for engineering text.
 *
 * Implements the core algorithm from:
 *   Hutto CJ & Gilbert E (2014) "VADER: A Parsimonious Rule-based Model for
 *   Sentiment Analysis of Social Media Text." ICWSM.
 *
 * Key components implemented:
 *   - Engineering-domain lexicon (~50 terms with valence ratings [-4, +4])
 *   - H4: Negation handling (N_SCALAR = -0.74)
 *   - H3: Degree modifiers (booster words)
 *   - VADER normalization: compound = x / sqrt(x^2 + alpha), alpha=15
 *
 * Pure utility — no I/O, no external dependencies.
 *
 * Port of: mcp_server/shared/vader.py
 */

// ── VADER constants (from Hutto & Gilbert 2014) ────────────────────────────

/** Normalization constant. source: Hutto & Gilbert (2014) ICWSM. */
const ALPHA = 15;

/** Negation scalar (H4). source: Hutto & Gilbert (2014) ICWSM Table 2. */
const N_SCALAR = -0.74;

// ── Engineering-domain lexicon: term -> valence [-4, +4] ───────────────────
// Modeled after VADER's crowd-sourced lexicon but tuned for software
// engineering text. Valence magnitudes follow VADER's scale convention.

const LEXICON: Readonly<Record<string, number>> = {
  // Negative [-4, -1]
  error: -2.0,
  exception: -2.0,
  traceback: -2.5,
  failed: -2.5,
  failure: -2.5,
  bug: -2.0,
  crash: -3.0,
  broken: -2.5,
  timeout: -1.5,
  denied: -1.5,
  rejected: -1.5,
  deprecated: -1.0,
  frustrating: -2.5,
  annoying: -2.0,
  painful: -2.0,
  struggle: -1.5,
  nightmare: -3.0,
  horrible: -3.0,
  terrible: -3.0,
  awful: -3.0,
  hate: -3.0,
  wtf: -3.0,
  damn: -2.0,
  ugh: -1.5,
  argh: -1.5,
  confusing: -1.5,
  unclear: -1.0,
  weird: -1.0,
  bizarre: -1.5,
  urgent: -1.5,
  critical: -1.5,
  blocking: -2.0,
  outage: -3.0,
  hotfix: -1.5,
  // Positive [+1, +4]
  fixed: 2.0,
  resolved: 2.0,
  working: 1.5,
  success: 2.5,
  passed: 1.5,
  deployed: 2.0,
  completed: 2.0,
  shipped: 2.5,
  merged: 1.5,
  approved: 1.5,
  elegant: 2.5,
  beautiful: 2.5,
  clean: 1.5,
  perfect: 3.0,
  excellent: 3.0,
  awesome: 3.0,
  great: 2.5,
  finally: 1.0,
  breakthrough: 3.0,
  improvement: 1.5,
  better: 1.5,
  love: 2.5,
  happy: 2.0,
  proud: 2.0,
  satisfying: 2.0,
  insight: 2.0,
  discovered: 2.0,
  realized: 1.5,
  eureka: 3.0,
  interesting: 1.5,
} as const;

// ── Degree modifiers (H3): word -> scalar multiplier ───────────────────────
// Values from VADER paper Table 3. source: Hutto & Gilbert (2014) ICWSM Table 3.

const BOOSTERS: Readonly<Record<string, number>> = {
  very: 0.293,
  extremely: 0.293,
  really: 0.293,
  absolutely: 0.293,
  incredibly: 0.293,
  totally: 0.293,
  completely: 0.293,
  so: 0.293,
  slightly: -0.293,
  somewhat: -0.293,
  barely: -0.293,
  hardly: -0.293,
  "kind of": -0.293,
  "sort of": -0.293,
} as const;

// ── Negation words (H4) ────────────────────────────────────────────────────

const NEGATIONS: ReadonlySet<string> = new Set([
  "not", "no", "never", "neither", "nobody", "nothing", "nowhere", "nor",
  "cannot", "can't", "couldn't", "shouldn't", "wouldn't", "won't",
  "don't", "doesn't", "didn't", "isn't", "aren't", "wasn't", "weren't",
  "without",
]);

const WORD_RE = /[a-z]+(?:'t)?/gi;

function tokenize(text: string): string[] {
  return Array.from(text.matchAll(WORD_RE), (m) => m[0].toLowerCase());
}

/**
 * Compute VADER compound sentiment score for text.
 *
 * Returns a value in [-1.0, +1.0].
 * Uses the VADER normalization: compound = x / sqrt(x^2 + alpha).
 *
 * Implements:
 *   - Lexicon lookup
 *   - H3: Degree modifiers (booster words within 3-token window)
 *   - H4: Negation handling (N_SCALAR = -0.74 within 3-token window)
 *
 * source: Hutto & Gilbert (2014) "VADER: A Parsimonious Rule-based Model for
 *         Sentiment Analysis of Social Media Text." ICWSM.
 */
export function vaderCompound(text: string): number {
  const tokens = tokenize(text);
  if (tokens.length === 0) return 0.0;

  const sentiments: number[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    let valence = LEXICON[token] ?? 0.0;
    if (valence === 0.0) continue;

    // H3: Check preceding tokens for degree modifiers (3-word window)
    for (let j = Math.max(0, i - 3); j < i; j++) {
      const prev = tokens[j] ?? "";
      const boost = BOOSTERS[prev];
      if (boost !== undefined) {
        const dist = i - j;
        valence += valence * boost / dist;
      }
    }

    // H4: Check preceding tokens for negation (3-word window)
    for (let j = Math.max(0, i - 3); j < i; j++) {
      if (NEGATIONS.has(tokens[j] ?? "")) {
        valence *= N_SCALAR;
        break; // only apply negation once
      }
    }

    sentiments.push(valence);
  }

  if (sentiments.length === 0) return 0.0;

  // VADER normalization: compound = x / sqrt(x^2 + alpha)
  // source: Hutto & Gilbert (2014) ICWSM §3.3
  const total = sentiments.reduce((a, b) => a + b, 0.0);
  const compound = total / Math.sqrt(total * total + ALPHA);
  return Math.max(-1.0, Math.min(1.0, Math.round(compound * 10000) / 10000));
}

export interface VaderScores {
  readonly pos: number;
  readonly neg: number;
  readonly neu: number;
  readonly compound: number;
}

/**
 * Compute VADER pos/neg/neu/compound scores.
 *
 * Returns object with keys: pos, neg, neu, compound.
 * pos + neg + neu = 1.0 (proportions of tokens).
 */
export function vaderScores(text: string): VaderScores {
  const tokens = tokenize(text);
  const compound = vaderCompound(text);

  if (tokens.length === 0) {
    return { pos: 0.0, neg: 0.0, neu: 1.0, compound: 0.0 };
  }

  let posCount = 0;
  let negCount = 0;
  let neuCount = 0;

  for (const token of tokens) {
    const v = LEXICON[token] ?? 0.0;
    if (v > 0) posCount++;
    else if (v < 0) negCount++;
    else neuCount++;
  }

  const total = tokens.length;
  return {
    pos: Math.round((posCount / total) * 10000) / 10000,
    neg: Math.round((negCount / total) * 10000) / 10000,
    neu: Math.round((neuCount / total) * 10000) / 10000,
    compound,
  };
}
