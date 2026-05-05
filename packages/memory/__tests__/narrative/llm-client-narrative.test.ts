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

// ── @anthropic-ai/sdk mock (top-level, hoisted) ───────────────────────────────
//
// Hoisted so vi.mock() below can capture it before the real SDK import. Tests
// program create.mockResolvedValueOnce(...) per-case to drive AnthropicLlmClient
// against a deterministic SDK fake.
const anthropicMock = vi.hoisted(() => {
  const create = vi.fn();
  const Anthropic = vi.fn(function (this: { messages: { create: typeof create } }) {
    this.messages = { create };
  });
  return { Anthropic, create };
});

vi.mock("@anthropic-ai/sdk", () => ({ default: anthropicMock.Anthropic }));

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
  it("throws WikiUnavailableError when llmClient is null", async () => {
    const { wikiRefineHandler, WikiUnavailableError } = await import(
      "../../src/wiki/handlers/wiki-stubs.js"
    );
    await expect(
      wikiRefineHandler({ draft_id: 1 }, null)
    ).rejects.toBeInstanceOf(WikiUnavailableError);
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
// Without a WikiDbClient it throws WikiUnavailableError (NOT returns stub zeros).

describe("wikiSynthesizeHandler — CRIT-B real implementation", () => {
  it("throws WikiUnavailableError when db is null (correct contract)", async () => {
    const { wikiSynthesizeHandler, WikiUnavailableError } = await import("../../src/wiki/handlers/wiki-handlers.js");
    await expect(wikiSynthesizeHandler({}, null, null)).rejects.toThrow(WikiUnavailableError);
  });

  it("WikiUnavailableError names WikiDbClient as the missing dependency", async () => {
    const { wikiSynthesizeHandler, WikiUnavailableError } = await import("../../src/wiki/handlers/wiki-handlers.js");
    const err = await wikiSynthesizeHandler({}, null, null).catch((e) => e);
    expect(err).toBeInstanceOf(WikiUnavailableError);
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
// capturing WikiUnavailableError per stage rather than returning a fake success.

describe("wikiPipelineHandler — CRIT-B real implementation", () => {
  it("returns stages object with per-stage results (not a note string)", async () => {
    const { wikiPipelineHandler } = await import("../../src/wiki/handlers/wiki-handlers.js");
    const result = await wikiPipelineHandler({}, null, null);
    expect(result.stages).toBeDefined();
    expect(typeof result.stages).toBe("object");
  });

  it("stages_run is an array (empty when all stages are unavailable)", async () => {
    const { wikiPipelineHandler } = await import("../../src/wiki/handlers/wiki-handlers.js");
    const result = await wikiPipelineHandler({}, null, null);
    expect(Array.isArray(result.stages_run)).toBe(true);
  });

  it("extract stage shows unavailable status when db is null", async () => {
    const { wikiPipelineHandler } = await import("../../src/wiki/handlers/wiki-handlers.js");
    const result = await wikiPipelineHandler({}, null, null);
    expect(result.stages["extract"]?.status).toBe("unavailable");
  });

  it("synthesize stage shows unavailable when db is null", async () => {
    const { wikiPipelineHandler } = await import("../../src/wiki/handlers/wiki-handlers.js");
    const result = await wikiPipelineHandler({}, null, null);
    expect(result.stages["synthesize"]?.status).toBe("unavailable");
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

// ── AnthropicLlmClient — mocked SDK transport ─────────────────────────────────
//
// Exercises the production AnthropicLlmClient class end-to-end with a mocked
// @anthropic-ai/sdk module. Verifies:
//   - constructor wires apiKey + model overrides through to the SDK
//   - complete() forwards system/prompt/max_tokens/temperature correctly
//   - the first text content block is returned
//   - non-text content blocks raise a descriptive Error
//
// Replaces a prior it.todo placeholder that gated on a real ANTHROPIC_API_KEY;
// the SDK mock keeps the test deterministic, fast, and CI-safe while still
// exercising the adapter's transport-layer contract.

describe("AnthropicLlmClient — SDK transport (mocked @anthropic-ai/sdk)", () => {
  it("complete() returns the first text block from the SDK response", async () => {
    const sdkMockA = anthropicMock;
    sdkMockA.create.mockResolvedValueOnce({
      content: [{ type: "text", text: "polished prose" }],
      stop_reason: "end_turn",
    });

    const { AnthropicLlmClient } = await import(
      "../../src/infrastructure/anthropic-llm-client.js"
    );
    const client = new AnthropicLlmClient({ apiKey: "test-key", model: "claude-3-5-haiku-20241022" });
    const out = await client.complete({
      system: "you are a test",
      prompt: "say hi",
      maxTokens: 128,
      temperature: 0.5,
    });

    expect(out).toBe("polished prose");
    expect(sdkMockA.Anthropic).toHaveBeenCalledWith({ apiKey: "test-key" });
    expect(sdkMockA.create).toHaveBeenCalled();
    const lastCall = sdkMockA.create.mock.calls.at(-1) as [{
      model: string;
      max_tokens: number;
      temperature: number;
      system?: string;
      messages: Array<{ role: string; content: string }>;
    }];
    const callArgs = lastCall[0];
    expect(callArgs.model).toBe("claude-3-5-haiku-20241022");
    expect(callArgs.max_tokens).toBe(128);
    expect(callArgs.temperature).toBe(0.5);
    expect(callArgs.system).toBe("you are a test");
    expect(callArgs.messages).toEqual([{ role: "user", content: "say hi" }]);
  });

  it("complete() throws when the API response contains no text blocks", async () => {
    const sdkMockB = anthropicMock;
    sdkMockB.create.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "x", name: "y", input: {} }],
      stop_reason: "tool_use",
    });

    const { AnthropicLlmClient } = await import(
      "../../src/infrastructure/anthropic-llm-client.js"
    );
    const client = new AnthropicLlmClient({ apiKey: "test-key" });

    await expect(client.complete({ prompt: "hi" })).rejects.toThrow(
      /no text content blocks/,
    );
  });

  it("complete() throws when the API response has empty content array", async () => {
    // source: anthropic-llm-client.ts:89-99 — the for-of loop falls through
    // when content is empty (e.g. stop_reason:"max_tokens" with no content).
    // Verify the descriptive error fires for content:[] just as for non-text-block
    // responses. (Liskov P1b.)
    const sdkMockC = anthropicMock;
    sdkMockC.create.mockResolvedValueOnce({
      content: [],
      stop_reason: "max_tokens",
    });

    const { AnthropicLlmClient } = await import(
      "../../src/infrastructure/anthropic-llm-client.js"
    );
    const client = new AnthropicLlmClient({ apiKey: "test-key" });

    await expect(client.complete({ prompt: "hi" })).rejects.toThrow(
      /no text content blocks/,
    );
  });

  it("complete() returns the first text block when text follows a tool_use block", async () => {
    // source: anthropic-llm-client.ts:89-93 — iterates content and returns the
    // first text block found. Verify the iteration honors order, not just
    // "any text block": a tool_use-then-text response must yield the text.
    // (Liskov P2b.)
    const sdkMockD = anthropicMock;
    sdkMockD.create.mockResolvedValueOnce({
      content: [
        { type: "tool_use", id: "x", name: "y", input: {} },
        { type: "text", text: "second-block text" },
      ],
      stop_reason: "end_turn",
    });

    const { AnthropicLlmClient } = await import(
      "../../src/infrastructure/anthropic-llm-client.js"
    );
    const client = new AnthropicLlmClient({ apiKey: "test-key" });

    const out = await client.complete({ prompt: "hi" });
    expect(out).toBe("second-block text");
  });

  it("complete() forwards DEFAULT_TEMPERATURE=1.0 when caller omits temperature", async () => {
    // source: anthropic-llm-client.ts:23 — DEFAULT_TEMPERATURE = 1.0
    // (the API default; appropriate for the prose-polish task class).
    // The earlier test sets temperature explicitly; if a regression dropped
    // the field from `params`, that test would still pass because it asserts
    // the value the caller supplied. This case asserts the default is
    // forwarded when the caller omits it. (Feynman gap E.)
    const sdkMockE = anthropicMock;
    sdkMockE.create.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
    });

    const { AnthropicLlmClient } = await import(
      "../../src/infrastructure/anthropic-llm-client.js"
    );
    const client = new AnthropicLlmClient({ apiKey: "test-key" });
    await client.complete({ prompt: "hi" });

    const lastCall = sdkMockE.create.mock.calls.at(-1) as [{
      temperature: number;
      max_tokens: number;
    }];
    expect(lastCall[0].temperature).toBe(1.0);
    // and DEFAULT_MAX_TOKENS = 1024 should likewise be forwarded.
    expect(lastCall[0].max_tokens).toBe(1024);
  });
});
