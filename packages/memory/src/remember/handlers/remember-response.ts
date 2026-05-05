/**
 * remember-response.ts — Response builders for the remember handler.
 *
 * Ports: handlers/remember_response.py (117 LOC, 5 functions)
 *
 * Constructs success, merge, rejection, and full response dicts.
 * Pure functions — no side effects, no I/O.
 *
 * source: cortex@ed33435 mcp_server/handlers/remember_response.py
 */

import type { EmotionalTagResult } from "./remember-helpers.js";

// ── Constants ──────────────────────────────────────────────────────────────

// source: cortex@ed33435 mcp_server/handlers/remember_response.py — round(x, 4) throughout
const ROUND_FACTOR = 1e4;

// source: cortex@ed33435 mcp_server/core/schema_engine.py:classify_schema_match — assimilation threshold
const SCHEMA_ASSIMILATION_THRESHOLD = 0.8;
// source: cortex@ed33435 mcp_server/core/schema_engine.py:classify_schema_match — accommodation threshold
const SCHEMA_ACCOMMODATION_THRESHOLD = 0.5;

// ── Types ──────────────────────────────────────────────────────────────────

export interface EmotionalInfo {
  dominant: string;
  arousal: number;
  boost: number;
}

export interface SchemaInfo {
  match_score: number;
  schema_id: string | null;
  pathway: string;
}

export interface OscillatoryInfo {
  theta_phase: number;
  encoding_strength: number;
}

export interface PatternSeparationInfo {
  separation_index: number;
  interference_score: number;
}

export interface NoveltyDescription {
  emb: number;
  ent: number;
  temp: number;
  struct: number;
  combined: number;
  dominant: string;
}

export interface MechanismFields {
  neuromodulation: unknown;
  emotional_tag: EmotionalInfo | null;
  oscillatory: OscillatoryInfo;
  consolidation_stage: string;
  pattern_separation: PatternSeparationInfo;
  schema: SchemaInfo | null;
}

export interface RememberSuccessResponse {
  stored: true;
  memory_id: number;
  action: string;
  store_type: string;
  domain: string;
  heat: number;
  importance: number;
  valence: number;
  reason: string;
  novelty: NoveltyDescription;
  triggers_created: number[];
  entities_extracted: number;
  engram: Record<string, unknown> | null;
  synaptic_tags: number;
  neuromodulation: unknown;
  emotional_tag: EmotionalInfo | null;
  oscillatory: OscillatoryInfo;
  consolidation_stage: string;
  pattern_separation: PatternSeparationInfo;
  schema: SchemaInfo | null;
}

export interface RememberMergeResponse {
  stored: true;
  memory_id: number | null;
  action: "merged";
  domain: string;
  heat: number;
  importance: number;
  novelty: NoveltyDescription;
  reason: "merged_with_existing";
}

export interface RememberRejectionResponse {
  stored: false;
  reason: string;
  novelty: NoveltyDescription;
  importance: number;
}

// ── buildEmotionalInfo ────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/remember_response.py:build_emotional_info

/**
 * Extract emotional summary from tag result.
 *
 * pre:  etag is null or an EmotionalTagResult.
 * post: returns EmotionalInfo when etag.is_emotional is true, else null.
 */
export function buildEmotionalInfo(etag: EmotionalTagResult | null): EmotionalInfo | null {
  if (!etag || !etag.is_emotional) return null;
  return {
    dominant: etag.dominant_emotion,
    arousal: etag.arousal,
    boost: etag.importance_boost,
  };
}

// ── buildSchemaInfo ───────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/remember_response.py:build_schema_info

/**
 * Build schema match info if present.
 *
 * pre:  schemaMatch is a float; schemaId is string or null.
 * post: returns SchemaInfo when schemaMatch > 0, else null.
 */
