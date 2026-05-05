/**
 * Emotional tagging — priority encoding for emotionally salient memories.
 *
 * Detects emotional markers in content using VADER compound sentiment
 * (Hutto & Gilbert 2014) combined with domain-specific keyword co-occurrence.
 * Emotionally tagged memories get higher importance and resist decay,
 * consistent with the general finding that emotional memories consolidate
 * better (McGaugh 2004, "The amygdala modulates the consolidation of
 * memories of emotionally arousing experiences", Annual Review of
 * Neuroscience).
 *
 * Yerkes-Dodson inverted-U: implemented as a * arousal * exp(-b * arousal),
 * following the standard parametric form. Peak at arousal ≈ 1/b.
 *
 * Emotion detection uses VADER compound score (Hutto & Gilbert 2014) to
 * derive five emotion categories from compound polarity + domain keyword
 * co-occurrence. Constants (thresholds, scaling factors) are hand-tuned.
 *
 * Port of: mcp_server/core/emotional_tagging.py
 * Pure business logic — no I/O.
 */

import { vaderCompound } from "../shared/vader.js";

// Ablation support — mirrors mcp_server/core/ablation.py Mechanism enum.
// Reads CORTEX_DISABLE_MECHANISMS env var (comma-separated mechanism names).
export const Mechanism = {
  EMOTIONAL_TAGGING: "EMOTIONAL_TAGGING",
  EMOTIONAL_DECAY: "EMOTIONAL_DECAY",
} as const;

function isMechanismDisabled(mechanism: string): boolean {
  // Source: mcp_server/core/ablation.py is_mechanism_disabled
  // Only available in Node.js environments; falls back to enabled (false) elsewhere.
  try {
    const env: string = (typeof process !== "undefined" ? process.env["CORTEX_DISABLE_MECHANISMS"] : undefined) ?? "";
    return env.split(",").map((s: string) => s.trim().toUpperCase()).includes(mechanism.toUpperCase());
  } catch {
    return false;
  }
}

// ── Domain keyword sets for emotion classification ────────────────────────────
// These co-occur with VADER polarity to disambiguate emotion categories.

