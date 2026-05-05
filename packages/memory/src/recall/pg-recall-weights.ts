/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * PG recall weight profiles.
 * Port of: mcp_server/core/pg_recall.py (weight section) | Source SHA: cortex@ed33435
 */
import { QueryIntent } from "./types.js";
import type { QueryIntentValue } from "./types.js";

/** source: cortex@ed33435 mcp_server/core/pg_recall.py lines 121-127 */
export const BASE_PG_WEIGHTS: Record<string,number> = {
  vector: 1.0, fts: 0.5, heat: 0.3, ngram: 0.3, recency: 0.0,
};

/** source: cortex@ed33435 mcp_server/core/pg_recall.py lines 129-151 */
export const PG_INTENT_OVERRIDES: Partial<Record<QueryIntentValue,Record<string,number>>> = {
  [QueryIntent.TEMPORAL]: { heat: 0.6, recency: 0.2 },
  [QueryIntent.KNOWLEDGE_UPDATE]: { recency: 0.5, heat: 0.5 },
  [QueryIntent.EVENT_ORDER]: { heat: 0.4, recency: 0.3, fts: 0.6 },
  [QueryIntent.SUMMARIZATION]: { heat: 0.5, fts: 0.7 },
  [QueryIntent.PREFERENCE]: { fts: 0.8, heat: 0.5 },
};

/** source: cortex@ed33435 mcp_server/core/pg_recall.py lines 154-204 */
export function computePgWeights(intent: QueryIntentValue|string, cw: Record<string,number> = {}): Record<string,number> {
  const f = cw["fts"] ?? BASE_PG_WEIGHTS["fts"] ?? 0.5;
  // source: cortex@ed33435 mcp_server/core/pg_recall.py line 192 (ngram = fts * 0.6)
  const b: Record<string,number> = { vector: 1.0, fts: f, heat: cw["heat"] ?? BASE_PG_WEIGHTS["heat"] ?? 0.3, ngram: f * 0.6, recency: 0.0 };
  const ov = PG_INTENT_OVERRIDES[intent as QueryIntentValue];
  if (ov) Object.assign(b, ov);
  if (process.env["CORTEX_DECAY_DISABLED"]==="1"||process.env["CORTEX_HEAT_CONSTANT"]!==undefined||process.env["CORTEX_ABLATE_ADAPTIVE_DECAY"]==="1") b["heat"]=0.0;
  return b;
}
