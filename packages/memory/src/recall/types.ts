/**
 * Zod schemas and TypeScript types for the recall subsystem.
 *
 * Port of: mcp_server/handlers/recall.py (schema block)
 *          mcp_server/core/retrieval_signals.py
 *          mcp_server/core/scoring.py
 *          mcp_server/shared/types.py (MemoryItem fields)
 */

import { z } from "zod";

// ── Query Intent ───────────────────────────────────────────────────────────
// Port of: mcp_server/core/query_intent.py QueryIntent class

export const QueryIntent = {
  TEMPORAL: "temporal",
  CAUSAL: "causal",
  SEMANTIC: "semantic",
  ENTITY: "entity",
  KNOWLEDGE_UPDATE: "knowledge_update",
  MULTI_HOP: "multi_hop",
  INSTRUCTION: "instruction",
  EVENT_ORDER: "event_order",
  SUMMARIZATION: "summarization",
  PREFERENCE: "preference",
  GENERAL: "general",
} as const;

export type QueryIntentValue = (typeof QueryIntent)[keyof typeof QueryIntent];

export const QueryIntentSchema = z.enum([
  "temporal",
  "causal",
  "semantic",
  "entity",
  "knowledge_update",
  "multi_hop",
  "instruction",
  "event_order",
  "summarization",
  "preference",
  "general",
]);

// ── Recall request ─────────────────────────────────────────────────────────

export const RecallRequestSchema = z.object({
  query: z.string().min(1),
  domain: z.string().optional(),
  directory: z.string().optional(),
  max_results: z.number().int().min(1).max(100).default(10),
  min_heat: z.number().min(0).max(1).default(0.05),
  agent_topic: z.string().optional(),
});

export type RecallRequest = z.infer<typeof RecallRequestSchema>;

// ── Single result entry ────────────────────────────────────────────────────

export const RecallResultSchema = z.object({
  memory_id: z.number().int(),
  content: z.string(),
  score: z.number(),
  heat: z.number(),
  domain: z.string(),
  tags: z.array(z.string()),
  store_type: z.string().default("episodic"),
  created_at: z.string(),
  importance: z.number().default(0.5),
  surprise: z.number().default(0.0),
  recency_boost: z.number().default(0.0),
});

export type RecallResult = z.infer<typeof RecallResultSchema>;

// ── Multi-signal signal collection ────────────────────────────────────────
// Port of: mcp_server/handlers/recall_helpers.py collect_signals()

export const MultiSignalSignalsSchema = z.object({
  vector: z.array(z.tuple([z.number().int(), z.number()])),
  fts: z.array(z.tuple([z.number().int(), z.number()])),
  heat: z.array(z.tuple([z.number().int(), z.number()])),
  bm25: z.array(z.tuple([z.number().int(), z.number()])),
  ngram: z.array(z.tuple([z.number().int(), z.number()])),
  // These rely on PG stored procs — they are port-pending at the boundary
  hopfield: z.array(z.tuple([z.number().int(), z.number()])).default([]),
  hdc: z.array(z.tuple([z.number().int(), z.number()])).default([]),
  sr: z.array(z.tuple([z.number().int(), z.number()])).default([]),
  sa: z.array(z.tuple([z.number().int(), z.number()])).default([]),
});

export type MultiSignalSignals = z.infer<typeof MultiSignalSignalsSchema>;

// ── Enhancements metadata ──────────────────────────────────────────────────

export const RecallEnhancementsSchema = z.object({
  query_expanded: z.boolean(),
  multihop_applied: z.boolean(),
  reranked: z.boolean(),
  knowledge_update_boost: z.boolean(),
  strategic_ordering: z.boolean(),
});

export type RecallEnhancements = z.infer<typeof RecallEnhancementsSchema>;

// ── Recall response ────────────────────────────────────────────────────────

export const RecallResponseSchema = z.object({
  results: z.array(RecallResultSchema),
  total: z.number().int(),
  query_intent: QueryIntentSchema,
  dispatch_tier: z.string(),
  signals: z.record(z.unknown()).default({}),
  enhancements: RecallEnhancementsSchema.optional(),
});

export type RecallResponse = z.infer<typeof RecallResponseSchema>;

// ── Retrieval signal weight map ────────────────────────────────────────────

export const SignalWeightsSchema = z.object({
  vector: z.number(),
  fts: z.number(),
  heat: z.number(),
  temporal: z.number().default(0),
  causal: z.number().default(0),
  entity: z.number().default(0),
  spreading: z.number().default(0),
});

export type SignalWeights = z.infer<typeof SignalWeightsSchema>;

// ── PG-path specific weights ───────────────────────────────────────────────

export const PgWeightsSchema = z.object({
  vector: z.number(),
  fts: z.number(),
  heat: z.number(),
  ngram: z.number(),
  recency: z.number(),
});

export type PgWeights = z.infer<typeof PgWeightsSchema>;

// ── Hierarchical recall request ────────────────────────────────────────────
// Port of: mcp_server/handlers/recall_hierarchical.py schema

export const HierarchicalRecallRequestSchema = z.object({
  query: z.string().min(1),
  domain: z.string().optional(),
  memory_ids: z.array(z.number().int().min(1)).max(5000).optional(),
  max_results: z.number().int().min(1).max(100).default(10),
  min_heat: z.number().min(0).max(1).default(0.05),
  cluster_threshold: z.number().min(0).max(1).default(0.6),
});

export type HierarchicalRecallRequest = z.infer<
  typeof HierarchicalRecallRequestSchema
>;

// ── Hierarchical result ────────────────────────────────────────────────────

export const HierarchicalResultSchema = z.object({
  memory_id: z.number().int(),
  score: z.number(),
  matched_level: z.string(),
  level_scores: z.record(z.number()).default({}),
  content: z.string(),
  heat: z.number(),
  domain: z.string(),
  tags: z.array(z.string()),
  created_at: z.string(),
});

export type HierarchicalResult = z.infer<typeof HierarchicalResultSchema>;

// ── Hierarchical recall response ───────────────────────────────────────────

export const HierarchicalRecallResponseSchema = z.object({
  results: z.array(HierarchicalResultSchema),
  total: z.number().int(),
  query_word_count: z.number().int().optional(),
  level_weights: z.record(z.number()).optional(),
  hierarchy: z
    .object({
      stats: z.record(z.unknown()).optional(),
    })
    .optional(),
});

export type HierarchicalRecallResponse = z.infer<
  typeof HierarchicalRecallResponseSchema
>;

// ── Memory item for store operations ──────────────────────────────────────
// Minimal interface; full type owned by port/cortex-shared when merged.

export interface MemoryItem {
  id: number;
  content: string;
  heat: number;
  domain: string;
  tags: string[] | string;
  store_type: string;
  created_at: string;
  importance: number;
  surprise_score: number;
  embedding: number[] | null;
  memory_id?: number;
}
