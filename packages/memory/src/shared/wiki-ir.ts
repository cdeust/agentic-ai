/**
 * Wiki pipeline Intermediate Representations (Phase 1 of redesign).
 *
 * Each IR is a named, inspectable boundary between pipeline phases:
 *
 *     transcript → [ClaimEvent] → [Concept] → [DraftPage] → [ApprovedPage] → rendered
 *
 * These are Zod models so they round-trip JSON for DB storage
 * (JSONB columns) and MCP tool payloads, and validate at the boundary.
 *
 * Pure data — no I/O. Imports: shared + stdlib only.
 *
 * Port of: mcp_server/shared/wiki_ir.py (Pydantic → Zod)
 */

import { z } from "zod";

// ── Phase output: transcript → ClaimEvent ─────────────────────────────

export const ClaimTypeSchema = z.enum([
  "assertion",
  "decision",
  "observation",
  "question",
  "method",
  "result",
  "limitation",
  "reference",
]);
export type ClaimType = z.infer<typeof ClaimTypeSchema>;

export const EvidenceRefSchema = z.object({
  kind: z.enum(["file", "commit", "paper", "memory", "claim", "benchmark", "url"]),
  target: z.string(),
  context: z.string().nullable().optional(),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const ClaimEventSchema = z.object({
  id: z.number().int().nullable().optional(),
  memoryId: z.number().int().nullable().optional(),
  sessionId: z.string().default(""),
  text: z.string().min(1).max(2000),
  claimType: ClaimTypeSchema.default("assertion"),
  entityIds: z.array(z.number().int()).default([]),
  evidenceRefs: z.array(EvidenceRefSchema).default([]),
  confidence: z.number().min(0.0).max(1.0).default(0.5),
  supersedes: z.number().int().nullable().optional(),
  extractedAt: z.string().datetime().nullable().optional(),
});
export type ClaimEvent = z.infer<typeof ClaimEventSchema>;

// ── Phase output: ClaimEvents → Concept ───────────────────────────────

export const ConceptStatusSchema = z.enum([
  "candidate",
  "saturating",
  "promoted",
  "merged",
  "split",
  "abandoned",
]);
export type ConceptStatus = z.infer<typeof ConceptStatusSchema>;

export const AxialSlotsSchema = z.object({
  conditions: z.array(z.string()).default([]),
  context: z.array(z.string()).default([]),
  strategies: z.array(z.string()).default([]),
  consequences: z.array(z.string()).default([]),
});
export type AxialSlots = z.infer<typeof AxialSlotsSchema>;

export const ConceptSchema = z.object({
  id: z.number().int().nullable().optional(),
  label: z.string().min(1).max(200),
  status: ConceptStatusSchema.default("candidate"),
  entityIds: z.array(z.number().int()).default([]),
  groundingMemoryIds: z.array(z.number().int()).default([]),
  groundingClaimIds: z.array(z.number().int()).default([]),
  properties: z.record(z.array(z.string())).default({}),
  axialSlots: AxialSlotsSchema.default({}),
  saturationRate: z.number().default(1.0),
  saturationStreak: z.number().int().default(0),
  firstSeenAt: z.string().datetime().nullable().optional(),
  lastPropertyAt: z.string().datetime().nullable().optional(),
  promotedPageId: z.number().int().nullable().optional(),
  mergedIntoId: z.number().int().nullable().optional(),
  splitIntoIds: z.array(z.number().int()).default([]),
});
export type Concept = z.infer<typeof ConceptSchema>;

// ── Phase output: Concept + Claims → DraftPage ────────────────────────

export const DraftStatusSchema = z.enum(["pending", "approved", "rejected", "published"]);
export type DraftStatus = z.infer<typeof DraftStatusSchema>;

export const SectionSchema = z.object({
  heading: z.string(),
  body: z.string(),
  claimIds: z.array(z.number().int()).default([]),
});
export type Section = z.infer<typeof SectionSchema>;

export const ProvenanceSchema = z.object({
  sourceType: z.enum(["concept", "memory", "user", "claim-set"]).default("concept"),
  sourceIds: z.array(z.number().int()).default([]),
  synthesisModel: z.string().nullable().optional(),
  synthesisPromptHash: z.string().nullable().optional(),
  generatedAt: z.string().datetime().nullable().optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const DraftPageSchema = z.object({
  id: z.number().int().nullable().optional(),
  conceptId: z.number().int().nullable().optional(),
  memoryId: z.number().int().nullable().optional(),
  title: z.string().min(1).max(300),
  kind: z.string(),
  lead: z.string().max(500).default(""),
  sections: z.array(SectionSchema).default([]),
  frontmatter: z.record(z.unknown()).default({}),
  provenance: ProvenanceSchema.default({}),
  confidence: z.number().min(0.0).max(1.0).default(0.5),
  status: DraftStatusSchema.default("pending"),
});
export type DraftPage = z.infer<typeof DraftPageSchema>;

// ── Phase output: DraftPage → ApprovedPage ────────────────────────────

export const PageStatusSchema = z.enum(["seedling", "budding", "evergreen"]);
export type PageStatus = z.infer<typeof PageStatusSchema>;

export const LifecycleStateSchema = z.enum(["active", "area", "archived", "evergreen"]);
export type LifecycleState = z.infer<typeof LifecycleStateSchema>;

export const ApprovedPageSchema = z.object({
  id: z.number().int().nullable().optional(),
  memoryId: z.number().int().nullable().optional(),
  conceptId: z.number().int().nullable().optional(),
  relPath: z.string(),
  slug: z.string(),
  kind: z.string(),
  title: z.string(),
  domain: z.string().default(""),
  domains: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  audience: z.array(z.string()).default([]),
  requires: z.array(z.string()).default([]),
  status: PageStatusSchema.default("seedling"),
  lifecycleState: LifecycleStateSchema.default("active"),
  supersedes: z.string().nullable().optional(),
  supersededBy: z.string().nullable().optional(),
  verified: z.string().nullable().optional(),
  lead: z.string(),
  sections: z.array(SectionSchema).default([]),
  bodyHash: z.string().default(""),
  // thermodynamic survival state
  heat: z.number().min(0.0).max(1.0).default(1.0),
  accessCount: z.number().int().default(0),
  citationCount: z.number().int().default(0),
  backlinkCount: z.number().int().default(0),
  isStale: z.boolean().default(false),
  planted: z.string().datetime().nullable().optional(),
  tended: z.string().datetime().nullable().optional(),
});
export type ApprovedPage = z.infer<typeof ApprovedPageSchema>;

// ── Curation memo (Strauss memoing) ─────────────────────────────────────────

export const MemoSubjectSchema = z.enum(["concept", "draft", "page", "claim"]);
export type MemoSubject = z.infer<typeof MemoSubjectSchema>;

export const CurationMemoSchema = z.object({
  id: z.number().int().nullable().optional(),
  subjectType: MemoSubjectSchema,
  subjectId: z.number().int(),
  decision: z.string(),
  rationale: z.string().default(""),
  alternatives: z.array(z.record(z.unknown())).default([]),
  inputs: z.record(z.unknown()).default({}),
  confidence: z.number().min(0.0).max(1.0).default(0.5),
  author: z.string().default("system"),
  createdAt: z.string().datetime().nullable().optional(),
});
export type CurationMemo = z.infer<typeof CurationMemoSchema>;
