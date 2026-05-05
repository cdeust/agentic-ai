/**
 * Metacognition analysis — coverage computation, chunking, and context management.
 *
 * Implements:
 *   - Coverage assessment: 4-signal weighted analysis (density, entity, recency, confidence)
 *   - Gap detection support: Jaccard-based chunking + temporal proximity
 *   - Cognitive load management: Cowan's 4±1 chunk limit with primacy-recency positioning
 *
 * Pure business logic — no I/O.
 *
 * source: cortex@ed33435 mcp_server/core/metacognition_analysis.py
 */

// ── Coverage Assessment ───────────────────────────────────────────────────────

/**
 * Density thresholds: (min_count, score).
 * source: cortex@ed33435 mcp_server/core/metacognition_analysis.py:13
 */
const DENSITY_THRESHOLDS: Array<[number, number]> = [
  [6, 0.9],
  [3, 0.6],
  [1, 0.3],
];

/**
 * Recency thresholds in milliseconds: (max_age_ms, score).
 * source: cortex@ed33435 mcp_server/core/metacognition_analysis.py:14-18
 */
const RECENCY_THRESHOLDS_MS: Array<[number, number]> = [
  [1 * 24 * 3600 * 1000, 1.0],   // 1 day
  [7 * 24 * 3600 * 1000, 0.7],   // 7 days
  [30 * 24 * 3600 * 1000, 0.4],  // 30 days
];

/**
 * Default recency score when memory is older than all thresholds.
 * source: cortex@ed33435 mcp_server/core/metacognition_analysis.py:19
 */
const RECENCY_DEFAULT = 0.2;

/**
 * Cowan's 4±1 chunk limit — default max chunks for context management.
 * source: cortex@ed33435 mcp_server/core/metacognition_analysis.py:184
 */
export const DEFAULT_MAX_CHUNKS = 5;

// ── Coverage computation ──────────────────────────────────────────────────────

function computeDensity(matchingCount: number): number {
  for (const [threshold, score] of DENSITY_THRESHOLDS) {
    if (matchingCount >= threshold) return score;
  }
  return 0;
}

function computeRecency(newestAgeMs: number | null): number {
  if (newestAgeMs === null) return 0;
  for (const [maxAgeMs, score] of RECENCY_THRESHOLDS_MS) {
    if (newestAgeMs <= maxAgeMs) return score;
  }
  return RECENCY_DEFAULT;
}

function classifyCoverage(score: number): "sufficient" | "partial" | "insufficient" {
  if (score >= 0.7) return "sufficient";
  if (score >= 0.4) return "partial";
  return "insufficient";
}

export interface CoverageResult {
  coverage: number;
  density: number;
  entity_coverage: number;
  recency: number;
  confidence: number;
  suggestion: "sufficient" | "partial" | "insufficient";
  memory_count: number;
}

/**
 * Compute 4-signal weighted coverage score.
 *
 * Signals: density (from count), entity_coverage, recency, confidence.
 * Default weights: (0.3, 0.3, 0.2, 0.2).
 *
 * precondition: weights sum to 1.0; entityCoverage in [0, 1]; avgConfidence in [0, 1]
 * postcondition: coverage in [0, 1]; suggestion is one of sufficient/partial/insufficient
 *
 * source: cortex@ed33435 mcp_server/core/metacognition_analysis.py:49-77
 */
export function computeCoverage(
  matchingCount: number,
  entityCoverage: number,
  newestAgeMs: number | null,
  avgConfidence: number,
  weights: [number, number, number, number] = [0.3, 0.3, 0.2, 0.2],
): CoverageResult {
  const density = computeDensity(matchingCount);
  const recency = computeRecency(newestAgeMs);

  const [wD, wE, wR, wC] = weights;
  const overall =
    wD * density + wE * entityCoverage + wR * recency + wC * avgConfidence;

  return {
    coverage: Math.round(overall * 1000) / 1000,
    density: Math.round(density * 1000) / 1000,
    entity_coverage: Math.round(entityCoverage * 1000) / 1000,
    recency: Math.round(recency * 1000) / 1000,
    confidence: Math.round(avgConfidence * 1000) / 1000,
    suggestion: classifyCoverage(overall),
    memory_count: matchingCount,
  };
}