const ERROR_DOMAIN_RE =
  /\b(error|exception|traceback|failed|failure|bug|crash|broken|timeout|denied|rejected|deprecated|hours? debugging|still broken|keeps? failing|won'?t work)\b/gi;

const SUCCESS_DOMAIN_RE =
  /\b(fixed|resolved|working|success|passed|deployed|completed|shipped|merged|approved|nailed|breakthrough|elegant|beautiful|clean|perfect|excellent|awesome|improvement)\b/gi;

const QUESTION_MARKERS_RE =
  /\?|\b(confus|unclear|don'?t understand|makes no sense|weird|bizarre|unexpected|strange|mysterious|puzzling|why does|how come|what the)\b/gi;

const URGENCY_DOMAIN_RE =
  /\b(urgent|critical|blocking|deadline|asap|immediately|production|outage|down|hotfix|p0|sev[- ]?1)\b/gi;

const INSIGHT_DOMAIN_RE =
  /\b(realized|discovered|found out|turns out|TIL|interesting|insight|key finding|important lesson|aha|eureka|lightbulb)\b/gi;

function countMatches(re: RegExp, content: string): number {
  re.lastIndex = 0;
  const matches = content.match(re);
  return matches ? Math.min(matches.length, 3) : 0;
}

export interface EmotionScores {
  frustration: number;
  satisfaction: number;
  confusion: number;
  urgency: number;
  discovery: number;
}

/**
 * VADER-derived emotion detection (Hutto & Gilbert 2014).
 *
 * Uses VADER compound score as the base polarity signal, then derives
 * five emotion categories from compound + domain keyword co-occurrence.
 *
 * Returns emotion intensities in [0, 1]. Multiple can co-occur.
 *
 * Precondition: content is a string.
 * Postcondition: all returned values in [0, 1].
 * // source: Hutto CJ & Gilbert E (2014) "VADER: A Parsimonious Rule-based Model
 * //   for Sentiment Analysis of Social Media Text." ICWSM.
 */
export function detectEmotions(content: string): EmotionScores {
  const compound = vaderCompound(content);
  const absCompound = Math.abs(compound);

  const errorHits = countMatches(ERROR_DOMAIN_RE, content);
  const successHits = countMatches(SUCCESS_DOMAIN_RE, content);
  const questionHits = countMatches(QUESTION_MARKERS_RE, content);
  const urgencyHits = countMatches(URGENCY_DOMAIN_RE, content);
  const insightHits = countMatches(INSIGHT_DOMAIN_RE, content);

  // frustration: negative compound weighted by error-domain keywords
  let frustration = 0.0;
  if (compound < 0 && errorHits > 0) {
    frustration = absCompound * (errorHits / 3.0);
  } else if (errorHits >= 1) {
    frustration = 0.2 * (errorHits / 3.0);
  }

  // satisfaction: positive compound weighted by success-domain keywords
  let satisfaction = 0.0;
  if (compound > 0 && successHits > 0) {
    satisfaction = absCompound * (successHits / 3.0);
  } else if (successHits >= 1) {
    satisfaction = 0.2 * (successHits / 3.0);
  }

  // confusion: low absolute compound + question markers
  let confusion = 0.0;
  if (questionHits > 0) {
    const certaintyFactor = Math.max(0.0, 1.0 - absCompound * 2);
    confusion = certaintyFactor * (questionHits / 3.0);
  }

  // urgency: negative compound weighted by urgency keywords
  let urgency = 0.0;
  if (urgencyHits > 0) {
    const negWeight = compound <= 0 ? Math.max(0.3, absCompound) : 0.3;
    urgency = negWeight * (urgencyHits / 3.0);
  }

  // discovery: positive compound weighted by insight keywords
  let discovery = 0.0;
  if (insightHits > 0) {
    const posWeight = compound >= 0 ? Math.max(0.3, absCompound) : 0.3;
    discovery = posWeight * (insightHits / 3.0);
  }

  return {
    frustration: Math.round(Math.min(1.0, frustration) * 10000) / 10000,
    satisfaction: Math.round(Math.min(1.0, satisfaction) * 10000) / 10000,
    confusion: Math.round(Math.min(1.0, confusion) * 10000) / 10000,
    urgency: Math.round(Math.min(1.0, urgency) * 10000) / 10000,
    discovery: Math.round(Math.min(1.0, discovery) * 10000) / 10000,
  };
}

/**
 * RMS of emotion intensities. Engineering heuristic — no paper.
 *
 * Arousal = combined emotional intensity regardless of valence.
 * Used for Yerkes-Dodson modulation.
 *
 * Precondition: emotions contains finite values.
 * Postcondition: result in [0, 1].
 */
export function computeArousal(emotions: EmotionScores): number {
  const values = Object.values(emotions).filter((v) => v > 0);
  if (values.length === 0) return 0.0;
  const rms = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length);
  return Math.round(Math.min(1.0, rms) * 10000) / 10000;
}

/**
 * Compute emotional valence from detected emotions.
 *
 * Positive: satisfaction, discovery
 * Negative: frustration, urgency
 * Neutral: confusion
 *
 * Precondition: emotions contains finite values.
 * Postcondition: result in [-1, 1].
 */
export function computeEmotionalValence(emotions: EmotionScores): number {
  const positive = emotions.satisfaction + emotions.discovery;
  const negative = emotions.frustration + emotions.urgency;
  const total = positive + negative + emotions.confusion;

  if (total === 0) return 0.0;
  return Math.round(Math.max(-1.0, Math.min(1.0, (positive - negative) / Math.max(total, 1.0))) * 10000) / 10000;
}

/**
 * Compute importance multiplier from emotional tagging.
 *
 * Yerkes-Dodson inverted-U: f(a) = c * a * exp(-b * a) + 1.0
 * where a = arousal, b controls peak location, c scales amplitude.
 * With b=1/0.7 (peak at a=0.7), c=0.57*b*e (peak value ≈ 1.57).
 * This is the standard parametric form of the Yerkes-Dodson law
 * (Yerkes & Dodson, 1908).
 *
 * Specific emotion bonuses are engineering heuristics (no paper):
 *   - Urgency: +0.3 (critical events must be remembered)
 *   - Discovery: +0.2 (insights are valuable)
 *   - Frustration: +0.1 (errors teach lessons)
 *
 * Precondition: arousal in [0, 1].
 * Postcondition: result in [1.0, 2.0].
 *
 * // source: Yerkes RM & Dodson JD (1908) "The relation of strength of stimulus to
 * //   rapidity of habit-formation." J. Comp. Neurol. Psychol. 18:459-482
 */
export function computeImportanceBoost(
  emotions: EmotionScores,
  arousal: number,
): number {
  if (isMechanismDisabled(Mechanism.EMOTIONAL_TAGGING)) {
    return 1.0;
  }

  // Smooth Yerkes-Dodson: f(a) = c * a * exp(-b * a) + 1.0
  // b = 1/0.7 => peak at arousal = 0.7
  // c = 0.57 * b * e so that peak adds 0.57 to base 1.0
  // // source: Yerkes RM & Dodson JD (1908) parametric form
  const YD_B = 1.0 / 0.7;
  const YD_C = 0.57 * YD_B * Math.E;
  const ydCurve = 1.0 + YD_C * arousal * Math.exp(-YD_B * arousal);

  // Specific emotion bonuses (engineering heuristics — no paper)
  let bonus = 0.0;
  bonus += emotions.urgency * 0.3;
  bonus += emotions.discovery * 0.2;
  bonus += emotions.frustration * 0.1;

  return Math.round(Math.min(2.0, Math.max(1.0, ydCurve + bonus)) * 10000) / 10000;
}

/**
 * Compute decay resistance multiplier from emotional tagging.
 *
 * Emotionally tagged memories resist compression and decay.
 * Higher value = slower decay.
 *
 * Precondition: arousal in [0, 1].
 * Postcondition: result in [1.0, 2.0].
 */
export function computeDecayResistance(
  emotions: EmotionScores,
  arousal: number,
): number {
  if (isMechanismDisabled(Mechanism.EMOTIONAL_DECAY)) {
    return 1.0;
  }
  if (arousal < 0.1) return 1.0;

  let resistance = 1.0 + arousal * 0.6;
  // Discovery and urgency are especially persistent (engineering heuristic)
  resistance += emotions.discovery * 0.2;
  resistance += emotions.urgency * 0.2;

  return Math.round(Math.min(2.0, resistance) * 10000) / 10000;
}

export interface EmotionTagResult {
  emotions: EmotionScores;
  arousal: number;
  valence: number;
  importance_boost: number;
  decay_resistance: number;
  is_emotional: boolean;
  dominant_emotion: string;
}

/**
 * Full emotional tagging pipeline for a memory.
 *
 * Returns all emotional metadata needed for storage.
 *
 * Precondition: content is a string.
 * Postcondition: all numeric fields are finite; dominant_emotion is one of the
 *   five emotion keys or "neutral".
 */
export function tagMemoryEmotions(content: string): EmotionTagResult {
  const emotions = detectEmotions(content);
  const arousal = computeArousal(emotions);
  const valence = computeEmotionalValence(emotions);
  const importanceBoost = computeImportanceBoost(emotions, arousal);
  const decayResistance = computeDecayResistance(emotions, arousal);

  const isEmotional = arousal > 0.2;
  const dominant = isEmotional
    ? (Object.entries(emotions).reduce((a, b) => (b[1] > a[1] ? b : a))[0])
    : "neutral";

  return {
    emotions,
    arousal,
    valence,
    importance_boost: importanceBoost,
    decay_resistance: decayResistance,
    is_emotional: isEmotional,
    dominant_emotion: dominant,
  };
}
