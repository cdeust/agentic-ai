/**
 * types.ts — Zod-typed domain types for the memory write path.
 *
 * Specification (postcondition of every type):
 *   A value that passes Zod parse is a valid input/output for the
 *   corresponding handler. The runtime shape exactly matches the
 *   column layout documented in SCHEMA.md.
 *
 * Source: CORTEX_INVENTORY.md Group 1; SCHEMA.md §memories table.
 * All column names and defaults taken verbatim from pg_schema.py.
 */

import { z } from "zod";

// ── Schema default constants ─────────────────────────────────────────────────
// source: pg_schema.py:MEMORIES_DDL — column DEFAULT values taken verbatim
const DEFAULT_IMPORTANCE = 0.5;       // source: pg_schema.py — importance DEFAULT 0.5
const DEFAULT_CALIBRATION_THRESHOLD = 0.4; // source: Jaynes 2003 Ch.11 — conservative prior
const DEFAULT_ACCEPTANCE_EMA = 0.5;   // source: Taleb 2012 Antifragile — neutral starting EMA

// ── Consolidation stage enum ────────────────────────────────────────────────
// source: Consolidation cascade (Kandel 2001, Dudai 2012)
export const ConsolidationStageSchema = z.enum([
  "labile",
  "early_ltp",
  "late_ltp",
  "consolidated",
]);
export type ConsolidationStage = z.infer<typeof ConsolidationStageSchema>;

// ── MemoryItem — rich shape mirroring the memories table ───────────────────
// source: SCHEMA.md §memories; pg_schema.py:MEMORIES_DDL
// NOTE: stage_entered_at added by v3_13_0_a3_migration.sql — present in prod.
export const MemoryItemSchema = z.object({
  id: z.number().int().positive(),
  content: z.string(),
  embedding: z.instanceof(Buffer).nullable().optional(),
  tags: z.array(z.string()).default([]),
  source: z.string().default(""),
  domain: z.string().default(""),
  directory_context: z.string().default(""),
  // source: SCHEMA.md §memories; pg_schema.py:MEMORIES_DDL — timestamp columns (ISO-8601 strings)
  created_at: z.string(), // source: SCHEMA.md §memories — ISO timestamp
  last_accessed: z.string(), // source: SCHEMA.md §memories — ISO timestamp
  heat_base: z.number().min(0).max(1).default(1.0),
  heat_base_set_at: z.string(), // source: SCHEMA.md §memories — ISO timestamp
  no_decay: z.boolean().default(false),
  surprise_score: z.number().default(0.0),
  importance: z.number().min(0).max(1).default(DEFAULT_IMPORTANCE),
  emotional_valence: z.number().default(0.0),
  confidence: z.number().min(0).max(1).default(1.0),
  access_count: z.number().int().default(0),
  useful_count: z.number().int().default(0),
  plasticity: z.number().default(1.0),
  stability: z.number().default(0.0),
  reconsolidation_count: z.number().int().default(0),
  last_reconsolidated: z.string().nullable().optional(),
  store_type: z.string().default("episodic"),
  compressed: z.boolean().default(false),
  compression_level: z.number().int().default(0),
  original_content: z.string().nullable().optional(),
  is_protected: z.boolean().default(false),
  is_stale: z.boolean().default(false),
  slot_index: z.number().int().nullable().optional(),
  excitability: z.number().default(1.0),
  consolidation_stage: ConsolidationStageSchema.default("labile"),
  hours_in_stage: z.number().default(0.0),
  stage_entered_at: z.string().nullable().optional(), // A3 migration column
  replay_count: z.number().int().default(0),
  theta_phase_at_encoding: z.number().default(0.0),
  encoding_strength: z.number().default(1.0),
  separation_index: z.number().default(0.0),
  interference_score: z.number().default(0.0),
  schema_match_score: z.number().default(0.0),
  schema_id: z.string().nullable().optional(),
  hippocampal_dependency: z.number().default(1.0),
  is_benchmark: z.boolean().default(false),
  agent_context: z.string().default(""),
  is_global: z.boolean().default(false),
  // Convenience alias: heat = heat_base for callers that predate A3.
  heat: z.number().min(0).max(1).optional(),
});
export type MemoryItem = z.infer<typeof MemoryItemSchema>;

