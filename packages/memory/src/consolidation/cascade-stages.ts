/**
 * Consolidation cascade — stage definitions, properties, decay, and serialization.
 *
 * Models the biochemical cascade that transforms a labile memory trace into a
 * stable, cortically integrated engram. Memories progress through stages with
 * different properties at each stage:
 *
 *   LABILE (0-1h)         — Just encoded. Highly vulnerable to interference.
 *   EARLY_LTP (1-6h)      — Synaptic tag set (Frey & Morris 1997).
 *   LATE_LTP (6-24h)      — Protein synthesis complete. CREB-dependent.
 *   CONSOLIDATED (>24h)   — Systems consolidation underway.
 *   RECONSOLIDATING       — Retrieval-triggered lability (Nader et al. 2000).
 *
 * References:
 *   Kandel ER (2001) The molecular biology of memory storage.
 *   Dudai Y (2012) The restless engram: consolidations never end.
 *   Frey U, Morris RGM (1997) Synaptic tagging and LTP. Nature 385:533-536
 *   Nader K et al. (2000) Fear memories require protein synthesis in the
 *       amygdala for reconsolidation after retrieval. Nature 406:722-726
 *   // source: Bahrick HP (1984) "Semantic memory content in permastore" — heat_floor=0.10
 *   // source: Benna MK & Fusi S (2016) "Computational principles of synaptic memory
 *             consolidation" — deepest cascade levels provide non-zero retention floors.
 *
 * Port of: mcp_server/core/cascade_stages.py
 * Pure business logic — no I/O.
 */

export type ConsolidationStageName =
  | "labile"
  | "early_ltp"
  | "late_ltp"
  | "consolidated"
  | "reconsolidating";

/** Immutable properties for each consolidation stage. */
export interface StageProperties {
  /** Multiplied into decay rate. >1 = faster decay, <1 = slower. */
  readonly decayMultiplier: number;
  /** How susceptible to interference [0, 1]. */
  readonly interferenceVulnerability: number;
  /** How modifiable the memory is [0, 1]. */
  readonly plasticity: number;
  /** Minimum time in this stage before advancement (hours). */
  readonly minDwellHours: number;
  /** Maximum time before forced transition (hours). Infinity for CONSOLIDATED. */
  readonly maxDwellHours: number;
  /**
   * Minimum heat for this stage. Consolidated memories never decay below this floor.
   * // source: Bahrick (1984) permastore; Benna & Fusi (2016) cascade retention floors.
   */
  readonly heatFloor: number;
}

// ── Stage Properties ────────────────────────────────────────────────────────

const STAGE_PROPERTIES: Readonly<Record<ConsolidationStageName, StageProperties>> = {
  // LABILE: No structural substrate yet. Fully vulnerable to decay.
  // Biological: post-translational modifications only (minutes).
  labile: {
    decayMultiplier: 2.0,
    interferenceVulnerability: 0.9,
    plasticity: 1.0,
    minDwellHours: 0.0,
    maxDwellHours: 1.0,
    heatFloor: 0.0, // Can decay to zero — no structural support
  },
  // EARLY_LTP: Synaptic tag set but protein synthesis not yet complete.
  // Biological: PKA/CaMKII activation (1-6h). Reversible.
  early_ltp: {
    decayMultiplier: 1.2,
    interferenceVulnerability: 0.5,
    plasticity: 0.7,
    minDwellHours: 1.0,
    maxDwellHours: 6.0,
    heatFloor: 0.0, // Still reversible — no guaranteed retention
  },
  // LATE_LTP: CREB-dependent protein synthesis complete. Structural changes
  // beginning. Blocked by anisomycin only if applied within first 1-3h window.
  // Biological: new protein synthesis, initial synapse growth (6-24h).
  late_ltp: {
    decayMultiplier: 0.8,
    interferenceVulnerability: 0.2,
    plasticity: 0.3,
    minDwellHours: 6.0,
    maxDwellHours: 24.0,
    heatFloor: 0.05, // Partial structural support — won't fully vanish
  },
  // CONSOLIDATED: Structural consolidation complete (Kandel 2001: at 72h,
  // blocking protein synthesis has NO effect — synaptic changes are permanent).
  // // source: Bahrick (1984): permastore — retained for 30+ years without rehearsal.
  // // source: Benna & Fusi (2016): deepest cascade levels provide irreversible storage.
  consolidated: {
    decayMultiplier: 0.5,
    interferenceVulnerability: 0.05,
    plasticity: 0.1,
    minDwellHours: 24.0,
    maxDwellHours: Infinity,
    heatFloor: 0.10, // Permastore: always retrievable (Bahrick 1984)
  },
  // RECONSOLIDATING: Retrieved memory becomes labile again (Nader 2000).
  // Needs re-stabilization via protein synthesis.
  reconsolidating: {
    decayMultiplier: 1.5,
    interferenceVulnerability: 0.8,
    plasticity: 0.9,
    minDwellHours: 0.0,
    maxDwellHours: 6.0,
    heatFloor: 0.05, // Was consolidated — retains partial structural support
  },
};

