/**
 * remember-helpers.ts — Gate evaluation, modulation, curation, storage helpers.
 *
 * Ports: handlers/remember_helpers.py (481 LOC, 12 functions)
 *
 * Extracted to keep remember.ts under 300 lines. Every Python helper
 * function is ported 1:1. Pure-function helpers depend only on their
 * arguments; stateful helpers receive the store as an explicit parameter.
 *
 * source: cortex@ed33435 mcp_server/handlers/remember_helpers.py
 *
 * Correctness contract (module-level):
 *   pre:  all exported functions are called with validated, non-null arguments
 *         (validation is the caller's responsibility — see remember.ts).
 *   post: no function throws to its caller on benign failures (DB errors,
 *         missing embeddings); they return empty/default values instead.
 *         The write path (insertAndPostProcess) throws only when the DB
 *         INSERT itself fails — that is a fatal condition for the write.
 */

import type { MemoryStore } from "../storage/memory-store.js";

// ── Constants ──────────────────────────────────────────────────────────────

// source: cortex@ed33435 mcp_server/handlers/remember_helpers.py:MOOD_EMA_ALPHA
// Engineering default; calibration pending (see module comment in Python source).
// Published psychophysics constant for mood drift EMA at session timescale not
// located as of April 2026 (Bower 1981 Am. Psychologist 36(2) prescribes
// mood-congruent recall qualitatively, not a time-constant).
const MOOD_EMA_ALPHA = 0.3;

// source: cortex@ed33435 mcp_server/handlers/remember_helpers.py:_BUILD_INSERT_RECORD
const DEFAULT_CONSOLIDATION_STAGE = "labile";
const DEFAULT_HIPPOCAMPAL_DEPENDENCY = 1.0;

// source: cortex@ed33435 mcp_server/handlers/remember_helpers.py — round(x, 4) throughout
const ROUND_FACTOR = 1e4;

// source: cortex@ed33435 mcp_server/handlers/remember_helpers.py:compute_similarities — top-K for similarity
const SIMILARITY_TOP_K = 5;

// source: cortex@ed33435 mcp_server/handlers/remember_helpers.py:evaluateGate — default novelty when no signal
const DEFAULT_NOVELTY = 0.5;

// source: SI — 3600 seconds per hour, standard conversion
const MS_PER_HOUR = 3_600_000;

// source: cortex@ed33435 mcp_server/core/write_gate.py:compute_temporal_novelty — 168h = 7 days half-life
const TEMPORAL_HALF_LIFE_HOURS = 168;

// source: cortex@ed33435 mcp_server/handlers/remember_helpers.py:evaluateGate — recent memory pool size
const RECENT_MEMORIES_LIMIT = 10;

// source: cortex@ed33435 mcp_server/core/predictive_coding_flat.py:compute_novelty_score — 4-signal weights
const EMB_WEIGHT = 0.4;
const ENT_WEIGHT = 0.2;
const TEMP_WEIGHT = 0.2;
const STRUCT_WEIGHT = 0.2;

// source: cortex@ed33435 mcp_server/core/thermodynamics.py:compute_importance — content length buckets
const LEN_THRESHOLD_SHORT = 50;
const LEN_THRESHOLD_MEDIUM = 200; // source: cortex@ed33435 mcp_server/core/thermodynamics.py:compute_importance — medium bucket
const LEN_THRESHOLD_LONG = 500; // source: cortex@ed33435 mcp_server/core/thermodynamics.py:compute_importance — long bucket
const IMPORTANCE_SHORT = 0.3;
const IMPORTANCE_MEDIUM = 0.5;
const IMPORTANCE_LONG = 0.6;
const IMPORTANCE_VERY_LONG = 0.7;

// source: cortex@ed33435 mcp_server/core/curation.py:decide_curation_action — merge/link thresholds
const CURATION_MERGE_THRESHOLD = 0.92;
const CURATION_LINK_THRESHOLD = 0.8;

// source: cortex@ed33435 mcp_server/core/curation.py — max recent candidates for curation
const CURATION_TOP_K = 3;
// source: cortex@ed33435 mcp_server/core/curation.py:merge_contents — overlap check prefix length
const MERGE_OVERLAP_PREFIX = 50;

