/**
 * AnthropicLlmClient — adapter that wraps the official Anthropic SDK.
 *
 * Layer: INFRASTRUCTURE.  Implements the LlmClient port declared in @agentic/core.
 * Must not be imported by core or domain modules.
 *
 * source: https://docs.anthropic.com/en/api/getting-started
 * source: @anthropic-ai/sdk — Messages.create() API
 * source: Martin, R. C. (2017). Clean Architecture, Ch. 22 —
 *         infrastructure adapters implement core ports; composition root wires them.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { LlmClient } from "@agentic/core";

// ── Defaults ──────────────────────────────────────────────────────────────────

// source: https://docs.anthropic.com/en/api/messages — max_tokens required; 1024 is prose-summary ceiling
const DEFAULT_MAX_TOKENS = 1024;

// source: https://docs.anthropic.com/en/api/messages — temperature default = 1.0
// Prose-polish is a creative task; the API default is appropriate.
const DEFAULT_TEMPERATURE = 1.0;

// source: https://docs.anthropic.com/en/api/models-list — claude-3-5-haiku-20241022
const DEFAULT_MODEL = "claude-3-5-haiku-20241022"; // fastest/cheapest Anthropic model suitable for prose polish

// ── Adapter ───────────────────────────────────────────────────────────────────

/**
 * AnthropicLlmClient implements the LlmClient port using the Anthropic SDK.
 *
 * Precondition:  ANTHROPIC_API_KEY is set in the environment (or apiKey is
 *                passed to the constructor) before any call to complete().
 * Postcondition: complete() resolves with the first text block from the
 *                API response, or rejects with a descriptive Error.
 * Invariant:     the underlying Anthropic client instance is stateless between
 *                calls; no mutable state is accumulated across invocations.
 */
export class AnthropicLlmClient implements LlmClient {
  readonly #client: Anthropic;
  readonly #model: string;

  /**
   * @param opts.apiKey - Anthropic API key. Defaults to ANTHROPIC_API_KEY env var.
   * @param opts.model  - Model identifier. Defaults to claude-3-5-haiku-20241022.
   *                      source: https://docs.anthropic.com/en/api/models-list
   */
  constructor(opts: { apiKey?: string; model?: string } = {}) {
    this.#client = new Anthropic({ apiKey: opts.apiKey });
    this.#model = opts.model ?? DEFAULT_MODEL;
  }

  /**
   * Single-turn completion.
   *
   * Precondition:  opts.prompt is a non-empty string.
   * Postcondition: returns the first text-block content from the API response.
   * Error cases:   throws Error with the underlying API error message on failure.
   */
  async complete(opts: {
    system?: string;
    prompt: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<string> {
    const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    const temperature = opts.temperature ?? DEFAULT_TEMPERATURE;

    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: opts.prompt },
    ];

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.#model,
      max_tokens: maxTokens,
      temperature,
      messages,
    };

    if (opts.system !== undefined && opts.system.length > 0) {
      params.system = opts.system;
    }

    const response = await this.#client.messages.create(params);

    // Extract first text block; the API guarantees at least one content block
    // on a successful response.
    for (const block of response.content) {
      if (block.type === "text") {
        return block.text;
      }
    }

    throw new Error(
      `AnthropicLlmClient: response contained no text content blocks ` +
      `(model=${this.#model}, stop_reason=${response.stop_reason})`
    );
  }
}
