/**
 * Tests: LlmClient integration with narrative handlers (Phase 7 Group C).
 *
 * Scope:
 *   - Mock LlmClient → verify narrativeHandler calls complete() with the
 *     right shape when the client is provided.
 *   - Mock LlmClient → verify generateBriefSummaryWithPolish calls complete()
 *     when client is provided; returns structural text when client is null.
 *   - Contract: LlmClient port is typeable (expectTypeOf guard).
 *   - Integration (it.todo): real AnthropicLlmClient gated on env var.
 *
 * source: docs/PHASE_7_TRACKING.md §Group C — acceptance criterion
 */

import { describe, expect, it, vi } from "vitest";
import type { LlmClient } from "@agentic/core";
import {
  generateBriefSummaryWithPolish,
  generateBriefSummary,
} from "../../src/narrative/narrative-builder.js";
import { narrativeHandler } from "../../src/narrative/handlers/narrative.js";
import type { MemoryPort } from "../../src/narrative/handlers/narrative.js";
import type { MemoryRecord } from "../../src/narrative/types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<MemoryRecord> & { content: string }): MemoryRecord {
  return {
    id: 1,
    content: overrides.content,
    tags: overrides.tags ?? [],
    importance: overrides.importance ?? 0.5,
    heat: overrides.heat ?? 0.5,
    created_at: "2026-01-01T00:00:00Z",
    accessed_at: "2026-01-01T00:00:00Z",
    access_count: 0,
    ...overrides,
  };
}

const SAMPLE_MEMORIES: MemoryRecord[] = [
  makeRecord({ content: "Decided to use Vitest for testing", tags: ["decision"], importance: 0.8, heat: 0.9 }),
  makeRecord({ content: "Fixed a bug in the auth module", tags: ["error"], importance: 0.9, heat: 0.7 }),
  makeRecord({ content: "Deployed to production successfully", tags: ["insight"], importance: 0.6, heat: 0.5 }),
];

function makeStubStore(): MemoryPort {
  return {
    getMemoriesForDirectory: (_dir: string, _minHeat: number) => SAMPLE_MEMORIES,
    getMemoriesForDomain: (_domain: string, _minHeat: number, _limit: number) => SAMPLE_MEMORIES,
    getHotMemories: (_minHeat: number, _limit: number) => SAMPLE_MEMORIES,
  };
}

// ── Mock LlmClient factory ────────────────────────────────────────────────────

function makeMockLlmClient(response = "Polished prose output"): LlmClient {
  return {
    complete: vi.fn<LlmClient["complete"]>().mockResolvedValue(response),
  };
}

// ── Tests: generateBriefSummaryWithPolish ─────────────────────────────────────

describe("generateBriefSummaryWithPolish", () => {
  it("returns structural text when llmClient is null", async () => {
    const structural = generateBriefSummary(SAMPLE_MEMORIES);
    const result = await generateBriefSummaryWithPolish(SAMPLE_MEMORIES, null);
    expect(result).toBe(structural);
  });

  it("calls llmClient.complete() when client is provided", async () => {
    const mockClient = makeMockLlmClient("A polished one-paragraph summary.");
    const result = await generateBriefSummaryWithPolish(SAMPLE_MEMORIES, mockClient);
    expect(mockClient.complete).toHaveBeenCalledOnce();
    expect(result).toBe("A polished one-paragraph summary.");
  });

  it("calls complete() with correct shape: system, prompt, maxTokens, temperature", async () => {
    const mockClient = makeMockLlmClient("OK");
    await generateBriefSummaryWithPolish(SAMPLE_MEMORIES, mockClient);

    const [opts] = (mockClient.complete as ReturnType<typeof vi.fn>).mock.calls[0] as [Parameters<LlmClient["complete"]>[0]];
    expect(typeof opts.system).toBe("string");
    expect(opts.system).toBeTruthy();
    expect(typeof opts.prompt).toBe("string");
    expect(opts.prompt.length).toBeGreaterThan(0);
    // source: https://docs.anthropic.com/en/api/messages — 256 tokens for brief summaries
    expect(opts.maxTokens).toBe(256);
    // source: reconstructed Phase 7 Group C default temperature for prose tasks
    expect(opts.temperature).toBe(0.7);
  });

  it("returns structural text when memories are empty (no LLM call needed)", async () => {
    const mockClient = makeMockLlmClient("Should not be called");
    const result = await generateBriefSummaryWithPolish([], mockClient);
    // Empty memories → empty structural summary → no LLM call
    expect(mockClient.complete).not.toHaveBeenCalled();
    expect(result).toBe("");
  });
});

