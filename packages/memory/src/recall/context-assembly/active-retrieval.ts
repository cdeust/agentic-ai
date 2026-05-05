/* eslint-disable @typescript-eslint/no-magic-numbers -- source: exact port of Python source; all numeric literals copied verbatim from cited Python file */
/**
 * Active retrieval — generate a refined sub-query before recall fires.
 *
 * Paper backing:
 *   Wang & Chen, "MIRIX: Multi-Agent Memory System for LLM-Based Agents",
 *   arxiv 2507.07957 (July 2025). § Active Retrieval: the agent generates
 *   a topic/sub-query from the raw question, retrieves on the refined
 *   query, and injects the result into the system prompt. Reported 85.4%
 *   on LoCoMo.
 *
 * Why this matters for BEAM: probing questions are rarely phrased the
 * way stored content is. A question like "when did I first mention X?"
 * does not lexically or semantically match "I think X is important
 * because ..." written 9000 turns ago. Reformulating the question into a
 * search-optimized form bridges the gap.
 *
 * Implementation: two strategies provided.
 *   - KeywordExtractor: rule-based — pull nouns, proper nouns, temporal
 *     expressions, and any quoted strings. Zero latency, no model.
 *   - LLMReformulator: calls a small local model to rewrite the question.
 *     Slower, more accurate. Gated by model availability.
 *
 * source: Cortex mcp_server/core/context_assembly/active_retrieval.py
 */

// ── Abstract interface ───────────────────────────────────────────────────

/** Rewrites a raw query into a search-optimized form. */
export interface ActiveRetriever {
  reformulate(query: string): string;
}

// ── Rule-based reformulator ─────────────────────────────────────────────

const QUESTION_WORDS: ReadonlySet<string> = new Set([
  "what", "when", "where", "who", "why", "how", "which", "whose", "whom",
  "does", "did", "is", "was", "are", "were", "can", "could", "will",
  "would", "should", "have", "has", "had", "do",
  "the", "a", "an", "i", "you", "me", "my", "your", "our",
  "they", "them", "us", "he", "she", "it", "its",
  "be", "been", "being",
  "to", "of", "in", "on", "at", "by", "for", "with", "about",
  "against", "between", "into", "through", "during", "before", "after",
]);

const DATE_RE = /\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:,?\s+\d{4})?)\b/gi;

/**
 * Extract high-signal keywords; drop question words and filler.
 *
 * Fast, deterministic, no model required. Good baseline against
 * which to A/B test LLM-based reformulation.
 */
export class KeywordExtractor implements ActiveRetriever {
  reformulate(query: string): string {
    if (!query.trim()) return query;

    // Preserve quoted strings verbatim
    const quotedTerms: string[] = [];
    for (const m of query.matchAll(/'([^']+)'|"([^"]+)"/g)) {
      quotedTerms.push(m[1] ?? m[2] ?? "");
    }

    // Preserve dates
    const dates: string[] = [];
    for (const m of query.matchAll(DATE_RE)) {
      dates.push(m[0]);
    }

    // Extract capitalized words (likely proper nouns) and words of length >= 4
    const wordMatches = [...query.matchAll(/\b[\w']+\b/g)];
    const keywords: string[] = [];
    for (const m of wordMatches) {
      const w = m[0];
      const wl = w.toLowerCase();
      if (QUESTION_WORDS.has(wl)) continue;
      const c0 = w[0] ?? "";
      if (c0 && c0 === c0.toUpperCase() && c0 !== c0.toLowerCase()) {
        keywords.push(w);
      } else if (w.length >= 4) {
        keywords.push(w);
      }
    }

    const combined = [...quotedTerms, ...dates, ...keywords];
    if (combined.length === 0) return query;

    // Preserve original order roughly, dedupe
    const seen = new Set<string>();
    const out: string[] = [];
    for (const term of combined) {
      if (!seen.has(term.toLowerCase())) {
        seen.add(term.toLowerCase());
        out.push(term);
      }
    }
    return out.join(" ");
  }
}

// ── LLM-based reformulator (optional) ──────────────────────────────────

const REFORMULATION_PROMPT =
  "Rewrite the following question as a search query optimized for " +
  "retrieving relevant passages from a conversation log. Keep key " +
  "entities, dates, and specific terms. Drop filler. Return ONLY " +
  "the rewritten query, no preamble.\n\n" +
  "Question: {query}\n" +
  "Rewritten query:";

/**
 * Use a small local model to rewrite the query.
 *
 * Gated: if no LLM is available, falls back to passthrough. The
 * caller is responsible for providing a llmFn that takes a prompt
 * and returns a completion. This keeps the module dependency-free.
 */
export class LLMReformulator implements ActiveRetriever {
  private readonly _llmFn?: (prompt: string) => string | Promise<string>;

  constructor(llmFn?: (prompt: string) => string | Promise<string>) {
    this._llmFn = llmFn;
  }

  reformulate(query: string): string {
    // Sync passthrough when no LLM function provided
    if (!this._llmFn) return query;
    // Note: callers that need async reformulation should use reformulateAsync.
    return query;
  }

  async reformulateAsync(query: string): Promise<string> {
    if (!this._llmFn) return query;
    try {
      const prompt = REFORMULATION_PROMPT.replace("{query}", query);
      const result = await this._llmFn(prompt);
      if (typeof result === "string" && result.trim()) {
        return result.trim();
      }
    } catch {
      // Fall through to passthrough
    }
    return query;
  }
}