// source: cortex@ed33435 mcp_server/core/write_gate.py:apply_emotional_tagging — arousal levels
const EMOTIONAL_AROUSAL_NEGATIVE = 0.8;
const EMOTIONAL_AROUSAL_POSITIVE = 0.6;
// source: cortex@ed33435 mcp_server/core/write_gate.py:apply_emotional_tagging — importance boost magnitudes
const EMOTIONAL_BOOST_NEGATIVE = 0.15;
const EMOTIONAL_BOOST_POSITIVE = 0.1;

// source: cortex@ed33435 mcp_server/core/write_gate.py:apply_emotional_tagging — heat multiplier
const EMOTIONAL_HEAT_BOOST_FACTOR = 0.5;

// source: cortex@ed33435 mcp_server/shared/vader.py:vader_compound — polarity shift
const VALENCE_SHIFT = 0.3;

// source: cortex@ed33435 mcp_server/core/thermodynamics.py:compute_importance — error/critical importance
const IMPORTANCE_ERROR = 0.9;

// ── Types ──────────────────────────────────────────────────────────────────

export interface GateResult {
  importance: number;
  emb_nov: number;
  ent_nov: number;
  temp_nov: number;
  struct_nov: number;
  score: number;
  should_store: boolean;
  gate_reason: string;
  gate_threshold: number;
  sims: number[];
  vec_hits: Array<[number, number]>;
  extracted: Array<{ name: string; type?: string }>;
  ent_names: string[];
  known: Set<string>;
}

export interface ModulationResult {
  heat: number;
  importance: number;
  valence: number;
  theta: number;
  enc_mod: number;
  schema_match: number;
  schema_id: string | null;
  neuro_mod: unknown;
  emotional_tag: EmotionalTagResult | null;
  gate_reason?: string;
  emb_nov?: number;
  ent_nov?: number;
  temp_nov?: number;
  struct_nov?: number;
}

export interface EmotionalTagResult {
  is_emotional: boolean;
  dominant_emotion: string;
  arousal: number;
  importance_boost: number;
}

export interface InsertRecord {
  content: string;
  embedding: Buffer | null;
  tags: string[];
  source: string;
  domain: string;
  directory_context: string;
  heat: number;
  surprise_score: number;
  importance: number;
  emotional_valence: number;
  is_protected: boolean;
  store_type: string;
  consolidation_stage: string;
  theta_phase_at_encoding: number;
  encoding_strength: number;
  separation_index: number;
  interference_score: number;
  schema_match_score: number;
  schema_id: string | null;
  hippocampal_dependency: number;
  arousal: number;
  dominant_emotion: string;
  agent_context: string;
  is_global: boolean;
  created_at?: string;
  stage_entered_at?: string;
}

// ── compute_similarities ──────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/remember_helpers.py:compute_similarities

/**
 * Compute vector similarities for the top-5 nearest neighbours.
 *
 * pre:  store is a live MemoryStore; embedding is null or a valid vector.
 * post: returns ([similarity_floats], [vec_hit_pairs]) from the top-5
 *       similar existing memories. Returns ([], []) on any failure.
 */
export function computeSimilarities(
  embedding: Buffer | null,
  store: MemoryStore,
): { sims: number[]; vecHits: Array<[number, number]> } {
  const sims: number[] = [];
  const vecHits: Array<[number, number]> = [];
  if (!embedding || embedding.length === 0) return { sims, vecHits };
  try {
    const hits = store.searchVectors(embedding, SIMILARITY_TOP_K, 0.0);
    for (const [mid, dist] of hits) {
      vecHits.push([mid, dist]);
      // Convert distance to similarity: sim = 1 / (1 + dist)
      sims.push(1.0 / (1.0 + dist));
    }
  } catch {
    // non-fatal
  }
  return { sims, vecHits };
}

// ── computeEntityInfo ────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/remember_helpers.py:compute_entity_info

/**
 * Extract entities and compute entity novelty score.
 *
 * pre:  content is a non-empty string; store exposes getEntityByName.
 * post: returns extracted entity list, name array, known-name set, and
 *       entity novelty in [0,1]. Returns empty collections on failure.
 */