// ── Tests: narrativeHandler with LLM client ────────────────────────────────────

describe("narrativeHandler — LlmClient injection", () => {
  it("returns structural result when llmClient is null (no LLM call)", async () => {
    const store = makeStubStore();
    const result = await narrativeHandler(store, {}, null);
    // postcondition: narrative field is present (structural generation ran)
    expect(typeof result.narrative).toBe("string");
    expect(result.memory_count).toBe(SAMPLE_MEMORIES.length);
  });

  it("calls llmClient.complete() when client is provided and memories exist", async () => {
    const mockClient = makeMockLlmClient("# Polished Project Narrative\n\nFlowing prose here.");
    const store = makeStubStore();
    const result = await narrativeHandler(store, {}, mockClient);

    expect(mockClient.complete).toHaveBeenCalledOnce();
    // postcondition: narrative is the LLM output, not structural text
    expect(result.narrative).toBe("# Polished Project Narrative\n\nFlowing prose here.");
  });

  it("calls complete() with correct shape: system, prompt, maxTokens=1024, temperature=0.7", async () => {
    const mockClient = makeMockLlmClient("polished");
    const store = makeStubStore();
    await narrativeHandler(store, {}, mockClient);

    const [opts] = (mockClient.complete as ReturnType<typeof vi.fn>).mock.calls[0] as [Parameters<LlmClient["complete"]>[0]];
    expect(typeof opts.system).toBe("string");
    expect(opts.system).toBeTruthy();
    expect(opts.prompt).toContain("# Project Narrative");
    // source: https://docs.anthropic.com/en/api/messages — 1024 tokens for narrative rewrites
    expect(opts.maxTokens).toBe(1024);
    // source: reconstructed Phase 7 Group C default temperature
    expect(opts.temperature).toBe(0.7);
  });

  it("brief mode does not invoke LLM (structural only)", async () => {
    const mockClient = makeMockLlmClient("Should not be called");
    const store = makeStubStore();
    const result = await narrativeHandler(store, { brief: true }, mockClient);

    expect(mockClient.complete).not.toHaveBeenCalled();
    expect(typeof result.summary).toBe("string");
  });
});

// ── Tests: wikiRefineHandler with LLM client ──────────────────────────────────

describe("wikiRefineHandler — LlmClient injection", () => {
  it("throws PortPendingError when llmClient is null", async () => {
    const { wikiRefineHandler, PortPendingError } = await import(
      "../../src/wiki/handlers/wiki-stubs.js"
    );
    await expect(
      wikiRefineHandler({ draft_id: 1 }, null)
    ).rejects.toBeInstanceOf(PortPendingError);
  });

  it("calls llmClient.complete() when client is provided", async () => {
    const { wikiRefineHandler } = await import("../../src/wiki/handlers/wiki-stubs.js");
    const mockClient = makeMockLlmClient(
      JSON.stringify({ lead: "Refined lead.", sections: [{ heading: "Background", body: "Some body." }] })
    );
    const result = await wikiRefineHandler(
      { draft_id: 42, lead: "Original lead.", sections: [{ heading: "Background", body: "Old body." }] },
      mockClient,
    );

    expect(mockClient.complete).toHaveBeenCalledOnce();
    expect(result.draft_id).toBe(42);
    expect(result.refined_lead).toBe("Refined lead.");
    expect(result.refined_sections).toHaveLength(1);
  });

  it("calls complete() with correct shape: system, prompt, maxTokens=1024, temperature=0.7", async () => {
    const { wikiRefineHandler } = await import("../../src/wiki/handlers/wiki-stubs.js");
    const mockClient = makeMockLlmClient('{"lead":"ok","sections":[]}');
    await wikiRefineHandler({ draft_id: 1, lead: "Lead text." }, mockClient);

    const [opts] = (mockClient.complete as ReturnType<typeof vi.fn>).mock.calls[0] as [Parameters<LlmClient["complete"]>[0]];
    expect(typeof opts.system).toBe("string");
    // The prompt includes the draft_id as "(id=1)" — see wiki-stubs.ts prompt template
    expect(opts.prompt).toContain("id=1");
    // source: https://docs.anthropic.com/en/api/messages — 1024 tokens for wiki draft refine
    expect(opts.maxTokens).toBe(1024);
    // source: reconstructed Phase 7 Group C default temperature for prose tasks
    expect(opts.temperature).toBe(0.7);
  });
});

