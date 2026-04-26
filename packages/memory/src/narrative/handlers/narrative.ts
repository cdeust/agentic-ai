/**
 * Handler: narrative — generate project story from memory.
 *
 * Composition root: wires narrative-builder to an injectable memory
 * store port and returns structured narrative results.
 *
 * Direct port of mcp_server/handlers/narrative.py.
 *
 * Infrastructure-independence: the Python handler reached directly into
 * MemoryStore.  Here the store is injected as a MemoryPort so the handler
 * stays in the application layer and tests can provide a stub.
 *
 * // source: Martin, R. C. (2017). Clean Architecture, Ch. 22 — the
 *            composition root is the only layer that wires core +
 *            infrastructure together (Dependency Inversion Principle).
 */

import { generateBriefSummary, generateNarrative } from "../narrative-builder.js";
import type { MemoryRecord, NarrativeRequest, NarrativeResponse } from "../types.js";
import { NarrativeRequestSchema } from "../types.js";

// ── Memory port (DIP-compliant) ────────────────────────────────────────────

/**
 * Port interface the handler depends on.
 * Infrastructure adapters (MemoryStore, test stub) implement this.
 *
 * Method signatures mirror the Python MemoryStore methods called in
 * mcp_server/handlers/narrative.py.
 */
export interface MemoryPort {
  getMemoriesForDirectory(directory: string, minHeat: number): MemoryRecord[];
  getMemoriesForDomain(domain: string, minHeat: number, limit: number): MemoryRecord[];
  getHotMemories(minHeat: number, limit: number): MemoryRecord[];
}

// ── Handler ────────────────────────────────────────────────────────────────

/**
 * Generate project narrative from memories.
 * Mirrors mcp_server/handlers/narrative.handler.
 *
 * // port-pending: async LLM-driven prose-polish refinement pass.
 * // The structural narrative (arc, decisions, events, entities, topics)
 * // is fully ported and synchronous.  An LLM rewrite pass over the
 * // assembled prose can be added as a post-pass without touching this
 * // function.
 */
export function narrativeHandler(
  store: MemoryPort,
  rawArgs: unknown
): NarrativeResponse {
  const args: NarrativeRequest = NarrativeRequestSchema.parse(rawArgs ?? {});
  const { directory = "", domain = "", brief } = args;

  let memories: MemoryRecord[];

  // source: mcp_server/handlers/narrative.py — fetch strategy
  if (directory) {
    memories = store.getMemoriesForDirectory(directory, 0.0);
  } else if (domain) {
    memories = store.getMemoriesForDomain(domain, 0.0, 200);
  } else {
    memories = store.getHotMemories(0.1, 200);
  }

  if (brief) {
    const summary = generateBriefSummary(memories);
    return {
      summary,
      decisions: [],
      events: [],
      entities: [],
      topics: [],
      memory_count: memories.length,
    };
  }

  return generateNarrative(memories, directory || domain);
}