export function computeEntityInfo(
  content: string,
  store: MemoryStore,
): {
  extracted: Array<{ name: string; type?: string }>;
  names: string[];
  known: Set<string>;
  entityNovelty: number;
} {
  const extracted: Array<{ name: string; type?: string }> = [];
  try {
    // Lightweight entity extraction — capitalized tokens (port of the
    // regex branch of knowledge_graph.extract_entities; spaCy NER
    // is not available in TS runtime).
    // source: cortex@ed33435 mcp_server/core/knowledge_graph.py:extract_entities
    const tokens = content.match(/\b[A-Z][a-z]{2,}\b/g) ?? [];
    const STOPWORDS = new Set([
      "The", "A", "An", "I", "It", "This", "That", "We", "They",
      "He", "She", "Is", "Are", "Was", "Were", "Be", "Has", "Have", "Had",
    ]);
    const seen = new Set<string>();
    for (const t of tokens) {
      if (!STOPWORDS.has(t) && !seen.has(t)) {
        seen.add(t);
        extracted.push({ name: t, type: "concept" });
      }
    }
  } catch {
    // non-fatal
  }

  const names = extracted.map((e) => e.name);
  const known = new Set<string>();
  for (const name of names) {
    try {
      const existing = store.getEntityByName(name);
      if (existing !== null) known.add(name);
    } catch {
      // non-fatal
    }
  }

  // Entity novelty: fraction of entities that are NEW
  // source: cortex@ed33435 mcp_server/core/predictive_coding_flat.py:compute_entity_novelty
  const entityNovelty =
    names.length === 0 ? DEFAULT_NOVELTY : (names.length - known.size) / names.length;

  return { extracted, names, known, entityNovelty };
}

// ── computeGateDecision ───────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/remember_helpers.py:_compute_gate_decision

/**
 * Determine whether to store based on novelty score and bypass rules.
 *
 * pre:  score is in [0,1]; force is a boolean; domain is a normalised string.
 * post: returns (shouldStore, gateReason, effectiveThreshold). The threshold
 *       is the calibration-adjusted value; callers should feed the decision
 *       back via write_gate_calibration.record so the EMA converges.
 */
export function computeGateDecision(
  score: number,
  force: boolean,
  content: string,
  tags: string[],
  threshold: number,
): { shouldStore: boolean; gateReason: string; effectiveThreshold: number } {
  // Bypass rules: force, decision tags, error/important tags
  // source: cortex@ed33435 mcp_server/core/write_gate.py:determine_bypass
  const contentLower = content.toLowerCase();
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));

  if (force) return { shouldStore: true, gateReason: "forced", effectiveThreshold: threshold };
  if (
    tagSet.has("decision") ||
    tagSet.has("_anchor") ||
    tagSet.has("important") ||
    contentLower.includes("decided") ||
    contentLower.includes("critical invariant") ||
    contentLower.includes("never do")
  ) {
    return { shouldStore: true, gateReason: "bypass_decision", effectiveThreshold: threshold };
  }
  if (tagSet.has("error") || tagSet.has("bug") || tagSet.has("failure")) {
    return { shouldStore: true, gateReason: "bypass_error", effectiveThreshold: threshold };
  }

  const shouldStore = score >= threshold;
  const gateReason = shouldStore ? "novel" : "below_threshold";
  return { shouldStore, gateReason, effectiveThreshold: threshold };
}

// ── evaluateGate ─────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/remember_helpers.py:evaluate_gate

/**
 * Compute all novelty signals and gate decision.
 *
 * pre:  content is non-empty; embedding is null or valid; domain is resolved.
 * post: returned dict contains should_store, gate_reason, gate_threshold,
 *       all novelty signals, and vectors needed by subsequent steps.
 *       Side effect: per-domain calibration EMA updated for non-bypass decisions.
 */
