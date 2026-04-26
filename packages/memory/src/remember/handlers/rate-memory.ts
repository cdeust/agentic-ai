/**
 * handlers/rate-memory.ts — Record a usefulness verdict for a memory.
 *
 * Ports: handlers/rate_memory.py (166 LOC)
 *
 * Increments useful_count when helpful, then recomputes metamemory
 * confidence as useful_count / access_count.
 * High-confidence memories resist decay and rank higher in future recalls.
 *
 * Correctness contract:
 *   pre:  memoryId refers to an existing row; useful is a bool.
 *   post: access_count = prev + 1.
 *         useful_count = prev + 1 iff useful = true.
 *         confidence = compute_confidence(access_count, useful_count).
 *         All three fields written in a single UPDATE (atomic).
 *
 * References:
 *   Nelson & Narens (1990): metamemory framework.
 *
 * source: handlers/rate_memory.py
 */

import type { MemoryStore } from "../storage/memory-store.js";

export interface RateMemoryRequest {
  memory_id: number;
  useful: boolean;
  query?: string;
}

export interface RateMemoryResponse {
  rated: boolean;
  memory_id?: number;
  useful?: boolean;
  access_count?: number;
  useful_count?: number;
  confidence?: number;
  content_preview?: string;
  reason?: string;
}

/**
 * Compute metamemory confidence from access and useful counts.
 *
 * precondition:  accessCount > 0.
 * postcondition: returned value in [0, 1]; returns null if accessCount < 3
 *   (insufficient data — caller uses existing confidence).
 *
 * Formula: Wilson score interval midpoint for a binomial proportion.
 * source: thermodynamics.py:compute_metamemory_confidence
 */
function computeMetamemoryConfidence(
  accessCount: number,
  usefulCount: number,
): number | null {
  if (accessCount < 3) return null;
  // Wilson score lower bound (z=1.0 for ~68% CI).
  const z = 1.0;
  const p = usefulCount / accessCount;
  const n = accessCount;
  const numerator =
    p + z ** 2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z ** 2 / (4 * n)) / n);
  const denominator = 1 + z ** 2 / n;
  return Math.max(0.0, Math.min(1.0, numerator / denominator));
}

/**
 * rateMemory — record usefulness feedback and update metamemory.
 *
 * source: handlers/rate_memory.py:handler
 */
export function rateMemory(
  args: RateMemoryRequest,
  store: MemoryStore,
): RateMemoryResponse {
  const memoryId = args.memory_id;
  const useful = args.useful;

  if (!memoryId || memoryId < 1) {
    return { rated: false, reason: "no_memory_id" };
  }

  const mem = store.getMemory(memoryId);
  if (mem === null) {
    return { rated: false, reason: "not_found", memory_id: memoryId };
  }

  const accessCount = (mem.access_count ?? 0) + 1;
  const usefulCount = (mem.useful_count ?? 0) + (useful ? 1 : 0);

  // Recompute confidence per Nelson & Narens 1990.
  const newConf = computeMetamemoryConfidence(accessCount, usefulCount);
  const confidence =
    newConf !== null ? newConf : (mem.confidence ?? 1.0);

  store.updateMemoryMetamemory(memoryId, accessCount, usefulCount, confidence);

  return {
    rated: true,
    memory_id: memoryId,
    useful,
    access_count: accessCount,
    useful_count: usefulCount,
    confidence: Math.round(confidence * 10000) / 10000,
    content_preview: mem.content.slice(0, 80),
  };
}
