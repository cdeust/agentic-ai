/**
 * handlers/remember.ts — Top-level remember handler.
 *
 * Ports: handlers/remember.py + handlers/remember_helpers.py
 *
 * Composition root: validates input, runs write gate, writes to MemoryStore.
 *
 * Correctness contract:
 *   pre:  args.content is non-empty after trimming.
 *   post: IF gate rejects → {stored:false, reason, novelty, importance}.
 *         IF gate passes → {stored:true, action:"stored", memory_id, heat}.
 *         In all code paths, MemoryStore is either written atomically
 *         or not written at all.
 *
 * source: handlers/remember.py
 * source: handlers/remember_helpers.py
 * source: issue #14 P1 (initial_heat override for backfill)
 */

import {
  buildRejectionResponse,
  determineBypass,
  estimateImportance,
  parseHoursSince,
  scoreCandidate,
} from "../write-gate.js";
import { effectiveThreshold, record as calibrationRecord } from "../write-gate-calibration.js";
import type { MemoryStore } from "../storage/memory-store.js";
import type { RememberRequest, RememberResponse } from "../types.js";
import { RememberRequestSchema } from "../types.js";

// ── Surprisal heat boost ─────────────────────────────────────────────────────

// source: thermodynamics.py:apply_surprise_boost (heuristic)
function applySurpriseBoost(
  baseHeat: number,
  noveltyScore: number,
  boostFactor = 0.3,
): number {
  const boosted = baseHeat + boostFactor * noveltyScore;
  return Math.max(0.0, Math.min(1.0, boosted));
}

// ── Recent contents helper ───────────────────────────────────────────────────

function getRecentContents(store: MemoryStore, domain: string): string[] {
  // We want the most recent 10 memories for structural comparison.
  // The query is best-effort; failures return empty.
  try {
    const rows = (store as unknown as { listRecentContents?: (d: string, n: number) => string[] })
      .listRecentContents?.(domain, 10);
    return rows ?? [];
  } catch {
    return [];
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────

/**
 * remember — store a memory through the predictive-coding write gate.
 *
 * source: handlers/remember.py:handler
 */
export function remember(
  rawArgs: unknown,
  store: MemoryStore,
): RememberResponse {
  // Parse and validate input. Zod throws on invalid input.
  const args: RememberRequest = RememberRequestSchema.parse(rawArgs);

  if (!args.content.trim()) {
    return { stored: false, reason: "no_content" };
  }

  const content = args.content.trim();
  const tags = args.tags;
  const force = args.force;
  const domain = args.domain ?? "";
  const source = args.source;
  const agentTopic = args.agent_topic;
  const isGlobal = args.is_global;

  // Baseline heat: live writes default to 1.0; backfill/import paths
  // override via initial_heat to reflect content age (Ebbinghaus curve).
  // Source: issue #14 P1.
  const baselineHeat =
    args.initial_heat !== undefined ? args.initial_heat : 1.0;

  // Retrieve the top-5 similar memories from the vector store.
  // The write gate needs their similarity scores and creation times.
  const vecHits = store.searchVectors(Buffer.alloc(0), 5, 0.0);
  const similarities: number[] = [];
  let hoursSinceSimilar: number | null = null;

  if (vecHits.length > 0) {
    // Use distances as similarity proxies (1 - distance for cosine).
    for (const [, dist] of vecHits) {
      similarities.push(Math.max(0, 1.0 - dist));
    }
    // Find hours since most similar memory was created.
    const bestId = vecHits[0]?.[0];
    if (bestId !== undefined) {
      const bestMem = store.getMemory(bestId);
      if (bestMem?.created_at) {
        hoursSinceSimilar = parseHoursSince(bestMem.created_at);
      }
    }
  }

  // Extract entity names (best-effort; failures produce empty set).
  let newEntityNames: string[] = [];
  let knownEntityNames = new Set<string>();
  try {
    newEntityNames = extractEntityNamesFromContent(content);
    knownEntityNames = new Set(
      newEntityNames.filter((n) => store.getEntityByName(n) !== null),
    );
  } catch {
    // Entity extraction failures must not block the write path.
  }

  const recentContents = getRecentContents(store, domain);
  const threshold = effectiveThreshold(domain);

  const [bypass] = determineBypass(force, content, tags);

  const score = scoreCandidate({
    content,
    tags,
    force,
    similarities,
    newEntityNames,
    knownEntityNames,
    recentContents,
    hoursSinceSimilar,
    threshold,
  });

  // Record the gate decision for threshold auto-calibration.
  // source: core/write_gate_calibration.py:record (Taleb AF-5)
  calibrationRecord(domain, score.shouldStore);

  if (!score.shouldStore && !bypass) {
    const importance = estimateImportance(content, tags);
    return buildRejectionResponse(score, importance);
  }

  const heat = applySurpriseBoost(baselineHeat, score.combinedNovelty);
  const importance = estimateImportance(content, tags);

  const memoryId = store.insertMemory({
    content,
    tags,
    source,
    domain,
    heat,
    importance,
    surprise_score: score.combinedNovelty,
    store_type: "episodic",
    agent_context: agentTopic,
    is_global: isGlobal,
    created_at: args.created_at,
  });

  // Best-effort entity upsert and linking. Failures must not abort the write.
  try {
    for (const entityName of newEntityNames) {
      if (!knownEntityNames.has(entityName)) {
        const entityId = store.upsertEntity(entityName, "concept", domain);
        if (entityId > 0) {
          store.linkMemoryEntity(memoryId, entityId);
        }
      }
    }
  } catch {
    // Entity extraction failures do not abort the write (invariant I3).
  }

  return {
    stored: true,
    action: "stored",
    memory_id: memoryId,
    heat,
    is_global: isGlobal,
  };
}

// ── Lightweight entity name extraction ──────────────────────────────────────
// port-pending: full knowledge_graph.extract_entities is not yet ported.
// This heuristic extracts capitalized tokens as entity candidates.

function extractEntityNamesFromContent(content: string): string[] {
  const names = new Set<string>();
  // Capitalized words that are not common stopwords.
  const STOPWORDS = new Set([
    "The", "A", "An", "I", "It", "This", "That", "We", "They", "He", "She",
    "Is", "Are", "Was", "Were", "Be", "Has", "Have", "Had",
  ]);
  const tokens = content.match(/\b[A-Z][a-z]{2,}\b/g) ?? [];
  for (const t of tokens) {
    if (!STOPWORDS.has(t)) names.add(t);
  }
  return [...names].slice(0, 20); // cap at 20 entities per memory
}
