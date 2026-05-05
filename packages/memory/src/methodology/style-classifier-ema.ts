/**
 * EMA (Exponential Moving Average) update for Felder-Silverman cognitive style.
 *
 * Blends an existing style profile with a new observation using weighted
 * averaging for continuous dimensions and majority-rule for categorical ones.
 *
 * Pure business logic — no I/O.
 *
 * Port of: cortex@ed33435 mcp_server/core/style_classifier_ema.py
 */

// ── Style interfaces ──────────────────────────────────────────────────────

export interface CognitiveStyle {
  activeReflective: number;
  sensingIntuitive: number;
  sequentialGlobal: number;
  problemDecomposition?: string;
  explorationStyle?: string;
  verificationBehavior?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Clamp value to [-1.0, 1.0].
 * source: cortex@ed33435 mcp_server/core/style_classifier_ema.py:14-16
 */
function clamp(v: number): number {
  return Math.max(-1.0, Math.min(1.0, v));
}

/**
 * Blend continuous dimensions via EMA.
 *
 * Formula: new = alpha * observation + (1 - alpha) * old
 *
 * precondition:  alpha ∈ [0, 1].
 * postcondition: all returned values ∈ [-1, 1].
 *
 * source: cortex@ed33435 mcp_server/core/style_classifier_ema.py:19-37
 */
function blendContinuous(
  oldStyle: Record<string, unknown>,
  newObservation: Record<string, unknown>,
  alpha: number,
): [number, number, number] {
  const ar = clamp(
    alpha * ((newObservation["activeReflective"] as number | undefined) ?? 0)
    + (1 - alpha) * ((oldStyle["activeReflective"] as number | undefined) ?? 0),
  );
  const si = clamp(
    alpha * ((newObservation["sensingIntuitive"] as number | undefined) ?? 0)
    + (1 - alpha) * ((oldStyle["sensingIntuitive"] as number | undefined) ?? 0),
  );
  const sg = clamp(
    alpha * ((newObservation["sequentialGlobal"] as number | undefined) ?? 0)
    + (1 - alpha) * ((oldStyle["sequentialGlobal"] as number | undefined) ?? 0),
  );
  return [ar, si, sg];
}

/**
 * Select categorical dimensions based on alpha threshold.
 *
 * When alpha >= 0.5 adopt the new observation's categories; else keep old.
 *
 * source: cortex@ed33435 mcp_server/core/style_classifier_ema.py:40-53
 */
function selectCategorical(
  oldStyle: Record<string, unknown>,
  newObservation: Record<string, unknown>,
  alpha: number,
): [string | undefined, string | undefined, string | undefined] {
  const adoptNew = alpha >= 0.5;
  const primary = adoptNew ? newObservation : oldStyle;
  const fallback = adoptNew ? oldStyle : newObservation;

  const pd = (primary["problemDecomposition"] ?? fallback["problemDecomposition"]) as string | undefined;
  const es = (primary["explorationStyle"] ?? fallback["explorationStyle"]) as string | undefined;
  const vb = (primary["verificationBehavior"] ?? fallback["verificationBehavior"]) as string | undefined;
  return [pd, es, vb];
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Blend an existing cognitive style with a new observation using EMA.
 *
 * precondition:  alpha ∈ [0, 1] (default = 0.1 for slow adaptation).
 * postcondition: returned CognitiveStyle has all continuous dimensions
 *   blended; categorical dimensions selected by alpha threshold.
 *   Returns newObservation when oldStyle is null/undefined;
 *   returns oldStyle when newObservation is null/undefined.
 *
 * source: cortex@ed33435 mcp_server/core/style_classifier_ema.py:56-77
 *   alpha default = 0.1 (engineering choice — slow adaptation)
 */
export function updateStyleEma(
  oldStyle: Record<string, unknown> | null | undefined,
  newObservation: Record<string, unknown> | null | undefined,
  alpha = 0.1, // source: cortex@ed33435 mcp_server/core/style_classifier_ema.py:59 — default 0.1
): Record<string, unknown> {
  if (!oldStyle) return newObservation ?? {};
  if (!newObservation) return oldStyle;

  const [ar, si, sg] = blendContinuous(oldStyle, newObservation, alpha);
  const [pd, es, vb] = selectCategorical(oldStyle, newObservation, alpha);

  return {
    activeReflective: ar,
    sensingIntuitive: si,
    sequentialGlobal: sg,
    problemDecomposition: pd,
    explorationStyle: es,
    verificationBehavior: vb,
  };
}