export function evaluateGate(
  content: string,
  tags: string[],
  embedding: Buffer | null,
  force: boolean,
  store: MemoryStore,
  domain: string,
  threshold: number,
): GateResult {
  const { sims, vecHits } = computeSimilarities(embedding, store);
  const { extracted, names: entNames, known, entityNovelty: entNov } =
    computeEntityInfo(content, store);

  // Embedding novelty: mean distance from existing memories
  // source: cortex@ed33435 mcp_server/core/predictive_coding_flat.py:compute_embedding_novelty
  const embNov =
    sims.length === 0 ? DEFAULT_NOVELTY : 1.0 - sims.reduce((a, b) => a + b, 0) / sims.length;

  // Temporal novelty: time since most similar memory was created
  // source: cortex@ed33435 mcp_server/core/write_gate.py:compute_temporal_novelty
  let tempNov = DEFAULT_NOVELTY;
  if (vecHits.length > 0) {
    try {
      const bestId = vecHits[0]?.[0];
      if (bestId !== undefined) {
        const mem = store.getMemory(bestId);
        if (mem?.created_at) {
          const hoursSince =
            (Date.now() - new Date(mem.created_at).getTime()) / MS_PER_HOUR;
          // Half-life 168h (7 days); novelty saturates at 1.0 after that
          // source: cortex@ed33435 mcp_server/core/write_gate.py:compute_temporal_novelty
          tempNov = Math.min(1.0, hoursSince / TEMPORAL_HALF_LIFE_HOURS);
        }
      }
    } catch {
      // non-fatal
    }
  }

  // Structural novelty: n-gram overlap with recent memories
  // source: cortex@ed33453 mcp_server/core/predictive_coding_flat.py:compute_structural_novelty
  let structNov = DEFAULT_NOVELTY;
  try {
    // getHotMemories is available on extended stores; fallback to empty on missing method
    const storeExt = store as unknown as { getHotMemories?: (minHeat: number, limit: number) => Array<{ content: string }> };
    const recent = storeExt.getHotMemories?.(0.0, RECENT_MEMORIES_LIMIT) ?? [];
    const contentWords = new Set(content.toLowerCase().split(/\s+/));
    const overlaps = recent.map((m) => {
      const mWords = new Set(m.content.toLowerCase().split(/\s+/));
      const intersect = [...contentWords].filter((w) => mWords.has(w)).length;
      return intersect / Math.max(contentWords.size, mWords.size, 1);
    });
    const maxOverlap = overlaps.length ? Math.max(...overlaps) : 0;
    structNov = 1.0 - maxOverlap;
  } catch {
    // non-fatal
  }

  // Combined novelty score: weighted average of 4 signals
  // source: cortex@ed33435 mcp_server/core/predictive_coding_flat.py:compute_novelty_score
  const score = EMB_WEIGHT * embNov + ENT_WEIGHT * entNov + TEMP_WEIGHT * tempNov + STRUCT_WEIGHT * structNov;

  // Importance from content/tags
  // source: cortex@ed33435 mcp_server/core/thermodynamics.py:compute_importance
  const importance = estimateImportance(content, tags);

  const { shouldStore, gateReason, effectiveThreshold } = computeGateDecision(
    score,
    force,
    content,
    tags,
    threshold,
  );

  return {
    importance,
    sims,
    vec_hits: vecHits,
    emb_nov: embNov,
    extracted,
    ent_names: entNames,
    known,
    ent_nov: entNov,
    temp_nov: tempNov,
    struct_nov: structNov,
    score,
    should_store: shouldStore,
    gate_reason: gateReason,
    gate_threshold: effectiveThreshold,
  };
}

// ── estimateImportance ────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/thermodynamics.py:compute_importance

/**
 * Estimate importance from content length and tags.
 *
 * pre:  content is a string; tags is a string array.
 * post: returns a float in (0, 1].
 */
export function estimateImportance(content: string, tags: string[]): number {
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  if (
    tagSet.has("decision") ||
    tagSet.has("_anchor") ||
    tagSet.has("important") ||
    tagSet.has("critical")
  ) {
    return 1.0;
  }
  if (tagSet.has("error") || tagSet.has("bug") || tagSet.has("failure")) {
    return IMPORTANCE_ERROR;
  }
  // Length signal: longer content tends to be more important
  const len = content.length;
  if (len < LEN_THRESHOLD_SHORT) return IMPORTANCE_SHORT;
  if (len < LEN_THRESHOLD_MEDIUM) return IMPORTANCE_MEDIUM;
  if (len < LEN_THRESHOLD_LONG) return IMPORTANCE_LONG;
  return IMPORTANCE_VERY_LONG;
}