// ── Public API ───────────────────────────────────────────────────────────────

/** Get properties for a consolidation stage by its enum-like name. */
export function getStageProperties(stage: ConsolidationStageName): StageProperties {
  return STAGE_PROPERTIES[stage];
}

/**
 * Get stage properties by string name.
 * Returns LABILE properties for unknown stage names (safe default).
 */
export function getStagePropertiesByName(stageName: string): StageProperties {
  const props = STAGE_PROPERTIES[stageName as ConsolidationStageName];
  return props ?? STAGE_PROPERTIES.labile;
}

/**
 * Get minimum heat floor for a consolidation stage (Bahrick 1984 permastore).
 *
 * Consolidated memories never decay below this floor. The structural
 * substrate (new synapses, enlarged spines — Kandel 2001) persists
 * even without rehearsal.
 */
export function getHeatFloor(stageName: string): number {
  return getStagePropertiesByName(stageName).heatFloor;
}

// ── Decay Integration ────────────────────────────────────────────────────────

/**
 * Adjust decay factor based on consolidation stage.
 *
 * Labile memories decay faster. Consolidated memories decay slower.
 *
 * The decay_distance is scaled by the stage's decay_multiplier so that
 * the same base rate produces qualitatively different timescales per stage.
 * // source: Apply consolidation stage multiplier (Kandel 2001)
 *
 * @param baseDecayFactor - Base per-hour decay factor (e.g. 0.95).
 * @param currentStage    - Current consolidation stage name.
 * @returns Stage-adjusted decay factor in [0, 1]. Higher = slower decay.
 */
export function computeStageAdjustedDecay(
  baseDecayFactor: number,
  currentStage: string,
): number {
  const props = getStagePropertiesByName(currentStage);
  const decayDistance = 1.0 - baseDecayFactor;
  const adjustedDistance = decayDistance * props.decayMultiplier;
  return Math.max(0.0, Math.min(1.0, 1.0 - adjustedDistance));
}

/**
 * Compute how much a memory resists interference from a similar new memory.
 *
 * @param currentStage            - Current consolidation stage name.
 * @param similarityToInterferer  - Cosine similarity to the interfering memory [0, 1].
 * @returns Interference resistance score [0, 1].
 */
export function computeInterferenceResistance(
  currentStage: string,
  similarityToInterferer: number,
): number {
  const props = getStagePropertiesByName(currentStage);
  const rawThreat = similarityToInterferer * props.interferenceVulnerability;
  return Math.max(0.0, Math.min(1.0, 1.0 - rawThreat));
}

// ── Serialization ─────────────────────────────────────────────────────────────

/** Serialize consolidation state for storage. */
export function stageToDict(
  stage: string,
  hoursInStage: number,
  replayCount = 0,
): Record<string, unknown> {
  const props = getStagePropertiesByName(stage);
  return {
    stage,
    hours_in_stage: Math.round(hoursInStage * 100) / 100,
    replay_count: replayCount,
    decay_multiplier: props.decayMultiplier,
    interference_vulnerability: props.interferenceVulnerability,
    plasticity: props.plasticity,
  };
}
