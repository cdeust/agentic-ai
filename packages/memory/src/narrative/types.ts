/**
 * Narrative subsystem — type contracts.
 *
 * Structural grammar note (Propp / narrative-function semantics):
 * A narrative is not free-form prose — it is a finite set of typed
 * structural functions (Orientation, Complication, Resolution) occurring
 * in a constrained order.  The NarrativeArc type makes this grammar
 * explicit.  Surface prose is ornament; the function sequence is
 * load-bearing.
 *
 * // source: Propp, V. (1928/1968). Morphology of the Folktale, Ch. 3
 *            (function extraction) and Ch. 9 (the tale schema).
 * // source: Bruner, J. (1990). Acts of Meaning, Ch. 3 — narrative mode
 *            vs. paradigmatic mode of thought; narrative requires
 *            canonicity violation (complication) to be worth telling.
 */

import { z } from "zod";

// ── Primitive building blocks ─────────────────────────────────────────────

/**
 * A raw memory record as returned by the memory store.
 * Matches the Python dict shape used throughout core/narrative.py and
 * the MemoryStore.get_memories_for_directory / get_hot_memories responses.
 */
export const MemoryRecordSchema = z.object({
  content: z.string(),
  tags: z.union([z.array(z.string()), z.string()]).default([]),
  importance: z.number().min(0).max(1).default(0.5),
  heat: z.number().min(0).max(1).default(0),
  timestamp: z.string().default(""),
  session_id: z.string().default(""),
});

export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;

// ── Session extraction ────────────────────────────────────────────────────

/**
 * A single JSONL conversation record from a Claude session transcript.
 * session_extractor.py operates over lists of these.
 */
export const SessionRecordSchema = z.object({
  type: z.enum(["user", "assistant", "system"]).optional(),
  sessionId: z.string().optional(),
  cwd: z.string().optional(),
  timestamp: z.string().optional(),
  isMeta: z.boolean().optional(),
  toolUseResult: z.unknown().optional(),
  message: z
    .object({
      content: z.union([
        z.string(),
        z.array(
          z.object({
            type: z.string(),
            text: z.string().optional(),
            name: z.string().optional(),
          })
        ),
      ]).optional(),
    })
    .optional(),
});

export type SessionRecord = z.infer<typeof SessionRecordSchema>;

/**
 * A classified, importance-scored message ready for memory storage.
 * Output of session_extractor.extract_memorable_items.
 */
export const MemorableItemSchema = z.object({
  content: z.string(),
  tags: z.array(z.string()),
  importance: z.number().min(0).max(1),
  timestamp: z.string(),
  session_id: z.string(),
});

export type MemorableItem = z.infer<typeof MemorableItemSchema>;

/**
 * Session-level summary.
 * Output of session_extractor.extract_session_summary.
 */
export const SessionSummarySchema = z.object({
  session_id: z.string(),
  cwd: z.string(),
  first_message: z.string(),
  user_count: z.number().int().nonnegative(),
  tools_used: z.array(z.string()),
  start_time: z.string(),
  end_time: z.string(),
});

export type SessionSummary = z.infer<typeof SessionSummarySchema>;

// ── Narrative arc (Proppian structural grammar) ───────────────────────────

/**
 * The three canonical narrative-arc functions.
 *
 * These are typed structural functions — not content categories.
 * "Orientation" is whatever establishes the current state (who, what,
 * where in the project).  "Complication" is the canonicity violation
 * (bug, decision forced, unexpected constraint).  "Resolution" is the
 * restoration of equilibrium (fix applied, decision made, feature done).
 *
 * A valid arc must have Orientation → Complication → Resolution in that
 * order, but any of the three may be absent in a given set of memories
 * (degenerate arc — still structurally informative as a gap).
 *
 * // source: Propp 1928/1968 — functions follow a grammar; absent
 *            functions define tale subtypes (Ch. 4 assimilation).
 * // source: Labov, W. & Waletzky, J. (1967). "Narrative Analysis."
 *            Essays on the Verbal and Visual Arts — orientation,
 *            complication, resolution as the minimal narrative clause
 *            sequence in oral narratives.
 */
export const NarrativeFunctionTypeSchema = z.enum([
  "orientation",
  "complication",
  "resolution",
]);

export type NarrativeFunctionType = z.infer<typeof NarrativeFunctionTypeSchema>;

export const NarrativeFunctionSchema = z.object({
  /** Structural function type — what this step DOES in the arc. */
  type: NarrativeFunctionTypeSchema,
  /** The memory items that realise this function. */
  items: z.array(z.string()),
  /** Whether this function was derived from explicit signal or inferred. */
  inferred: z.boolean().default(false),
});

export type NarrativeFunction = z.infer<typeof NarrativeFunctionSchema>;

/**
 * A complete structural narrative arc over a set of memories.
 * Absent functions are represented as undefined — the caller must
 * treat absence as a structural gap, not an error.
 */
export const NarrativeArcSchema = z.object({
  orientation: NarrativeFunctionSchema.optional(),
  complication: NarrativeFunctionSchema.optional(),
  resolution: NarrativeFunctionSchema.optional(),
});

export type NarrativeArc = z.infer<typeof NarrativeArcSchema>;

// ── Handler request / response ────────────────────────────────────────────

export const NarrativeRequestSchema = z.object({
  /** Absolute project directory to narrate. Mutually exclusive with domain. */
  directory: z.string().optional(),
  /** Domain identifier (e.g. 'cortex', 'auth-service'). */
  domain: z.string().optional(),
  /**
   * If true, return a one-paragraph executive summary instead of the
   * full multi-section narrative.
   */
  brief: z.boolean().default(false),
});

export type NarrativeRequest = z.infer<typeof NarrativeRequestSchema>;

export const NarrativeResponseSchema = z.object({
  /** Full formatted narrative string (absent when brief=true). */
  narrative: z.string().optional(),
  /** One-paragraph brief summary (present when brief=true). */
  summary: z.string().optional(),
  /** Extracted decision statements. */
  decisions: z.array(z.string()).default([]),
  /** Extracted event statements. */
  events: z.array(z.string()).default([]),
  /** Top entity names by frequency. */
  entities: z.array(z.string()).default([]),
  /** High-heat focus topics. */
  topics: z.array(z.string()).default([]),
  /** Structural narrative arc (Proppian function sequence). */
  arc: NarrativeArcSchema.optional(),
  /** Total memories analysed. */
  memory_count: z.number().int().nonnegative(),
});

export type NarrativeResponse = z.infer<typeof NarrativeResponseSchema>;

// ── Session event (used by arc-detection tests) ──────────────────────────

/**
 * A lightweight typed event extracted from session history for arc
 * detection.  The arc-detector operates over these rather than raw
 * MemoryRecords so the detection logic stays pure and testable.
 */
export const SessionEventSchema = z.object({
  id: z.string(),
  type: NarrativeFunctionTypeSchema,
  content: z.string(),
  importance: z.number().min(0).max(1).default(0.5),
  timestamp: z.string().default(""),
});

export type SessionEvent = z.infer<typeof SessionEventSchema>;