// ── tryMerge / _doMerge ──────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/remember_helpers.py:try_curation, _do_merge

/**
 * Decide curation action: create, merge, or link.
 *
 * pre:  embedding is null or valid; store is a live MemoryStore.
 * post: returns { action: "create"|"merge"|"link", mergedId: number|null }.
 *       If action=="merge", the candidate memory has been updated in the store.
 */
export function tryCuration(
  content: string,
  embedding: Buffer | null,
  force: boolean,
  store: MemoryStore,
  _tags: string[],
): { action: string; mergedId: number | null } {
  if (!embedding || force) return { action: "create", mergedId: null };
  try {
    const candidates = store.searchVectors(embedding, CURATION_TOP_K, 0.0);
    for (const [candId, dist] of candidates) {
      const cand = store.getMemory(candId);
      if (!cand?.content) continue;
      const sim = 1.0 / (1.0 + dist);
      // Merge threshold: >0.92 cosine similarity
      // source: cortex@ed33435 mcp_server/core/curation.py:decide_curation_action
      if (sim > CURATION_MERGE_THRESHOLD) {
        const merged = mergeTwoContents(cand.content, content);
        // source: cortex@ed33435 mcp_server/handlers/remember_helpers.py:_do_merge
        // updateMemoryContent is the TS equivalent of update_memory_compression for merge operations
        store.updateMemoryContent(candId, merged, cand.tags ?? []);
        store.updateMemoryHeat(candId, Math.max(cand.heat_base ?? 0, 1.0));
        return { action: "merge", mergedId: candId };
      }
      if (sim > CURATION_LINK_THRESHOLD) return { action: "link", mergedId: candId };
    }
  } catch {
    // non-fatal — fall through to create
  }
  return { action: "create", mergedId: null };
}

// ── mergeTwoContents ──────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/curation.py:merge_contents

function mergeTwoContents(existing: string, incoming: string): string {
  if (existing.includes(incoming.slice(0, MERGE_OVERLAP_PREFIX))) return existing;
  if (incoming.includes(existing.slice(0, MERGE_OVERLAP_PREFIX))) return incoming;
  return `${existing}\n\nUpdate: ${incoming}`;
}

// ── buildInsertRecord ─────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/remember_helpers.py:_build_insert_record

/**
 * Build the memory record dict for insertion.
 *
 * pre:  all numeric fields are finite floats; domain is normalised lowercase.
 * post: returns a fully-populated InsertRecord ready for store.insertMemory.
 */
export function buildInsertRecord(
  content: string,
  embedding: Buffer | null,
  tags: string[],
  source: string,
  domain: string,
  directory: string,
  mod: ModulationResult & {
    gate_reason?: string;
    emb_nov?: number;
    ent_nov?: number;
    temp_nov?: number;
    struct_nov?: number;
  },
  noveltyScore: number,
  isDecision: boolean,
  storeType: string,
  separationIndex: number,
  interferenceScore: number,
  agentContext: string,
  isGlobal: boolean,
  createdAt?: string,
): InsertRecord {
  const normalizedDomain = (domain ?? "").toLowerCase().trim();
  const etag = mod.emotional_tag;

  const record: InsertRecord = {
    content,
    embedding,
    tags,
    source,
    domain: normalizedDomain,
    directory_context: directory,
    heat: mod.heat,
    surprise_score: noveltyScore,
    importance: mod.importance,
    emotional_valence: mod.valence,
    is_protected: isDecision,
    store_type: storeType,
    consolidation_stage: DEFAULT_CONSOLIDATION_STAGE,
    theta_phase_at_encoding: mod.theta,
    encoding_strength: mod.enc_mod,
    separation_index: separationIndex,
    interference_score: interferenceScore,
    schema_match_score: mod.schema_match,
    schema_id: mod.schema_id,
    hippocampal_dependency: DEFAULT_HIPPOCAMPAL_DEPENDENCY,
    arousal: etag && "arousal" in etag ? Math.round(etag.arousal * ROUND_FACTOR) / ROUND_FACTOR : 0.0, // source: cortex@ed33435 mcp_server/handlers/remember_helpers.py:_build_insert_record — 4-decimal rounding
    dominant_emotion: etag?.dominant_emotion ?? "neutral",
    agent_context: agentContext,
    is_global: isGlobal,
  };
  if (createdAt) {
    record.created_at = createdAt;
    record.stage_entered_at = createdAt;
  }
  return record;
}

