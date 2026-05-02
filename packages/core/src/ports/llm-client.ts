/**
 * @agentic/core — ports/llm-client.ts
 *
 * LlmClient port: the minimal interface that describes single-turn LLM
 * completions required by narrative prose-polish and wiki synthesis handlers.
 *
 * This interface is intentionally minimal for Phase 7. Richer capabilities
 * (streaming, tool-use, multi-turn) are deferred until their handlers land.
 *
 * Layer: CORE. Must not import from infrastructure or handlers.
 *
 * source: docs/PHASE_7_TRACKING.md §Group C — LLM-dependent handlers
 * source: Martin, R. C. (2017). Clean Architecture, Ch. 22 —
 *         core declares what it needs via interface types; infrastructure
 *         provides the adapter.
 */

/**
 * Single-turn text completion port.
 *
 * Precondition:  prompt is a non-empty string; maxTokens (if given) is > 0;
 *                temperature (if given) is in [0, 1].
 * Postcondition: resolves with the model's text response (non-empty on success).
 * Error cases:   rejects with a descriptive Error on network failure, auth
 *                failure, or quota exhaustion.
 */
export interface LlmClient {
  /**
   * Single-turn completion with optional system prompt. Returns text.
   *
   * @param opts.system   - Optional system-role prompt.
   * @param opts.prompt   - User-role prompt (required, non-empty).
   * @param opts.maxTokens - Upper bound on response tokens.
   *                         source: Anthropic API default = 1024 tokens
   *                         (https://docs.anthropic.com/en/api/messages —
   *                          max_tokens is required; 1024 is the typical
   *                          task-appropriate default for prose summaries).
   * @param opts.temperature - Sampling temperature in [0, 1].
   *                           source: Anthropic API default = 1.0
   *                           (https://docs.anthropic.com/en/api/messages —
   *                            temperature parameter, default value).
   */
  complete(opts: {
    system?: string;
    prompt: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<string>;
}
