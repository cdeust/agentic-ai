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
 * LLM prose-polish: when an LlmClient is provided, the assembled prose
 * text is passed through a single-turn rewrite pass that converts the
 * structured bullet output into flowing narrative sentences.  When no
 * LlmClient is available the handler returns the structural text as-is
 * (same behaviour as before Phase 7 Group C).
 *
 * // source: Martin, R. C. (2017). Clean Architecture, Ch. 22 — the
 *            composition root is the only layer that wires core +
 *            infrastructure together (Dependency Inversion Principle).
 */

import type { LlmClient } from "@agentic/core";
import { generateBriefSummary, generateNarrative } from "../narrative-builder.js";
import type { MemoryRecord, NarrativeRequest, NarrativeResponse } from "../types.js";
import { NarrativeRequestSchema } from "../types.js";

// ── Named constants ────────────────────────────────────────────────────────

// source: mcp_server/handlers/narrative.py:87 — limit=200 for domain/hot recall
const MEMORY_FETCH_LIMIT = 200;

// source: mcp_server/handlers/narrative.py:89 — min_heat=0.1 for hot recall
const HOT_MEMORY_MIN_HEAT = 0.1;

// source: https://docs.anthropic.com/en/api/messages — 1024 tokens sufficient for prose rewrite
const NARRATIVE_POLISH_MAX_TOKENS = 1024;

// source: https://docs.anthropic.com/en/api/messages — temperature 0.7 for creative prose
// Reconstructed: Cortex f2b9f99 has no canonical polish temperature.
const NARRATIVE_POLISH_TEMPERATURE = 0.7;

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

// ── Prose-polish prompts ───────────────────────────────────────────────────

/**
 * System prompt for the prose-polish LLM pass.
 *
 * The structural narrative produced by generateNarrative() is well-formed
 * but reads as a bulleted report.  This pass rewrites the narrative section
 * into flowing prose while preserving every factual claim.
 *
 * source: mcp_server/core/context_assembly/active_retrieval.py:53-65
 *         (the llm_fn pattern — structured data in, fluent prose out;
 *          the concrete prompt below is reconstructed for the narrative
 *          use-case since Cortex f2b9f99 has no narrative-polish prompt file)
 */
const PROSE_POLISH_SYSTEM = `You are a technical writing assistant. You receive a structured project narrative in Markdown and rewrite it as flowing, readable prose. Preserve every factual claim, decision, and entity exactly. Do not add new information. Return only the rewritten text with the same section headings.`;

/**
 * Build the user prompt for the prose-polish pass.
 *
 * source: mcp_server/core/context_assembly/active_retrieval.py:53-65
 *         (reconstructed — see PROSE_POLISH_SYSTEM note above)
 */
function buildPolishPrompt(structuredNarrative: string): string {
  return `Rewrite the following structured project narrative as flowing prose. Keep all section headings. Do not add information not present in the input.\n\n${structuredNarrative}`;
}

// ── Handler ────────────────────────────────────────────────────────────────

/**
 * Generate project narrative from memories.
 * Mirrors mcp_server/handlers/narrative.handler.
 *
 * Precondition:  store is a valid MemoryPort; rawArgs passes NarrativeRequestSchema.
 * Postcondition: returns a NarrativeResponse; if llmClient is provided and the
 *                response is not brief mode, the narrative field is the LLM-polished
 *                prose; otherwise it is the structural text from generateNarrative().
 */
export async function narrativeHandler(
  store: MemoryPort,
  rawArgs: unknown,
  llmClient: LlmClient | null = null
): Promise<NarrativeResponse> {
  const args: NarrativeRequest = NarrativeRequestSchema.parse(rawArgs ?? {});
  const { directory = "", domain = "", brief } = args;

  let memories: MemoryRecord[];

  // source: mcp_server/handlers/narrative.py — fetch strategy
  if (directory) {
    memories = store.getMemoriesForDirectory(directory, 0.0);
  } else if (domain) {
    memories = store.getMemoriesForDomain(domain, 0.0, MEMORY_FETCH_LIMIT);
  } else {
    memories = store.getHotMemories(HOT_MEMORY_MIN_HEAT, MEMORY_FETCH_LIMIT);
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

  const result = generateNarrative(memories, directory || domain);

  // LLM prose-polish post-pass (optional — degrades to structural text when absent)
  const structuralNarrative = result.narrative;
  if (llmClient !== null && typeof structuralNarrative === "string" && structuralNarrative.length > 0) {
    const polished = await llmClient.complete({
      system: PROSE_POLISH_SYSTEM,
      prompt: buildPolishPrompt(structuralNarrative),
      maxTokens: NARRATIVE_POLISH_MAX_TOKENS,
      temperature: NARRATIVE_POLISH_TEMPERATURE,
    });
    return { ...result, narrative: polished };
  }

  return result;
}
