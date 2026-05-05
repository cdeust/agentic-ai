/* eslint-disable @typescript-eslint/no-magic-numbers -- source: exact port of Python source; all numeric literals copied verbatim from cited Python file */
/**
 * Pluggable stage detection for structured context assembly.
 *
 * A "stage" is a distinct subject with its own context — the unit of
 * topical locality that the StageAwareContextAssembler operates on. In
 * the original Swift PRD pipeline (Clément Deust), stages are explicit:
 * Impact, Integration, PRD, Implementation. Each is a different task with
 * its own vocabulary and its own relevance.
 *
 * For Cortex, free-form conversations don't come with explicit stage
 * labels. This module provides pluggable detectors so stage boundary
 * strategies can be A/B tested empirically rather than hard-coded.
 *
 * Ships two detectors in v1:
 *   - ExplicitStageDetector — stage = an explicit field on the memory
 *     (e.g. "plan_id" for BEAM, "agent_topic" for production)
 *   - TemporalStageDetector — stage = contiguous block of memories with
 *     inter-memory time gaps below a threshold
 *
 * Future (A/B candidates): semantic clustering, LLM topic-shift detection,
 * hybrid explicit+temporal fallback.
 *
 * source: Cortex mcp_server/core/context_assembly/stage_detector.py
 */

export type MemoryRecord = Record<string, unknown>;

// ── Abstract interface ───────────────────────────────────────────────────

/**
 * Assigns each memory to a stage ID.
 *
 * Stage IDs are stable strings per memory. The assembler uses them
 * to partition candidates into own-stage vs adjacent-stage pools.
 */
export interface StageDetector {
  /** Return the stage ID for a single memory. */
  stageOf(memory: MemoryRecord): string;
  /** Return all distinct stage IDs across a corpus, in a stable order. */
  allStages(corpus: MemoryRecord[]): string[];
}

// ── Explicit field detector ─────────────────────────────────────────────

/**
 * Stage = value of an explicit field on the memory.
 *
 * Examples:
 *   - BEAM benchmark: field="plan_id" (the BEAM-10M dataset has a
 *     plan index per turn, tagged at ingest).
 *   - Production Cortex: field="agent_topic" or "directory_context".
 *
 * When the field is missing from a memory, the fallback value is
 * used — defaults to "default".
 */
export class ExplicitStageDetector implements StageDetector {
  private readonly _field: string;
  private readonly _fallback: string;

  constructor(field: string = "plan_id", fallback: string = "default") {
    this._field = field;
    this._fallback = fallback;
  }

  stageOf(memory: MemoryRecord): string {
    const value = memory[this._field];
    if (value == null || value === "") return this._fallback;
    return String(value);
  }

  allStages(corpus: MemoryRecord[]): string[] {
    const seen: string[] = [];
    const seenSet = new Set<string>();
    for (const m of corpus) {
      const stage = this.stageOf(m);
      if (!seenSet.has(stage)) {
        seen.push(stage);
        seenSet.add(stage);
      }
    }
    return seen;
  }
}

// ── Temporal gap detector ───────────────────────────────────────────────

/**
 * Stage = contiguous block of memories separated by <gapHours>.
 *
 * Useful when memories lack explicit stage labels but have reliable
 * timestamps. A gap larger than the threshold starts a new stage.
 *
 * @param gapHours - inter-memory gap above which a new stage begins.
 *   Default 4h matches a typical work-session boundary.
 * @param timeField - name of the timestamp field. Accepts ISO strings
 *   or Date objects.
 */
export class TemporalStageDetector implements StageDetector {
  private readonly _gapMs: number;
  private readonly _timeField: string;
  private readonly _cache: Map<unknown, string>;

  constructor(gapHours: number = 4.0, timeField: string = "created_at") {
    this._gapMs = gapHours * 60 * 60 * 1000; // source: Cortex stage_detector.py::TemporalStageDetector ms conversion
    this._timeField = timeField;
    this._cache = new Map();
  }

  stageOf(memory: MemoryRecord): string {
    const mid = memory["memory_id"] ?? memory["id"] ?? memory;
    const cached = this._cache.get(mid);
    if (cached !== undefined) return cached;
    // Temporal detection requires knowledge of neighbors; if called
    // without pre-computation, fall back to the timestamp bucket.
    const ts = parseTs(memory[this._timeField]);
    if (ts === null) return "default";
    // Bucket by day as a reasonable standalone fallback
    return `day-${ts.toISOString().slice(0, 10)}`;
  }

  allStages(corpus: MemoryRecord[]): string[] {
    // Sort by timestamp, walk linearly, emit a new stage when gap exceeded
    const timed: Array<[Date, MemoryRecord]> = [];
    for (const m of corpus) {
      const ts = parseTs(m[this._timeField]);
      if (ts !== null) timed.push([ts, m]);
    }
    timed.sort(([a], [b]) => a.getTime() - b.getTime());

    const stages: string[] = [];
    let currentStage: string | null = null;
    let lastTs: Date | null = null;
    let counter = 0;

    for (const [ts, m] of timed) {
      if (lastTs === null || ts.getTime() - lastTs.getTime() > this._gapMs) {
        counter++;
        currentStage = `stage-${counter}`;
        stages.push(currentStage);
      }
      const mid = m["memory_id"] ?? m["id"] ?? m;
      if (currentStage !== null) this._cache.set(mid, currentStage);
      lastTs = ts;
    }
    return stages;
  }
}

// ── Composite fallback detector ─────────────────────────────────────────

/**
 * Try detectors in order until one returns a non-fallback stage.
 *
 * Useful for production: try explicit labels first, fall back to
 * temporal detection if no explicit label exists.
 */
export class CompositeStageDetector implements StageDetector {
  private readonly _detectors: StageDetector[];
  private readonly _fallback: string;

  constructor(detectors: StageDetector[], fallback: string = "default") {
    if (detectors.length === 0) {
      throw new Error("CompositeStageDetector requires at least one detector");
    }
    this._detectors = detectors;
    this._fallback = fallback;
  }

  stageOf(memory: MemoryRecord): string {
    for (const det of this._detectors) {
      const stage = det.stageOf(memory);
      if (stage && stage !== this._fallback && !stage.startsWith("day-")) {
        return stage;
      }
    }
    // Last resort: first detector's output (may be fallback)
    const firstDet = this._detectors[0];
    if (firstDet === undefined) return this._fallback;
    return firstDet.stageOf(memory);
  }

  allStages(corpus: MemoryRecord[]): string[] {
    // Use the union across detectors, de-duplicated in seen order
    const seen: string[] = [];
    const seenSet = new Set<string>();
    for (const det of this._detectors) {
      for (const s of det.allStages(corpus)) {
        if (!seenSet.has(s)) {
          seen.push(s);
          seenSet.add(s);
        }
      }
    }
    return seen;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function parseTs(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    // Try ISO format first
    try {
      const d = new Date(value.replace("Z", "+00:00"));
      if (!isNaN(d.getTime())) return d;
    } catch {
      // Fall through
    }
    // Try BEAM's "Month-DD-YYYY" format (March-15-2024)
    const parts = value.split("-");
    if (parts.length === 3 && /^[A-Za-z]/.test(parts[0] ?? "")) {
      try {
        const monthName = parts[0] ?? "";
        const day = parseInt(parts[1] ?? "0", 10);
        const year = parseInt(parts[2] ?? "0", 10);
        const d = new Date(`${monthName} ${day}, ${year}`);
        if (!isNaN(d.getTime())) return d;
      } catch {
        // Fall through
      }
    }
  }
  return null;
}