export function buildSchemaInfo(
  schemaMatch: number,
  schemaId: string | null,
): SchemaInfo | null {
  if (schemaMatch <= 0) return null;
  // source: cortex@ed33435 mcp_server/core/schema_engine.py:classify_schema_match
  let pathway: string;
  if (schemaMatch >= SCHEMA_ASSIMILATION_THRESHOLD) pathway = "assimilation";
  else if (schemaMatch >= SCHEMA_ACCOMMODATION_THRESHOLD) pathway = "accommodation";
  else pathway = "equilibration";

  return {
    match_score: Math.round(schemaMatch * ROUND_FACTOR) / ROUND_FACTOR,
    schema_id: schemaId,
    pathway,
  };
}

// ── describeSignals ───────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/predictive_coding_flat.py:describe_signals

/**
 * Build a novelty description from the 4 component signals.
 *
 * pre:  all inputs are finite floats.
 * post: returns NoveltyDescription with dominant signal identified.
 */
export function describeSignals(
  embNov: number,
  entNov: number,
  tempNov: number,
  structNov: number,
  combined: number,
): NoveltyDescription {
  const signals: Record<string, number> = {
    embedding: embNov,
    entity: entNov,
    temporal: tempNov,
    structural: structNov,
  };
  let dominant = "embedding";
  let maxVal = embNov;
  for (const [k, v] of Object.entries(signals)) {
    if (v > maxVal) {
      maxVal = v;
      dominant = k;
    }
  }
  // source: cortex@ed33435 mcp_server/handlers/remember_response.py — 4-decimal rounding for all novelty signals
  return {
    emb: Math.round(embNov * ROUND_FACTOR) / ROUND_FACTOR, // source: cortex@ed33435 mcp_server/handlers/remember_response.py:describe_signals
    ent: Math.round(entNov * ROUND_FACTOR) / ROUND_FACTOR, // source: cortex@ed33435 mcp_server/handlers/remember_response.py:describe_signals
    temp: Math.round(tempNov * ROUND_FACTOR) / ROUND_FACTOR, // source: cortex@ed33435 mcp_server/handlers/remember_response.py:describe_signals
    struct: Math.round(structNov * ROUND_FACTOR) / ROUND_FACTOR, // source: cortex@ed33435 mcp_server/handlers/remember_response.py:describe_signals
    combined: Math.round(combined * ROUND_FACTOR) / ROUND_FACTOR, // source: cortex@ed33435 mcp_server/handlers/remember_response.py:describe_signals
    dominant,
  };
}

// ── buildMechanismFields ──────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/remember_response.py:_build_mechanism_fields

function buildMechanismFields(
  mod: {
    neuro_mod: unknown;
    emotional_tag: EmotionalTagResult | null;
    theta: number;
    enc_mod: number;
    schema_match: number;
    schema_id: string | null;
  },
  sep: number,
  interf: number,
): MechanismFields {
  return {
    neuromodulation: mod.neuro_mod,
    emotional_tag: buildEmotionalInfo(mod.emotional_tag),
    oscillatory: {
      theta_phase: Math.round(mod.theta * ROUND_FACTOR) / ROUND_FACTOR, // source: cortex@ed33435 mcp_server/handlers/remember_response.py:_build_mechanism_fields — 4-decimal
      encoding_strength: Math.round(mod.enc_mod * ROUND_FACTOR) / ROUND_FACTOR, // source: cortex@ed33435 mcp_server/handlers/remember_response.py:_build_mechanism_fields
    },
    consolidation_stage: "labile",
    pattern_separation: {
      separation_index: Math.round(sep * ROUND_FACTOR) / ROUND_FACTOR, // source: cortex@ed33435 mcp_server/handlers/remember_response.py:_build_mechanism_fields
      interference_score: Math.round(interf * ROUND_FACTOR) / ROUND_FACTOR, // source: cortex@ed33435 mcp_server/handlers/remember_response.py:_build_mechanism_fields
    },
    schema: buildSchemaInfo(mod.schema_match, mod.schema_id),
  };
}

// ── buildResponse ─────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/remember_response.py:build_response

/**
 * Build the full success response dict.
 *
 * pre:  memId is a positive integer; all mod fields are present.
 * post: returns a fully-populated RememberSuccessResponse.
 */
