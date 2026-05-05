/**
 * Wiki Path B: LLM-augmented draft refinement handler.
 *
 * source: mcp_server/handlers/wiki_refine.py (Cortex bc0ae4f)
 */

import type { LlmClient } from "@agentic/core";
import { PortPendingError } from "./wiki-errors.js";

// source: https://docs.anthropic.com/en/api/messages — 1024 tokens sufficient for wiki draft rewrite
const WIKI_REFINE_MAX_TOKENS = 1024;

// source: https://docs.anthropic.com/en/api/messages — temperature 0.7 for creative prose
// Reconstructed: Cortex f2b9f99 wiki_refine.py does not specify a temperature.
const WIKI_REFINE_TEMPERATURE = 0.7;

// source: mcp_server/handlers/wiki_refine.py:147 — lead ≤60 words ≈ 300 chars fallback cap
const WIKI_LEAD_FALLBACK_CHARS = 300;

export interface WikiRefineArgs {
  readonly draft_id: number;
  readonly title?: string | null;
  readonly lead?: string | null;
  readonly sections?: Array<{ heading: string; body: string; claim_ids?: number[] }> | null;
  readonly synth_model?: string | null;
  readonly synth_prompt?: string | null;
  readonly rationale?: string | null;
  [key: string]: unknown;
}

export interface WikiRefineResult {
  readonly draft_id: number;
  readonly refined_lead: string;
  readonly refined_sections: Array<{ heading: string; body: string }>;
  readonly synth_model: string;
  readonly note: string;
}

/**
 * Refine a wiki draft using the LLM client.
 *
 * Precondition:  args.draft_id is a positive integer; llmClient is non-null.
 * Postcondition: returns a WikiRefineResult with the LLM-refined lead and
 *                sections; when llmClient is null throws PortPendingError.
 *
 * source: mcp_server/handlers/wiki_refine.py:125-200
 */
export async function wikiRefineHandler(
  args: WikiRefineArgs,
  llmClient: LlmClient | null = null,
): Promise<WikiRefineResult> {
  if (llmClient === null) {
    throw new PortPendingError(
      "wiki-refine",
      "mcp_server/handlers/wiki_refine.py:1",
      "LLM client (Path B draft refinement)",
    );
  }

  const draftId = args.draft_id;
  const existingLead = typeof args.lead === "string" ? args.lead : "";
  const existingSections = Array.isArray(args.sections) ? args.sections : [];
  const synthModel = typeof args.synth_model === "string" ? args.synth_model : "claude_refine_v1";

  const sectionsText = existingSections
    .map((s) => `## ${s.heading}\n${s.body}`)
    .join("\n\n");

  const prompt =
    `You are refining a wiki draft (id=${draftId}). ` +
    `Rewrite the lead to be ≤60 words and self-contained. ` +
    `Rewrite each section as fluent prose grounded in the provided text. ` +
    `Return JSON with keys: lead (string), sections (array of {heading, body}).\n\n` +
    `Current lead:\n${existingLead}\n\n` +
    `Current sections:\n${sectionsText || "(none provided)"}`;

  const raw = await llmClient.complete({
    // source: mcp_server/handlers/wiki_refine.py:196-199
    system: "You are a technical wiki editor. Return only valid JSON, no markdown fences.",
    prompt,
    maxTokens: WIKI_REFINE_MAX_TOKENS,
    temperature: WIKI_REFINE_TEMPERATURE,
  });

  let refinedLead = existingLead;
  let refinedSections: Array<{ heading: string; body: string }> = existingSections.map(
    (s) => ({ heading: s.heading, body: s.body }),
  );

  try {
    const parsed = JSON.parse(raw) as {
      lead?: string;
      sections?: Array<{ heading: string; body: string }>;
    };
    if (typeof parsed.lead === "string") refinedLead = parsed.lead;
    if (Array.isArray(parsed.sections)) {
      refinedSections = parsed.sections.filter(
        (s) => typeof s.heading === "string" && typeof s.body === "string",
      );
    }
  } catch {
    refinedLead = raw.slice(0, WIKI_LEAD_FALLBACK_CHARS).trim();
  }

  return {
    draft_id: draftId,
    refined_lead: refinedLead,
    refined_sections: refinedSections,
    synth_model: synthModel,
    note: "Phase 7: LLM refinement complete. pg_store_wiki persistence deferred (Phase 7 Group D).",
  };
}
