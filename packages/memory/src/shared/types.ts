/**
 * Centralized Zod type definitions for the methodology-agent system.
 *
 * Memory, graph, and interpretability models live here. Profile-related
 * models are defined in types-profiles.ts.
 *
 * Port of: mcp_server/shared/types.py (Pydantic → Zod)
 */

import { z } from "zod";

// ── Conversation / Memory Metadata ──────────────────────────────────────────

export const ConversationMetaSchema = z.object({
  sessionId: z.string(),
  slug: z.string().nullable().optional(),
  project: z.string().default(""),
  cwd: z.string().nullable().optional(),
  firstMessage: z.string().nullable().optional(),
  allText: z.string().nullable().optional(),
  keywords: z.array(z.string()).default([]),
  startedAt: z.string().nullable().optional(),
  endedAt: z.string().nullable().optional(),
  messageCount: z.number().int().default(0),
  userCount: z.number().int().default(0),
  assistantCount: z.number().int().default(0),
  turnCount: z.number().int().default(0),
  toolsUsed: z.array(z.string()).default([]),
  duration: z.number().nullable().optional(),
  fileSize: z.number().int().nullable().optional(),
});
export type ConversationMeta = z.infer<typeof ConversationMetaSchema>;

export const MemoryMetaSchema = z.object({
  file: z.string().default(""),
  path: z.string().default(""),
  project: z.string().default(""),
  name: z.string().default(""),
  description: z.string().default(""),
  type: z.string().default(""),
  body: z.string().default(""),
  modifiedAt: z.string().default(""),
  createdAt: z.string().nullable().optional(),
});
export type MemoryMeta = z.infer<typeof MemoryMetaSchema>;

// ── Graph Types ──────────────────────────────────────────────────────────────

export const GraphNodeSchema = z.object({
  id: z.string(),
  type: z.enum(["domain", "entry-point", "recurring-pattern", "tool-preference"]),
  label: z.string().default(""),
  domain: z.string().default(""),
  confidence: z.number().nullable().optional(),
  frequency: z.number().int().nullable().optional(),
  ratio: z.number().nullable().optional(),
  color: z.string().default("#999999"),
  size: z.number().default(1.0),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  type: z.enum(["has-entry", "has-pattern", "uses-tool", "bridge"]),
  weight: z.number().default(1.0),
  label: z.string().nullable().optional(),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const GraphDataSchema = z.object({
  nodes: z.array(GraphNodeSchema).default([]),
  edges: z.array(GraphEdgeSchema).default([]),
  blindSpotRegions: z.array(z.record(z.unknown())).default([]),
});
export type GraphData = z.infer<typeof GraphDataSchema>;

// ── Interpretability Types ───────────────────────────────────────────────────

export const TopSignalSchema = z.object({
  signal: z.string(),
  weight: z.number(),
});
export type TopSignal = z.infer<typeof TopSignalSchema>;

export const BehavioralFeatureSchema = z.object({
  index: z.number().int(),
  label: z.string().default(""),
  description: z.string().default(""),
  direction: z.array(z.number()).default([]),
  topSignals: z.array(TopSignalSchema).default([]),
});
export type BehavioralFeature = z.infer<typeof BehavioralFeatureSchema>;

export const SparseActivationSchema = z.object({
  weights: z.record(z.number()).default({}),
  reconstructionError: z.number().default(0.0),
});
export type SparseActivation = z.infer<typeof SparseActivationSchema>;

export const AttributionNodeSchema = z.object({
  id: z.string(),
  label: z.string().default(""),
  layer: z.enum(["input", "extractor", "classifier", "feature", "aggregator", "output"]),
  activation: z.number().default(0.0),
});
export type AttributionNode = z.infer<typeof AttributionNodeSchema>;

export const AttributionEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  weight: z.number().default(0.0),
});
export type AttributionEdge = z.infer<typeof AttributionEdgeSchema>;

export const AttributionGraphSchema = z.object({
  nodes: z.array(AttributionNodeSchema).default([]),
  edges: z.array(AttributionEdgeSchema).default([]),
});
export type AttributionGraph = z.infer<typeof AttributionGraphSchema>;

export const PersonaVectorSchema = z.object({
  activeReflective: z.number().default(0.0),
  sensingIntuitive: z.number().default(0.0),
  sequentialGlobal: z.number().default(0.0),
  thoroughness: z.number().default(0.0),
  autonomy: z.number().default(0.0),
  verbosity: z.number().default(0.0),
  riskTolerance: z.number().default(0.0),
  focusScope: z.number().default(0.0),
  iterationSpeed: z.number().default(0.0),
});
export type PersonaVector = z.infer<typeof PersonaVectorSchema>;

export const PersistentFeatureSchema = z.object({
  label: z.string(),
  persistence: z.number().default(0.0),
  consistency: z.number().default(0.0),
  domains: z.array(z.string()).default([]),
});
export type PersistentFeature = z.infer<typeof PersistentFeatureSchema>;

export const FeatureDictionarySchema = z.object({
  K: z.number().int(),
  D: z.number().int(),
  sparsity: z.number().int().default(0),
  signalNames: z.array(z.string()).default([]),
  features: z.array(BehavioralFeatureSchema).default([]),
  learnedFromSessions: z.number().int().default(0),
});
export type FeatureDictionary = z.infer<typeof FeatureDictionarySchema>;
