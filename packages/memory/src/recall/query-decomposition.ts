/**
 * Query routing and decomposition for multi-signal retrieval.
 *
 * Routes classified queries to retrieval strategies and decomposes complex
 * queries into sub-queries via regex entity extraction.
 *
 * NOTE: This module uses regex to extract CamelCase identifiers, file paths,
 * backtick-quoted terms, and multi-word proper nouns. The intent-based
 * routing (routeQuery) is useful engineering but not from any specific paper.
 * Entity extraction and sub-query generation are regex heuristics.
 * Stop word list and sub-query limit of 6 are hand-tuned.
 *
 * Pure business logic — no I/O.
 *
 * Port of: cortex@ed33435 mcp_server/core/query_decomposition.py
 */

import { classifyQueryIntent } from "./query-intent.js";

// ── Routing Decisions ─────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/query_decomposition.py:32-38

const INTENT_TO_HANDLERS: Record<string, string[]> = {
  causal: ["causal_chain_search"],
  temporal: ["time_window_search"],
  entity: ["entity_graph_traversal"],
  knowledge_update: ["recency_supersession"],
  multi_hop: ["query_decomposition", "entity_bridging"],
};

/**
 * Route a query to the best retrieval strategy.
 *
 * precondition:  query is a non-empty string.
 * postcondition: returned object has intent, signals, weights,
 *   special_handlers, classification.
 *
 * source: cortex@ed33435 mcp_server/core/query_decomposition.py:41-72
 */
export function routeQuery(
  query: string,
  availableSignals: string[] | null = null,
): Record<string, unknown> {
  const classification = classifyQueryIntent(query);
  let weights = (classification["weights"] ?? {}) as Record<string, number>;

  if (availableSignals) {
    const availableSet = new Set(availableSignals);
    weights = Object.fromEntries(
      Object.entries(weights).filter(([k]) => availableSet.has(k)),
    );
  }

  const orderedSignals = Object.entries(weights)
    .sort(([, a], [, b]) => b - a)
    .map(([k, v]) => [k, v]);

  const intent = (classification["intent"] ?? "") as string;
  const specialHandlers = [...(INTENT_TO_HANDLERS[intent] ?? [])];

  return {
    intent,
    signals: orderedSignals,
    weights,
    special_handlers: specialHandlers,
    classification,
  };
}

// ── Entity Extraction ─────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/query_decomposition.py:77-93

const ENTITY_EXTRACT_RE = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b|([\w./]+\.\w{1,4})\b|`([^`]+)`/g;

/**
 * Extract entity references from a query for entity-graph routing.
 *
 * Extracts: CamelCase identifiers, file paths, and backtick-quoted terms.
 *
 * precondition:  query is a string.
 * postcondition: returned array contains unique non-empty entity strings.
 *
 * source: cortex@ed33435 mcp_server/core/query_decomposition.py:86-93
 */
export function extractQueryEntities(query: string): string[] {
  const entities: string[] = [];
  for (const match of query.matchAll(ENTITY_EXTRACT_RE)) {
    const entity = match[1] ?? match[2] ?? match[3];
    if (entity && entity.length > 1) {
      entities.push(entity);
    }
  }
  return entities;
}

// ── Query Decomposition ───────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/query_decomposition.py:96-177

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "to", "of", "and",
  "or", "in", "on", "at", "for", "with", "by", "from", "it", "this",
  "that", "i", "me", "my", "do", "did", "does", "what", "when", "where",
  "why", "how", "who", "which", "can", "could", "would", "should", "will",
  "about", "tell",
]);

const TIME_RE = /\b(today|yesterday|last\s+\w+|this\s+week|recently|\d+\s+(?:hours?|days?|weeks?|months?)\s+ago)\b/gi;

/**
 * Decompose a query into its constituent parts for multi-signal retrieval.
 *
 * precondition:  query is a string.
 * postcondition: returned object has routing, entities, keywords,
 *   timeHints, subQueries.
 *
 * source: cortex@ed33435 mcp_server/core/query_decomposition.py:152-177
 */
export function decomposeQuery(query: string): Record<string, unknown> {
  const routing = routeQuery(query);
  const entities = extractQueryEntities(query);

  const words = query.toLowerCase().match(/\b\w+\b/g) ?? [];
  const keywords = words.filter((w) => !STOP_WORDS.has(w) && w.length > 2);

  const timeHints = query.match(TIME_RE) ?? [];
  const subQueries = generateSubQueries(query, entities, keywords);

  return {
    routing,
    entities,
    keywords,
    time_hints: timeHints,
    sub_queries: subQueries,
  };
}

/**
 * Generate sub-queries via regex entity/phrase extraction.
 *
 * For multi-entity queries, creates per-entity sub-queries.
 * For complex queries, extracts quoted phrases and keyword combinations.
 * This is regex heuristic extraction, not LLM-based decomposition.
 *
 * precondition:  entities and keywords are string arrays.
 * postcondition: returned array has at most 6 elements (hand-tuned limit).
 *
 * source: cortex@ed33435 mcp_server/core/query_decomposition.py:180-214
 *   sub-query limit = 6 (hand-tuned)
 */
export function generateSubQueries(
  query: string,
  entities: string[],
  keywords: string[],
): string[] {
  const subQueries: string[] = [];

  // Per-entity sub-queries (up to 4)
  for (const entity of entities.slice(0, 4)) {
    subQueries.push(entity);
  }

  // Named entity sub-queries (multi-word proper nouns)
  const named = query.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g) ?? [];
  for (const name of named) {
    if (!subQueries.includes(name)) subQueries.push(name);
  }

  // Quoted phrase sub-queries
  const quoted = [...query.matchAll(/"([^"]+)"|'([^']+)'/g)];
  for (const m of quoted) {
    const phrase = m[1] ?? m[2];
    if (phrase && !subQueries.includes(phrase)) subQueries.push(phrase);
  }

  // Key content-word combinations (2-3 keywords together)
  if (keywords.length >= 3 && subQueries.length === 0) {
    subQueries.push(keywords.slice(0, 3).join(" "));
  }

  return subQueries.slice(0, 6); // source: cortex@ed33435 mcp_server/core/query_decomposition.py:214 — limit 6
}
