/**
 * Zod data models for the memory subsystem.
 *
 * Extends shared/types.ts with memory-specific models. These define the
 * schema for SQLite storage and handler I/O — the memory system's contract.
 *
 * Port of: mcp_server/shared/memory_types.py (Pydantic → Zod)
 */

import { z } from "zod";

// ── Core Memory Models ───────────────────────────────────────────────────────

export const MemorySchema = z.object({
  id: z.number().int().nullable().optional(),
  content: z.string(),
  embedding: z.instanceof(Uint8Array).nullable().optional(),
  tags: z.array(z.string()).default([]),
  source: z.string().default(""), // "session", "tool", "user", "consolidation"
  domain: z.string().default(""),
  directoryContext: z.string().default(""),
  createdAt: z.string().datetime().default(() => new Date().toISOString()),
  lastAccessed: z.string().datetime().default(() => new Date().toISOString()),

  // Thermodynamic properties
  heat: z.number().default(1.0),
  surpriseScore: z.number().default(0.0),
  importance: z.number().default(0.5),
  emotionalValence: z.number().default(0.0),
  confidence: z.number().default(1.0),

  // Access tracking (metamemory)
  accessCount: z.number().int().default(0),
  usefulCount: z.number().int().default(0),

  // Reconsolidation state
  plasticity: z.number().default(1.0),
  stability: z.number().default(0.0),
  reconsolidationCount: z.number().int().default(0),
  lastReconsolidated: z.string().datetime().nullable().optional(),

  // Store type (CLS dual-store)
  storeType: z.enum(["episodic", "semantic"]).default("episodic"),

  // Compression
  compressed: z.boolean().default(false),
  compressionLevel: z.number().int().default(0), // 0=full, 1=gist, 2=tag
  originalContent: z.string().nullable().optional(),

  // Protection
  isProtected: z.boolean().default(false),
  isStale: z.boolean().default(false),
  isGlobal: z.boolean().default(false), // Visible to all projects when True

  // Engram allocation
  slotIndex: z.number().int().nullable().optional(),
  excitability: z.number().default(1.0),

  // Consolidation cascade (Kandel 2001, Dudai 2012)
  consolidationStage: z.string().default("labile"),
  // labile/early_ltp/late_ltp/consolidated/reconsolidating
  hoursInStage: z.number().default(0.0),
  replayCount: z.number().int().default(0),

  // Oscillatory context (Hasselmo 2005, Buzsaki 2015)
  thetaPhaseAtEncoding: z.number().default(0.0),
  encodingStrength: z.number().default(1.0),

  // Pattern separation (Leutgeb 2007, Yassa & Stark 2011)
  separationIndex: z.number().default(0.0),
  interferenceScore: z.number().default(0.0),

  // Schema integration (Tse 2007, Gilboa & Marlatte 2017)
  schemaMatchScore: z.number().default(0.0),
  schemaId: z.string().nullable().optional(),

  // Hippocampal dependency (McClelland 1995)
  hippocampalDependency: z.number().default(1.0),
});
export type Memory = z.infer<typeof MemorySchema>;

export const EntitySchema = z.object({
  id: z.number().int().nullable().optional(),
  name: z.string(),
  type: z.enum([
    "file", "function", "variable", "dependency", "decision",
    "error", "solution", "domain", "pattern",
  ]),
  domain: z.string().default(""),
  createdAt: z.string().datetime().default(() => new Date().toISOString()),
  lastAccessed: z.string().datetime().default(() => new Date().toISOString()),
  heat: z.number().default(1.0),
  archived: z.boolean().default(false),
});
export type Entity = z.infer<typeof EntitySchema>;

export const RelationshipSchema = z.object({
  id: z.number().int().nullable().optional(),
  sourceEntityId: z.number().int(),
  targetEntityId: z.number().int(),
  relationshipType: z.string(), // co_occurrence, imports, calls, caused_by, resolved_by, etc.
  weight: z.number().default(1.0),
  isCausal: z.boolean().default(false),
  confidence: z.number().default(1.0),
  createdAt: z.string().datetime().default(() => new Date().toISOString()),
  lastReinforced: z.string().datetime().default(() => new Date().toISOString()),

  // Stochastic synaptic transmission (Markram 1998, Abbott & Regehr 2004)
  releaseProbability: z.number().default(0.5), // p(transmission) per access [0,1]
  facilitation: z.number().default(0.0),       // Short-term facilitation accumulator
  depression: z.number().default(0.0),          // Short-term depression accumulator
});
export type Relationship = z.infer<typeof RelationshipSchema>;

