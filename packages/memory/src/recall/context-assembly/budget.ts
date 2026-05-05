/**
 * Token budget utilities for context-assembly condensers.
 *
 * source: Cortex mcp_server/core/context_assembly/condensers.py (cortex@ed33435)
 * source: OpenAI tokenizer documentation — 1 token ≈ 4 characters for English text
 *   (https://platform.openai.com/tokenizer); used as the approximation in Cortex.
 */

/**
 * Approximate the number of tokens in a text string.
 *
 * Precondition:  text is a string (may be empty).
 * Postcondition: returns Math.ceil(text.length / 4), which approximates GPT-4
 *                token count for English prose within ±20% per OpenAI tokenizer docs.
 *
 * source: OpenAI tokenizer — 1 token ≈ 4 characters (English)
 * source: Cortex condensers.py — uses the same 4-char heuristic internally
 */
export function estimateTokens(text: string): number {
  // source: OpenAI tokenizer — 1 token ≈ 4 characters for English prose
  const CHARS_PER_TOKEN = 4;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Truncate text to fit within a token budget.
 *
 * Precondition:  text is a string; budget is a positive integer.
 * Postcondition: returns a prefix of text such that estimateTokens(result) <= budget.
 *                If the full text already fits, returns text unchanged.
 *
 * source: Cortex condensers.py — truncation helper used by every condense_* function
 */
export function truncateToBudget(text: string, budget: number): string {
  // source: OpenAI tokenizer — 1 token ≈ 4 characters for English prose
  const CHARS_PER_TOKEN = 4;
  const maxChars = budget * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}
