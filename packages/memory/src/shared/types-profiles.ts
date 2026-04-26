/**
 * Profile-related Zod models for the methodology-agent system.
 *
 * These models define the cognitive profiling types: patterns, styles,
 * bridges, blind spots, detection, and domain profiles. They must be
 * compatible with the existing profiles.json format written by the JS server.
 *
 * Port of: mcp_server/shared/types_profiles.py (Pydantic → Zod)
 */

import { z } from "zod";

// ── Pattern Types ────────────────────────────────────────────────────────────

export const EntryPointSchema = z.object({
  pattern: z.string(),
  frequency: z.number().int().default(0),
  confidence: z.number().default(0.0),
  exampleMessages: z.array(z.string()).default([]),
});
export type EntryPoint = z.infer<typeof EntryPointSchema>;

export const RecurringPatternSchema = z.object({
  pattern: z.string(),
  ngramSignature: z.array(z.string()).default([]),
  frequency: z.number().int().default(0),
  sessionsObserved: z.number().int().default(0),
  confidence: z.number().default(0.0),
});
export type RecurringPattern = z.infer<typeof RecurringPatternSchema>;

export const ToolPreferenceSchema = z.object({
  ratio: z.number().default(0.0),
  avgPerSession: z.number().default(0.0),
});
export type ToolPreference = z.infer<typeof ToolPreferenceSchema>;

export const SessionShapeSchema = z.object({
  avgDuration: z.number().default(0.0),
  avgTurns: z.number().default(0.0),
  avgMessages: z.number().default(0.0),
  burstRatio: z.number().default(0.0),
  explorationRatio: z.number().default(0.0),
  dominantMode: z.enum(["burst", "exploration", "mixed"]).default("mixed"),
});
export type SessionShape = z.infer<typeof SessionShapeSchema>;

// ── Style Types ──────────────────────────────────────────────────────────────

export const CognitiveStyleSchema = z.object({
  activeReflective: z.number().default(0.0),
  sensingIntuitive: z.number().default(0.0),
  sequentialGlobal: z.number().default(0.0),
  problemDecomposition: z.enum(["top-down", "bottom-up"]).default("top-down"),
  explorationStyle: z.enum(["depth-first", "breadth-first"]).default("depth-first"),
  verificationBehavior: z.enum(["test-first", "test-after", "no-test"]).default("no-test"),
});
export type CognitiveStyle = z.infer<typeof CognitiveStyleSchema>;

export const GlobalStyleSchema = z.object({
  activeReflective: z.number().default(0.0),
  sensingIntuitive: z.number().default(0.0),
  sequentialGlobal: z.number().default(0.0),
  confidence: z.number().default(0.0),
  sessionCount: z.number().int().default(0),
});
export type GlobalStyle = z.infer<typeof GlobalStyleSchema>;

// ── Bridge & Blind Spot Types ────────────────────────────────────────────────

export const BridgeSchema = z.object({
  toDomain: z.string(),
  pattern: z.string().default(""),
  weight: z.number().default(0.0),
  examples: z.array(z.record(z.unknown())).default([]),
  edgeCount: z.number().int().default(0),
});
export type Bridge = z.infer<typeof BridgeSchema>;

export const BlindSpotSchema = z.object({
  type: z.enum(["category", "tool", "pattern"]),
  value: z.string(),
  severity: z.enum(["high", "medium", "low"]).default("medium"),
  description: z.string().default(""),
  suggestion: z.string().default(""),
});
export type BlindSpot = z.infer<typeof BlindSpotSchema>;

// ── Detection Types ──────────────────────────────────────────────────────────

export const DetectionContextSchema = z.object({
  cwd: z.string().nullable().optional(),
  project: z.string().nullable().optional(),
  firstMessage: z.string().nullable().optional(),
});
export type DetectionContext = z.infer<typeof DetectionContextSchema>;

export const AlternativeDomainSchema = z.object({
  id: z.string(),
  confidence: z.number().default(0.0),
});
export type AlternativeDomain = z.infer<typeof AlternativeDomainSchema>;

export const DetectionResultSchema = z.object({
  coldStart: z.boolean().default(false),
  domain: z.string().nullable().optional(),
  confidence: z.number().default(0.0),
  isNew: z.boolean().default(false),
  alternativeDomains: z.array(AlternativeDomainSchema).default([]),
  context: z.string().nullable().optional(),
});
export type DetectionResult = z.infer<typeof DetectionResultSchema>;

// ── Profile Types ────────────────────────────────────────────────────────────

export const DomainProfileSchema = z.object({
  id: z.string(),
  label: z.string().default(""),
  projects: z.array(z.string()).default([]),
  categories: z.record(z.number()).default({}),
  topKeywords: z.array(z.string()).default([]),
  entryPoints: z.array(EntryPointSchema).default([]),
  recurringPatterns: z.array(RecurringPatternSchema).default([]),
  toolPreferences: z.record(ToolPreferenceSchema).default({}),
  sessionShape: SessionShapeSchema.nullable().optional(),
  connectionBridges: z.array(BridgeSchema).default([]),
  blindSpots: z.array(BlindSpotSchema).default([]),
  metacognitive: CognitiveStyleSchema.nullable().optional(),
  confidence: z.number().default(0.0),
  sessionCount: z.number().int().default(0),
  lastUpdated: z.string().nullable().optional(),
  firstSeen: z.string().nullable().optional(),
});
export type DomainProfile = z.infer<typeof DomainProfileSchema>;

export const ProfilesV2Schema = z.object({
  version: z.number().int().default(2),
  updatedAt: z.string().nullable().optional(),
  globalStyle: GlobalStyleSchema.nullable().optional(),
  domains: z.record(DomainProfileSchema).default({}),
});
export type ProfilesV2 = z.infer<typeof ProfilesV2Schema>;

// ── Session Log Types ────────────────────────────────────────────────────────

export const SessionLogEntrySchema = z.object({
  sessionId: z.string(),
  domain: z.string().default(""),
  timestamp: z.string().default(""),
  project: z.string().nullable().optional(),
  cwd: z.string().nullable().optional(),
  duration: z.number().nullable().optional(),
  turnCount: z.number().int().default(0),
  toolsUsed: z.array(z.string()).default([]),
  category: z.string().default(""),
  entryKeywords: z.array(z.string()).default([]),
});
export type SessionLogEntry = z.infer<typeof SessionLogEntrySchema>;

export const SessionLogSchema = z.object({
  sessions: z.array(SessionLogEntrySchema).default([]),
});
export type SessionLog = z.infer<typeof SessionLogSchema>;