// ── Prospective Memory ───────────────────────────────────────────────────────

export const ProspectiveTriggerSchema = z.object({
  id: z.number().int().nullable().optional(),
  content: z.string(),
  triggerCondition: z.string(),
  triggerType: z.enum(["directory_match", "keyword_match", "entity_match", "time_based"]),
  targetDirectory: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
  createdAt: z.string().datetime().default(() => new Date().toISOString()),
  triggeredAt: z.string().datetime().nullable().optional(),
  triggeredCount: z.number().int().default(0),
});
export type ProspectiveTrigger = z.infer<typeof ProspectiveTriggerSchema>;

// ── Checkpoint (Hippocampal Replay) ──────────────────────────────────────────

export const CheckpointSchema = z.object({
  id: z.number().int().nullable().optional(),
  sessionId: z.string().default("default"),
  directoryContext: z.string().default(""),
  currentTask: z.string().default(""),
  filesBeingEdited: z.array(z.string()).default([]),
  keyDecisions: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  nextSteps: z.array(z.string()).default([]),
  activeErrors: z.array(z.string()).default([]),
  customContext: z.string().default(""),
  epoch: z.number().int().default(0),
  createdAt: z.string().datetime().default(() => new Date().toISOString()),
  isActive: z.boolean().default(true),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

// ── Archive ───────────────────────────────────────────────────────────────────

export const MemoryArchiveSchema = z.object({
  id: z.number().int().nullable().optional(),
  originalMemoryId: z.number().int(),
  content: z.string(),
  embedding: z.instanceof(Uint8Array).nullable().optional(),
  archivedAt: z.string().datetime().default(() => new Date().toISOString()),
  mismatchScore: z.number().default(0.0),
  archiveReason: z.string().default(""), // "reconsolidation", "compression", "extinction"
});
export type MemoryArchive = z.infer<typeof MemoryArchiveSchema>;

// ── Consolidation Log ─────────────────────────────────────────────────────────

export const ConsolidationLogSchema = z.object({
  id: z.number().int().nullable().optional(),
  timestamp: z.string().datetime().default(() => new Date().toISOString()),
  memoriesAdded: z.number().int().default(0),
  memoriesUpdated: z.number().int().default(0),
  memoriesArchived: z.number().int().default(0),
  durationMs: z.number().int().default(0),
});
export type ConsolidationLog = z.infer<typeof ConsolidationLogSchema>;

// ── Stats ──────────────────────────────────────────────────────────────────────

export const MemoryStatsSchema = z.object({
  totalMemories: z.number().int().default(0),
  episodicCount: z.number().int().default(0),
  semanticCount: z.number().int().default(0),
  activeCount: z.number().int().default(0),
  archivedCount: z.number().int().default(0),
  staleCount: z.number().int().default(0),
  protectedCount: z.number().int().default(0),
  avgHeat: z.number().default(0.0),
  totalEntities: z.number().int().default(0),
  totalRelationships: z.number().int().default(0),
  activeTriggers: z.number().int().default(0),
  lastConsolidation: z.string().datetime().nullable().optional(),

  // Consolidation stage distribution
  labileCount: z.number().int().default(0),
  earlyLtpCount: z.number().int().default(0),
  lateLtpCount: z.number().int().default(0),
  consolidatedCount: z.number().int().default(0),
  reconsolidatingCount: z.number().int().default(0),
  avgInterferenceScore: z.number().default(0.0),
  schemaCount: z.number().int().default(0),
  distributionHealth: z.number().default(0.0),
});
export type MemoryStats = z.infer<typeof MemoryStatsSchema>;

// ── Recall Result ──────────────────────────────────────────────────────────────

export const RecallResultSchema = z.object({
  memoryId: z.number().int(),
  content: z.string(),
  score: z.number().default(0.0),
  heat: z.number().default(0.0),
  domain: z.string().default(""),
  tags: z.array(z.string()).default([]),
  storeType: z.string().default("episodic"),
  createdAt: z.string().default(""),
  signals: z.record(z.number()).default({}),
});
export type RecallResult = z.infer<typeof RecallResultSchema>;