// ── MemoryInsertData — subset required to call insertMemory ────────────────
// Precondition: content is non-empty; all other fields are optional with
// defined defaults (see MemoryItem above).
export const MemoryInsertDataSchema = z.object({
  content: z.string().min(1),
  embedding: z.instanceof(Buffer).nullable().optional(),
  tags: z.array(z.string()).default([]),
  source: z.string().default(""),
  domain: z.string().default(""),
  directory_context: z.string().default(""),
  created_at: z.string().optional(), // if absent, store sets to NOW()
  heat: z.number().min(0).max(1).default(1.0),
  surprise_score: z.number().default(0.0),
  importance: z.number().min(0).max(1).default(DEFAULT_IMPORTANCE),
  emotional_valence: z.number().default(0.0),
  confidence: z.number().min(0).max(1).default(1.0),
  store_type: z.string().default("episodic"),
  is_protected: z.boolean().default(false),
  consolidation_stage: ConsolidationStageSchema.default("labile"),
  theta_phase_at_encoding: z.number().default(0.0),
  encoding_strength: z.number().default(1.0),
  separation_index: z.number().default(0.0),
  interference_score: z.number().default(0.0),
  schema_match_score: z.number().default(0.0),
  schema_id: z.string().nullable().optional(),
  hippocampal_dependency: z.number().default(1.0),
  is_benchmark: z.boolean().default(false),
  agent_context: z.string().default(""),
  is_global: z.boolean().default(false),
  stage_entered_at: z.string().optional(),
  arousal: z.number().default(0.0),
  dominant_emotion: z.string().default("neutral"),
});
// source: phase 4-to-5 cleanup, 2026-04-26
// Use z.input<> (not z.infer<>) so that callers constructing insert payloads
// do not have to supply every field that has a .default() in the schema.
// The storage layer (pg-store, sqlite-store) uses `?? fallback` on every
// optional field, satisfying the postcondition without requiring callers to
// materialise defaults before handing data to the store.
// This is option (a): make fields with defaults optional at the call-site type
// boundary. It is the least invasive fix: only the exported type alias changes;
// the Zod schema and all storage code remain untouched.
export type MemoryInsertData = z.input<typeof MemoryInsertDataSchema>;

// ── WriteGateScore — output of the 4-signal novelty computation ───────────
// source: Friston K (2005) A theory of cortical responses.
//         Phil Trans R Soc B 360:815-836
export const WriteGateScoreSchema = z.object({
  embeddingNovelty: z.number().min(0).max(1),
  entityNovelty: z.number().min(0).max(1),
  temporalNovelty: z.number().min(0).max(1),
  structuralNovelty: z.number().min(0).max(1),
  combinedNovelty: z.number().min(0).max(1),
  shouldStore: z.boolean(),
  gateReason: z.string(),
  threshold: z.number(),
});
export type WriteGateScore = z.infer<typeof WriteGateScoreSchema>;

// ── AbstentionDecision — output of the abstention gate ────────────────────
// Model: cortex-beam-abstain DistilBERT (see abstention-gate.ts)
export const AbstentionDecisionSchema = z.object({
  abstain: z.boolean(),
  scores: z.array(z.number()),
  threshold: z.number(),
  filteredCount: z.number().int(),
  originalCount: z.number().int(),
});
export type AbstentionDecision = z.infer<typeof AbstentionDecisionSchema>;

// ── RememberRequest ────────────────────────────────────────────────────────
// Mirrors remember.py inputSchema. All optional fields have documented defaults.
export const RememberRequestSchema = z.object({
  content: z.string().min(1),
  tags: z.array(z.string()).default([]),
  directory: z.string().default(""),
  domain: z.string().optional(),
  source: z
    .enum(["session", "tool", "user", "consolidation", "import"])
    .default("user"),
  force: z.boolean().default(false),
  agent_topic: z.string().default(""),
  is_global: z.boolean().default(false),
  created_at: z.string().optional(), // source: SCHEMA.md §memories — ISO timestamp for backfill
  // override via initial_heat to reflect content age (Ebbinghaus curve —
  // see memory-ingest.ts). Source: issue #14 P1.
  initial_heat: z.number().min(0).max(1).optional(),
});
export type RememberRequest = z.infer<typeof RememberRequestSchema>;

// ── RememberResponse ───────────────────────────────────────────────────────
export const RememberResponseSchema = z.object({
  stored: z.boolean(),
  action: z.enum(["stored", "merged", "rejected"]).optional(),
  memory_id: z.number().int().optional(),
  reason: z.string().optional(),
  merged_with: z.number().int().optional(),
  heat: z.number().optional(),
  is_global: z.boolean().optional(),
  global_reason: z.string().optional(),
  wiki_page: z.string().optional(),
  warnings: z
    .array(
      z.object({
        scope: z.string(),
        memory_id: z.number().int().optional(),
        error_type: z.string(),
        message: z.string(),
      }),
    )
    .optional(),
  novelty: z
    .object({
      embedding_novelty: z.number(),
      entity_novelty: z.number(),
      temporal_novelty: z.number(),
      structural_novelty: z.number(),
      combined_novelty: z.number(),
    })
    .optional(),
  importance: z.number().optional(),
});
export type RememberResponse = z.infer<typeof RememberResponseSchema>;

// ── CalibrationState — write-gate threshold auto-calibration ──────────────
// source: Jaynes, E.T. (2003) Probability Theory. Cambridge. Ch. 11.
// source: Taleb, N.N. (2012) Antifragile. Random House.
export const CalibrationStateSchema = z.object({
  domain: z.string().default(""),
  threshold: z.number().default(DEFAULT_CALIBRATION_THRESHOLD),
  acceptanceEma: z.number().min(0).max(1).default(DEFAULT_ACCEPTANCE_EMA),
  totalObservations: z.number().int().default(0),
  lastAdjustmentAt: z.number().int().default(0),
});
export type CalibrationState = z.infer<typeof CalibrationStateSchema>;
