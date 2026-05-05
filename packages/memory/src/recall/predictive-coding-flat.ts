/**
 * Flat 4-signal novelty computation for the write gate.
 *
 * Embedding, entity, temporal, and structural novelty signals used by
 * the remember handler and predictive coding gate.
 *
 * Pure business logic — no I/O.
 *
 * Port of: cortex@ed33435 mcp_server/core/predictive_coding_flat.py
 *
 * References:
 *   Friston K (2005) A theory of cortical responses.
 *     Phil Trans R Soc B 360:815-836
 */

// ── Shared regex patterns ─────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/predictive_coding_flat.py:19-23

const CODE_BLOCK_RE = /```[\s\S]*?```|`[^`\n]+`/g;
const FILE_PATH_RE = /(?:\.{0,2}\/)?(?:[\w@.-]+\/)+[\w@.-]+\.\w+/g;
const URL_RE = /https?:\/\/\S+/g;
const HEADING_RE = /^#{1,6}\s+\S/gm;
const LIST_RE = /^[\s]*[-*+]\s+\S/gm;

// ── Embedding novelty ─────────────────────────────────────────────────────

/**
 * Embedding novelty = 1 - max(similarities). 0.5 if no data.
 *
 * precondition:  similarities is an array of floats in [0, 1].
 * postcondition: result ∈ [0, 1]. Returns 0.5 when similarities is empty.
 *
 * source: cortex@ed33435 mcp_server/core/predictive_coding_flat.py:29-33
 */
export function computeEmbeddingNovelty(similarities: number[]): number {
  if (similarities.length === 0) return 0.5;
  const maxSim = Math.max(...similarities);
  return Math.max(0.0, Math.min(1.0, 1.0 - maxSim));
}

// ── Entity novelty ────────────────────────────────────────────────────────

/**
 * Fraction of entities that are truly new. 0.5 if none extracted.
 *
 * precondition:  newEntityNames is an iterable of strings.
 * postcondition: result ∈ [0, 1]. Returns 0.5 when newEntityNames is empty.
 *
 * source: cortex@ed33435 mcp_server/core/predictive_coding_flat.py:39-47
 */
export function computeEntityNovelty(
  newEntityNames: string[] | Set<string>,
  knownEntityNames: Set<string>,
): number {
  const names = Array.isArray(newEntityNames)
    ? newEntityNames
    : Array.from(newEntityNames);
  if (names.length === 0) return 0.5;
  const trulyNew = names.filter((e) => !knownEntityNames.has(e)).length;
  return trulyNew / names.length;
}

// ── Temporal novelty ──────────────────────────────────────────────────────

/**
 * Temporal novelty via exponential saturation: 1 - exp(-hours/24).
 *
 * precondition:  hoursSinceSimilar >= 0 or null.
 * postcondition: result ∈ [0, 1]. Returns 0.8 when hours is null (unknown = likely novel).
 *
 * source: cortex@ed33435 mcp_server/core/predictive_coding_flat.py:53-59
 *   Formula: 1 - exp(-hours / 24.0); time constant = 24 hours
 */
export function computeTemporalNovelty(
  hoursSinceSimilar: number | null,
): number {
  if (hoursSinceSimilar === null) return 0.8;
  if (hoursSinceSimilar <= 0) return 0.0;
  return Math.min(1.0, 1.0 - Math.exp(-hoursSinceSimilar / 24.0)); // source: cortex@ed33435 mcp_server/core/predictive_coding_flat.py:59 — time constant 24h
}

// ── Structural novelty ────────────────────────────────────────────────────

/**
 * Extract structural shape features from content.
 *
 * source: cortex@ed33435 mcp_server/core/predictive_coding_flat.py:65-86
 */
function structuralFeatures(content: string): Record<string, number> {
  const n = Math.max(content.length, 1);
  let lengthBucket: number;
  if (n < 100) lengthBucket = 0;
  else if (n < 500) lengthBucket = 1;
  else if (n < 2000) lengthBucket = 2;
  else if (n < 8000) lengthBucket = 3;
  else lengthBucket = 4;

  return {
    code_blocks: (content.match(CODE_BLOCK_RE) ?? []).length,
    file_refs: (content.match(FILE_PATH_RE) ?? []).length,
    urls: (content.match(URL_RE) ?? []).length,
    headings: (content.match(HEADING_RE) ?? []).length,
    list_items: (content.match(LIST_RE) ?? []).length,
    length_bucket: lengthBucket,
  };
}

/**
 * Structural novelty by comparing document shape to recent memories.
 *
 * precondition:  recentContents is an array of strings.
 * postcondition: result ∈ [0, 1]. Returns 0.7 when recentContents is empty.
 *
 * source: cortex@ed33435 mcp_server/core/predictive_coding_flat.py:89-101
 */
export function computeStructuralNovelty(
  content: string,
  recentContents: string[],
): number {
  if (recentContents.length === 0) return 0.7;
  const candidate = structuralFeatures(content);
  const keys = Object.keys(candidate);
  let bestMatch = 0.0;
  for (const existingContent of recentContents) {
    const existing = structuralFeatures(existingContent);
    const matches = keys.filter((k) => candidate[k] === existing[k]).length;
    const similarity = matches / keys.length;
    bestMatch = Math.max(bestMatch, similarity);
  }
  return Math.max(0.0, Math.min(1.0, 1.0 - bestMatch));
}

// ── Combined novelty ──────────────────────────────────────────────────────

/**
 * Combined novelty score from the 4-signal gate. Returns [0, 1].
 *
 * precondition:  all inputs ∈ [0, 1].
 * postcondition: result ∈ [0, 1].
 *
 * source: cortex@ed33435 mcp_server/core/predictive_coding_flat.py:107-119
 *   Weights: embedding=0.40, entity=0.25, temporal=0.20, structural=0.15
 */
export function computeNoveltyScore(
  embeddingNovelty: number,
  entityNovelty: number,
  temporalNovelty: number,
  structuralNovelty: number,
): number {
  return (
    0.40 * embeddingNovelty  // source: cortex@ed33435 mcp_server/core/predictive_coding_flat.py:115
    + 0.25 * entityNovelty   // source: cortex@ed33435 mcp_server/core/predictive_coding_flat.py:116
    + 0.20 * temporalNovelty // source: cortex@ed33435 mcp_server/core/predictive_coding_flat.py:117
    + 0.15 * structuralNovelty // source: cortex@ed33435 mcp_server/core/predictive_coding_flat.py:118
  );
}

// ── Signal description ────────────────────────────────────────────────────

/**
 * Structured dict of all signal values for observability.
 *
 * postcondition: returned object has all five signal keys, values rounded to 4dp.
 * source: cortex@ed33435 mcp_server/core/predictive_coding_flat.py:122-136
 */
export function describeSignals(
  embedding: number,
  entity: number,
  temporal: number,
  structural: number,
  combined: number,
): Record<string, number> {
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return {
    embedding_novelty: r(embedding),
    entity_novelty: r(entity),
    temporal_novelty: r(temporal),
    structural_novelty: r(structural),
    combined_novelty: r(combined),
  };
}