// ── Chunking Helpers ──────────────────────────────────────────────────────────

export interface ChunkableMemory {
  tags?: string | string[];
  created_at?: string;
  last_accessed?: string;
  importance?: number;
  heat?: number;
  confidence?: number;
  content?: string;
  surprise?: number;
  [key: string]: unknown;
}

function getEntities(mem: ChunkableMemory): Set<string> {
  const tags = mem.tags ?? [];
  const arr = typeof tags === "string" ? tags.split(",") : tags;
  return new Set(arr.map((t) => t.trim().toLowerCase()).filter(Boolean));
}

function getTimeMs(mem: ChunkableMemory): number | null {
  const ts = mem.created_at ?? mem.last_accessed;
  if (typeof ts !== "string") return null;
  try {
    const dt = new Date(ts.replace("Z", "+00:00"));
    return isNaN(dt.getTime()) ? null : dt.getTime();
  } catch {
    return null;
  }
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) {
    if (b.has(x)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function shouldJoinChunk(
  memI: ChunkableMemory,
  memJ: ChunkableMemory,
  entsI: Set<string>,
  timeI: number | null,
  entityOverlapThreshold: number,
  windowMs: number,
): boolean {
  const entsJ = getEntities(memJ);
  if (jaccard(entsI, entsJ) >= entityOverlapThreshold) return true;

  const timeJ = getTimeMs(memJ);
  if (timeI !== null && timeJ !== null && Math.abs(timeI - timeJ) <= windowMs) return true;

  return false;
}

/**
 * Group memories into chunks by entity overlap or temporal proximity.
 *
 * Two memories join the same chunk if:
 *   - Jaccard similarity of their entity sets >= entityOverlapThreshold, OR
 *   - They were created within temporalWindowHours of each other
 *
 * precondition: memories is non-empty
 * postcondition: every memory appears in exactly one chunk
 *
 * source: cortex@ed33435 mcp_server/core/metacognition_analysis.py:152-179
 */
export function chunkMemories(
  memories: ChunkableMemory[],
  entityOverlapThreshold = 0.3,
  temporalWindowHours = 2.0,
): ChunkableMemory[][] {
  if (memories.length === 0) return [];

  const chunks: ChunkableMemory[][] = [];
  const assigned = new Set<number>();
  const windowMs = temporalWindowHours * 3600 * 1000;

  for (let i = 0; i < memories.length; i++) {
    if (assigned.has(i)) continue;
    assigned.add(i);

    const mem = memories[i]!;
    const entsI = getEntities(mem);
    const timeI = getTimeMs(mem);
    const members: ChunkableMemory[] = [];

    for (let j = i + 1; j < memories.length; j++) {
      if (assigned.has(j)) continue;
      if (shouldJoinChunk(mem, memories[j]!, entsI, timeI, entityOverlapThreshold, windowMs)) {
        members.push(memories[j]!);
        assigned.add(j);
      }
    }

    chunks.push([mem, ...members]);
  }

  return chunks;
}

// ── Context Management ────────────────────────────────────────────────────────

function scoreChunk(chunk: ChunkableMemory[]): number {
  if (chunk.length === 0) return 0;
  const scores = chunk.map(
    (mem) => (mem.importance ?? 0.5) * (mem.heat ?? 0.5) * (mem.confidence ?? 0.5),
  );
  return scores.reduce((s, v) => s + v, 0) / scores.length;
}

function annotateChunk(
  chunk: ChunkableMemory[],
  chunkId: number,
  reason: string,
): ChunkableMemory[] {
  return chunk.map((mem) => ({ ...mem, _chunk_id: chunkId, _position_reason: reason }));
}

function positionSelectedChunks(
  selected: Array<[number, number, ChunkableMemory[]]>,
): ChunkableMemory[] {
  const result: ChunkableMemory[] = [];

  if (selected.length >= 2) {
    const primacy = selected[0]!;
    const recency = selected[1]!;
    const middle = selected.slice(2);

    result.push(...annotateChunk(primacy[2], primacy[0], "primacy"));
    for (const [chunkId, , chunk] of middle) {
      result.push(...annotateChunk(chunk, chunkId, "middle"));
    }
    result.push(...annotateChunk(recency[2], recency[0], "recency"));
  } else if (selected.length === 1) {
    result.push(...annotateChunk(selected[0]![2], selected[0]![0], "primacy"));
  }

  return result;
}

/**
 * Apply cognitive load management with primacy-recency positioning.
 *
 * Algorithm:
 *   1. If memories fit within maxChunks, return with metadata
 *   2. Chunk by entity overlap + temporal proximity
 *   3. Score chunks, take top maxChunks
 *   4. Position: highest-score at start (primacy), second-highest at end (recency)
 *   5. Mark overflow for summarization
 *
 * precondition: memories is non-empty
 * postcondition: every input memory appears in output; _position_reason is set
 *
 * source: cortex@ed33435 mcp_server/core/metacognition_analysis.py:228-261
 */
export function manageContext(
  memories: ChunkableMemory[],
  maxChunks?: number,
): ChunkableMemory[] {
  const limit = maxChunks ?? DEFAULT_MAX_CHUNKS;

  if (memories.length <= limit) {
    return annotateChunk(memories, 0, "within_limit");
  }

  const chunks = chunkMemories(memories);
  const scored: Array<[number, number, ChunkableMemory[]]> = chunks.map((c, i) => [
    i,
    scoreChunk(c),
    c,
  ]);
  scored.sort((a, b) => b[1] - a[1]);

  const selected = scored.slice(0, limit);
  const overflow = scored.slice(limit);

  const result = positionSelectedChunks(selected);

  for (const [chunkId, , chunk] of overflow) {
    result.push(...annotateChunk(chunk, chunkId, "overflow"));
  }

  return result;
}

/**
 * Compress overflow memories, preserving high-value ones.
 *
 * High-surprise or high-importance memories are kept intact.
 * Others are summarized into brief snippets.
 *
 * precondition: excessMemories is non-empty; targetCount >= 1
 * postcondition: result length <= preserved.length + targetCount
 *
 * source: cortex@ed33435 mcp_server/core/metacognition_analysis.py:264-302
 */
export function summarizeOverflow(
  excessMemories: ChunkableMemory[],
  targetCount = 1,
  surpriseThreshold = 0.7,
  importanceThreshold = 0.7,
): ChunkableMemory[] {
  const preserved: ChunkableMemory[] = [];
  const toSummarize: ChunkableMemory[] = [];

  for (const mem of excessMemories) {
    const surprise = mem.surprise ?? 0;
    const importance = mem.importance ?? 0;
    if (surprise >= surpriseThreshold || importance >= importanceThreshold) {
      preserved.push(mem);
    } else {
      toSummarize.push(mem);
    }
  }

  const result = [...preserved];

  if (toSummarize.length > 0 && targetCount > 0) {
    const contents = toSummarize.map((m) => String(m.content ?? "").slice(0, 80));
    let summaryText = contents.join("; ");
    if (summaryText.length > 300) {
      summaryText = summaryText.slice(0, 297) + "...";
    }

    result.push({
      content: `[Summary of ${toSummarize.length} memories] ${summaryText}`,
      heat: Math.max(...toSummarize.map((m) => m.heat ?? 0)),
      importance: Math.max(...toSummarize.map((m) => m.importance ?? 0)),
      _position_reason: "overflow_summary",
    });
  }

  return result;
}