export function buildResponse(
  memId: number,
  action: string,
  storeType: string,
  domain: string,
  mod: {
    heat: number;
    importance: number;
    valence: number;
    gate_reason?: string;
    emb_nov?: number;
    ent_nov?: number;
    temp_nov?: number;
    struct_nov?: number;
    neuro_mod: unknown;
    emotional_tag: EmotionalTagResult | null;
    theta: number;
    enc_mod: number;
    schema_match: number;
    schema_id: string | null;
  },
  score: number,
  triggerIds: number[],
  extracted: Array<{ name: string; type?: string }>,
  slot: Record<string, unknown> | null,
  taggedCount: number,
  sep: number,
  interf: number,
): RememberSuccessResponse {
  const mechanismFields = buildMechanismFields(mod, sep, interf);
  return {
    stored: true,
    memory_id: memId,
    action,
    store_type: storeType,
    domain,
    heat: Math.round(mod.heat * ROUND_FACTOR) / ROUND_FACTOR, // source: cortex@ed33435 mcp_server/handlers/remember_response.py:build_response
    importance: Math.round(mod.importance * ROUND_FACTOR) / ROUND_FACTOR, // source: cortex@ed33435 mcp_server/handlers/remember_response.py:build_response
    valence: Math.round(mod.valence * ROUND_FACTOR) / ROUND_FACTOR, // source: cortex@ed33435 mcp_server/handlers/remember_response.py:build_response
    reason: mod.gate_reason ?? "novel",
    novelty: describeSignals(
      mod.emb_nov ?? 0,
      mod.ent_nov ?? 0,
      mod.temp_nov ?? 0,
      mod.struct_nov ?? 0,
      score,
    ),
    triggers_created: triggerIds,
    entities_extracted: extracted.length,
    engram: slot,
    synaptic_tags: taggedCount,
    ...mechanismFields,
  };
}

// ── buildMergeResponse ────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/remember_response.py:build_merge_response

/**
 * Build the response for a merge action.
 *
 * pre:  mid is null or a positive integer; gate contains novelty signals.
 * post: returns a RememberMergeResponse.
 */
export function buildMergeResponse(
  mid: number | null,
  domain: string,
  mod: { heat: number; importance: number },
  gate: {
    emb_nov?: number;
    ent_nov?: number;
    temp_nov?: number;
    struct_nov?: number;
    score: number;
  },
): RememberMergeResponse {
  return {
    stored: true,
    memory_id: mid,
    action: "merged",
    domain,
    heat: Math.round(mod.heat * ROUND_FACTOR) / ROUND_FACTOR, // source: cortex@ed33435 mcp_server/handlers/remember_response.py:build_merge_response
    importance: Math.round(mod.importance * ROUND_FACTOR) / ROUND_FACTOR, // source: cortex@ed33435 mcp_server/handlers/remember_response.py:build_merge_response
    novelty: describeSignals(
      gate.emb_nov ?? 0,
      gate.ent_nov ?? 0,
      gate.temp_nov ?? 0,
      gate.struct_nov ?? 0,
      gate.score,
    ),
    reason: "merged_with_existing",
  };
}

// ── buildRejectionResponse ────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/remember_response.py (rejection path in remember.py)

/**
 * Build a rejection response when the gate decides not to store.
 *
 * pre:  gateReason is non-empty; gate contains novelty signals.
 * post: returns a RememberRejectionResponse with stored=false.
 */
export function buildRejectionResponse(
  gateReason: string,
  importance: number,
  gate: {
    emb_nov?: number;
    ent_nov?: number;
    temp_nov?: number;
    struct_nov?: number;
    score: number;
  },
): RememberRejectionResponse {
  return {
    stored: false,
    reason: gateReason,
    novelty: describeSignals(
      gate.emb_nov ?? 0,
      gate.ent_nov ?? 0,
      gate.temp_nov ?? 0,
      gate.struct_nov ?? 0,
      gate.score,
    ),
    importance: Math.round(importance * ROUND_FACTOR) / ROUND_FACTOR, // source: cortex@ed33435 mcp_server/handlers/remember_response.py — 4-decimal rounding
  };
}