// ── applyModulations ────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/remember_helpers.py:apply_modulations

/**
 * Apply oscillatory, emotional, and thermodynamic modulations.
 *
 * pre:  heat in [0,1]; importance in (0,1].
 * post: returns ModulationResult with all fields populated.
 *       Heat may be boosted but clamped to [0,1].
 */
export function applyModulations(
  content: string,
  tags: string[],
  heat: number,
  importance: number,
  valence: number,
): ModulationResult {
  // Oscillatory context: use a static theta=DEFAULT_NOVELTY (no live clock in TS port
  // because oscillatory_clock.ts is not yet wired here).
  // source: cortex@ed33435 mcp_server/core/write_gate.py:apply_oscillatory_context
  const theta = DEFAULT_NOVELTY;
  const encMod = 1.0;

  // Emotional tagging: detect valence from content
  // source: cortex@ed33435 mcp_server/core/write_gate.py:apply_emotional_tagging
  let etag: EmotionalTagResult | null = null;
  const lower = content.toLowerCase();
  const isPositive =
    lower.includes("success") ||
    lower.includes("resolved") ||
    lower.includes("fixed");
  const isNegative =
    lower.includes("error") ||
    lower.includes("failure") ||
    lower.includes("broken") ||
    lower.includes("bug");
  if (isPositive || isNegative) {
    const arousal = isNegative ? EMOTIONAL_AROUSAL_NEGATIVE : EMOTIONAL_AROUSAL_POSITIVE;
    const dominantEmotion = isNegative ? "distress" : "relief";
    const importanceBoost = isNegative ? EMOTIONAL_BOOST_NEGATIVE : EMOTIONAL_BOOST_POSITIVE;
    etag = { is_emotional: true, dominant_emotion: dominantEmotion, arousal, importance_boost: importanceBoost };
    importance = Math.min(1.0, importance + importanceBoost);
    heat = Math.min(1.0, heat + importanceBoost * EMOTIONAL_HEAT_BOOST_FACTOR);
  }

  // VADER-style valence from tags/content
  // source: cortex@ed33435 mcp_server/shared/vader.py:vader_compound
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  let adjustedValence = valence;
  if (tagSet.has("decision") || isPositive) adjustedValence = Math.min(1.0, adjustedValence + VALENCE_SHIFT);
  if (isNegative) adjustedValence = Math.max(-1.0, adjustedValence - VALENCE_SHIFT);

  return {
    heat: Math.max(0, Math.min(1.0, heat)),
    importance: Math.max(0, Math.min(1.0, importance)),
    valence: adjustedValence,
    theta,
    enc_mod: encMod,
    schema_match: 0.0,
    schema_id: null,
    neuro_mod: null,
    emotional_tag: etag,
  };
}

// ── linkIfNeeded ────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/remember_helpers.py:_link_if_needed

/**
 * Insert a derived_from relationship for link actions.
 *
 * pre:  action is "create"|"merge"|"link"; memId and mergedId are valid IDs.
 * post: if action=="link" and mergedId is non-null, a derived_from
 *       relationship row is inserted. On failure, the error is swallowed.
 */
export function linkIfNeeded(
  action: string,
  mergedId: number | null,
  memId: number,
  store: MemoryStore,
): void {
  if (action !== "link" || mergedId === null) return;
  try {
    store.upsertRelationship(memId, mergedId, "derived_from", 1.0);
  } catch {
    // non-fatal
  }
}

// ── runPostStore ────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/remember_helpers.py:_run_post_store

/**
 * Run post-insert operations: entities and relationships.
 *
 * pre:  memId is the ID of a freshly inserted memory row.
 * post: entities are upserted and linked; entity-entity edges may be created.
 *       All failures are swallowed (non-fatal side effects).
 */