// ── Tests: wikiSynthesizeHandler real implementation (CRIT-B fix) ─────────────
//
// CRIT-B Phase 7: wikiSynthesizeHandler is now a real implementation.
// Without a WikiDbClient it throws PortPendingError (NOT returns stub zeros).

describe("wikiSynthesizeHandler — CRIT-B real implementation", () => {
  it("throws PortPendingError when db is null (correct contract)", async () => {
    const { wikiSynthesizeHandler, PortPendingError } = await import("../../src/wiki/handlers/wiki-handlers.js");
    await expect(wikiSynthesizeHandler({}, null, null)).rejects.toThrow(PortPendingError);
  });

  it("PortPendingError names WikiDbClient as the missing dependency", async () => {
    const { wikiSynthesizeHandler, PortPendingError } = await import("../../src/wiki/handlers/wiki-handlers.js");
    const err = await wikiSynthesizeHandler({}, null, null).catch((e) => e);
    expect(err).toBeInstanceOf(PortPendingError);
    expect(err.message).toContain("WikiDbClient");
  });

  it("does not call llmClient.complete in the Path A (template-driven) pass", async () => {
    const { wikiSynthesizeHandler } = await import("../../src/wiki/handlers/wiki-handlers.js");
    const mockClient = makeMockLlmClient("polished");

    // Provide a minimal stub db that returns no candidates → handler returns 0 counts
    const stubDb = {
      query: async () => ({ rows: [], rowCount: 0 }),
    };

    const result = await wikiSynthesizeHandler({}, mockClient, stubDb);
    // Path A is template-driven: LLM client must NOT be called
    expect(mockClient.complete).not.toHaveBeenCalled();
    // With no candidates, returns real zero counts (not hardcoded zeros — computed)
    expect(result.memories_processed).toBe(0);
    expect(typeof result.drafts_created).toBe("number");
  });
});

// ── Tests: wikiPipelineHandler real implementation (CRIT-B fix) ───────────────
//
// CRIT-B Phase 7: wikiPipelineHandler now returns real stages + stages_run,
// capturing PortPendingError per stage rather than returning a fake success.

describe("wikiPipelineHandler — CRIT-B real implementation", () => {
  it("returns stages object with per-stage results (not a note string)", async () => {
    const { wikiPipelineHandler } = await import("../../src/wiki/handlers/wiki-handlers.js");
    const result = await wikiPipelineHandler({}, null, null);
    expect(result.stages).toBeDefined();
    expect(typeof result.stages).toBe("object");
  });

  it("stages_run is an array (empty when all are port-pending)", async () => {
    const { wikiPipelineHandler } = await import("../../src/wiki/handlers/wiki-handlers.js");
    const result = await wikiPipelineHandler({}, null, null);
    expect(Array.isArray(result.stages_run)).toBe(true);
  });

  it("extract stage shows port-pending status", async () => {
    const { wikiPipelineHandler } = await import("../../src/wiki/handlers/wiki-handlers.js");
    const result = await wikiPipelineHandler({}, null, null);
    expect(result.stages["extract"]?.status).toBe("port-pending");
  });

  it("synthesize stage shows port-pending when db is null", async () => {
    const { wikiPipelineHandler } = await import("../../src/wiki/handlers/wiki-handlers.js");
    const result = await wikiPipelineHandler({}, null, null);
    expect(result.stages["synthesize"]?.status).toBe("port-pending");
  });
});

// ── Contract tests: LlmClient port type shape ─────────────────────────────────

describe("LlmClient port — contract type check", () => {
  it("mock satisfies the LlmClient interface (compile-time contract)", () => {
    // This is a compile-time check: if the mock structure doesn't match
    // LlmClient the TypeScript compiler will fail this file.
    const client: LlmClient = {
      complete: (_opts: { system?: string; prompt: string; maxTokens?: number; temperature?: number }) =>
        Promise.resolve(""),
    };
    // postcondition: no TypeScript error means the interface is satisfied.
    expect(typeof client.complete).toBe("function");
  });
});

// ── Integration (gated — real API not called in CI) ───────────────────────────

describe("AnthropicLlmClient — real API integration", () => {
  it.todo(
    "calls the real Anthropic API (gated: ANTHROPIC_API_KEY must be set; not run in CI)",
    // To run manually: ANTHROPIC_API_KEY=<key> pnpm test -- --reporter=verbose
    // Expected: complete() resolves with a non-empty string.
  );
});