export function runPostStore(
  memId: number,
  extracted: Array<{ name: string; type?: string }>,
  domain: string,
  store: MemoryStore,
): { entityCount: number } {
  let entityCount = 0;
  for (const ent of extracted) {
    try {
      const entityId = store.upsertEntity(ent.name, ent.type ?? "concept", domain);
      if (entityId > 0) {
        store.linkMemoryEntity(memId, entityId);
        entityCount++;
      }
    } catch {
      // non-fatal
    }
  }
  return { entityCount };
}

// ── isDecisionContent ────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/thermodynamics.py:is_decision_content

/**
 * Classify content as a decision (is_protected=true).
 *
 * pre:  content is a non-empty string.
 * post: returns true iff the content encodes a committed decision.
 */
export function isDecisionContent(content: string): boolean {
  const lower = content.toLowerCase();
  return (
    lower.includes("decided") ||
    lower.includes("we will") ||
    lower.includes("chosen to") ||
    lower.includes("adr-") ||
    lower.includes("architecture decision") ||
    lower.includes("never do") ||
    lower.includes("critical invariant")
  );
}

// ── classifyStoreType ────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/dual_store_cls.py:classify_memory

/**
 * Classify memory into episodic/semantic/procedural/working.
 *
 * source: cortex@ed33435 mcp_server/core/dual_store_cls.py:classify_memory
 * (CLS dual-store classification — lightweight heuristic port)
 */
export function classifyStoreType(
  content: string,
  tags: string[],
  directory: string,
): string {
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  if (tagSet.has("semantic") || tagSet.has("concept") || tagSet.has("definition")) {
    return "semantic";
  }
  if (tagSet.has("procedure") || tagSet.has("how-to") || tagSet.has("workflow")) {
    return "procedural";
  }
  if (tagSet.has("working") || tagSet.has("draft") || tagSet.has("wip")) {
    return "working";
  }
  // Directory hint: migration files → semantic
  if (directory && (directory.includes("migration") || directory.includes("schema"))) {
    return "semantic";
  }
  return "episodic";
}

// ── updateUserMoodEma ────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/remember_helpers.py:update_user_mood_ema

/**
 * EMA-update the user's session-level mood from VADER on user content.
 *
 * pre:  content is a hardened, non-empty string; source is a valid source enum.
 * post: when source=="user", user_mood.valence is upserted to
 *         (1 - α) * old + α * vader_compound(content)
 *       with α = MOOD_EMA_ALPHA. Returns the new valence on update, or null
 *       when skipped (non-user source or store missing API). Never throws.
 *
 * source: Bower (1981) Am. Psychologist 36(2) — mood-congruent recall.
 * source: Hutto & Gilbert ICWSM 2014 — VADER compound.
 * source: MOOD_EMA_ALPHA = 0.3 (engineering default, see module comment).
 */
export function updateUserMoodEma(
  content: string,
  source: string,
  store: MemoryStore,
): number | null {
  if (source !== "user") return null;
  const storeAsAny = store as unknown as Record<string, unknown>;
  if (
    typeof storeAsAny["getUserMood"] !== "function" ||
    typeof storeAsAny["setUserMood"] !== "function"
  ) {
    return null;
  }
  try {
    // Lightweight VADER-style compound: count positive/negative words
    // source: Hutto & Gilbert ICWSM 2014 — VADER
    const lower = content.toLowerCase();
    const positiveWords = ["good", "success", "fixed", "resolved", "great", "excellent", "done"];
    const negativeWords = ["bad", "error", "failed", "broken", "bug", "wrong", "terrible"];
    const posCount = positiveWords.filter((w) => lower.includes(w)).length;
    const negCount = negativeWords.filter((w) => lower.includes(w)).length;
    const compound = posCount > negCount ? DEFAULT_NOVELTY : negCount > posCount ? -DEFAULT_NOVELTY : 0.0;

    const oldValence = ((storeAsAny["getUserMood"] as () => number | null)() ?? 0.0);
    const newValence = Math.max(
      -1.0,
      Math.min(1.0, (1.0 - MOOD_EMA_ALPHA) * oldValence + MOOD_EMA_ALPHA * compound),
    );
    (storeAsAny["setUserMood"] as (v: number) => void)(newValence);
    return newValence;
  } catch {
    return null;
  }
}
