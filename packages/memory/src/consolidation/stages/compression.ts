/**
 * Compression cycle: compress aging memories along the rate-distortion curve.
 *
 * Memories progress through levels: full text (0) -> gist (1) -> tag (2).
 * Protected and semantic memories are skipped.
 *
 * Based on rate-distortion theory — higher fidelity costs more bits;
 * as memories age and lose access heat, fewer bits are worth spending.
 * // source: Toth et al. (PLoS Comp Bio, 2020) — memory fidelity degradation
 * // source: Tishby N et al. (1999) The information bottleneck method.
 *
 * Port of:
 *   mcp_server/handlers/consolidation/compression.py
 *   mcp_server/core/compression.py (inline — no separate TS core file exists)
 */

// ── Regex patterns (from mcp_server/core/compression.py) ─────────────────────

const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const FILE_PATH_RE = /(?:\.{0,2}\/)?(?:[\w@.-]+\/)+[\w@.-]+\.\w+/g;
const ERROR_RE = /\b\w*(?:Error|Exception|Traceback)\b/;
const DECISION_RE =
  /\b(?:decided|chose|choosing|using|switched|migrated|replaced|selected|adopted)\b/i;
const NUMBER_VERSION_RE = /\b\d+(?:\.\d+)+\b/;
const CAMELCASE_RE = /\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g;
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+|\n+/;

// ── Store / Engine interfaces ─────────────────────────────────────────────────

export interface CompressionStore {
  getAllMemoriesForDecay(): Promise<Record<string, unknown>[]>;
  insertArchive(row: Record<string, unknown>): Promise<void>;
  updateMemoryCompression(
    id: number,
    content: string,
    embedding: number[],
    compressionLevel: number,
    opts?: { originalContent?: string },
  ): Promise<void>;
}

export interface CompressionEmbeddingEngine {
  encode(text: string): Promise<number[]>;
}

export interface CompressionSettings {
  COMPRESSION_GIST_AGE_HOURS: number;
  COMPRESSION_TAG_AGE_HOURS: number;
}

export interface CompressionStageResult {
  compressed_to_gist: number;
  compressed_to_tag: number;
  protected_skipped: number;
  semantic_skipped: number;
  rows_scanned: number;
  duration_ms?: number;
}

// ── Core: schedule computation ────────────────────────────────────────────────

/**
 * Parse ingest timestamp for cadence reasoning.
 *
 * Compression cadence asks "has this memory had time to be revisited
 * in MY system" — elapsed time since ingest, NOT since the original event.
 * Backfilled/imported memories carry a backdated created_at (e.g. a 2023
 * conversation imported in 2026); using created_at would compress them on
 * the first consolidation pass, before retrieval ever runs.
 * // source: tasks/e1-v3-locomo-smoke-finding.md
 *
 * Falls back to created_at for legacy rows that predate ingested_at.
 *
 * Precondition: memory is a dict-like object.
 * Postcondition: returns a Date or null.
 */
function parseIngestedAt(memory: Record<string, unknown>): Date | null {
  const raw = (memory["ingested_at"] ?? memory["created_at"]) as string | Date | undefined;
  if (!raw) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  try {
    const dt = new Date(raw);
    return isNaN(dt.getTime()) ? null : dt;
  } catch {
    return null;
  }
}

/**
 * Compute compression resistance multiplier from memory attributes.
 *
 * Precondition: memory carries optional importance, surprise_score, confidence, access_count.
 * Postcondition: returns a float >= 1.0.
 */
function computeResistance(memory: Record<string, unknown>): number {
  let resistance = 1.0;
  if (((memory["importance"] as number | undefined) ?? 0.5) > 0.7) resistance *= 2.0;
  if (((memory["surprise_score"] as number | undefined) ?? 0.0) > 0.6) resistance *= 1.5;
  if (((memory["confidence"] as number | undefined) ?? 1.0) > 0.8) resistance *= 1.3;
  if (((memory["access_count"] as number | undefined) ?? 0) > 10) resistance *= 1.5;
  return resistance;
}

/**
 * Calculate target compression level based on age and importance.
 *
 * Precondition: memory carries ingested_at or created_at; settings has gist/tag age hours.
 * Postcondition: returns 0 (full fidelity), 1 (gist), or 2 (tag).
 */
function getCompressionSchedule(
  memory: Record<string, unknown>,
  gistAgeHours: number,
  tagAgeHours: number,
): number {
  if (memory["is_protected"]) return 0;
  if ((memory["store_type"] as string | undefined) === "semantic") return 0;

  const ingestedAt = parseIngestedAt(memory);
  if (!ingestedAt) return 0;

  const hoursElapsed = (Date.now() - ingestedAt.getTime()) / 3_600_000;
  const resistance = computeResistance(memory);

  if (hoursElapsed < gistAgeHours * resistance) return 0;
  if (hoursElapsed < tagAgeHours * resistance) return 1;
  return 2;
}

// ── Core: sentence utilities ──────────────────────────────────────────────────

function splitSentences(text: string): string[] {
  const raw = text.split(SENTENCE_SPLIT_RE);
  return raw.map((s) => s.trim()).filter((s) => s.length > 0);
}

function scoreSentence(sentence: string): number {
  let score = 0.0;
  if (FILE_PATH_RE.test(sentence)) score += 3.0;
  FILE_PATH_RE.lastIndex = 0;
  if (ERROR_RE.test(sentence)) score += 4.0;
  if (DECISION_RE.test(sentence)) score += 3.0;
  if (NUMBER_VERSION_RE.test(sentence)) score += 2.0;
  if (CAMELCASE_RE.test(sentence)) score += 2.0;
  CAMELCASE_RE.lastIndex = 0;
  if (sentence.includes("`")) score += 2.0;
  return score;
}

function selectGistSentences(
  sentences: string[],
  codeBlocks: string[],
  targetLength: number,
): string[] {
  // Invariant: always include first and last sentence (primacy-recency effect).
  const scored: Array<[number, string, number]> = sentences.map((sent, i) => {
    let score = scoreSentence(sent);
    if (i === 0) score += 10.0; // primacy
    if (i === sentences.length - 1) score += 8.0; // recency
    return [i, sent, score];
  });
  scored.sort((a, b) => b[2] - a[2]);

  const selected = new Set<number>([0, sentences.length - 1]);
  let currentLength = codeBlocks.reduce((s, cb) => s + cb.length, 0);
  for (const [idx, sent] of scored) {
    if (currentLength >= targetLength) break;
    selected.add(idx);
    currentLength += sent.length;
  }

  return [...selected].sort((a, b) => a - b).map((i) => sentences[i]!);
}

// ── Core: gist extraction ─────────────────────────────────────────────────────

/**
 * Extract gist from full content (compression level 1).
 *
 * Strategy:
 *   1. Preserve all code blocks verbatim
 *   2. Score sentences by information density
 *   3. Keep first + last sentences (primacy-recency effect)
 *   4. Target ~30% of original length
 *
 * Precondition: content is a non-empty string.
 * Postcondition: returns a string <= content.length (usually ~30% of original).
 */
function extractGist(content: string, targetRatio = 0.3): string {
  const codeBlocks = content.match(CODE_BLOCK_RE) ?? [];
  CODE_BLOCK_RE.lastIndex = 0;
  const textWithoutCode = content.replace(CODE_BLOCK_RE, "");
  CODE_BLOCK_RE.lastIndex = 0;

  const sentences = splitSentences(textWithoutCode);
  if (!sentences.length) {
    return codeBlocks.length > 0 ? codeBlocks.join("\n\n") : content;
  }

  if (sentences.length <= 3) {
    return [...sentences, ...codeBlocks].join("\n");
  }

  const targetLength = Math.max(content.length * targetRatio, 50);
  const gistSentences = selectGistSentences(sentences, codeBlocks, targetLength);
  return [...gistSentences, ...codeBlocks].join("\n");
}

// ── Core: tag generation ──────────────────────────────────────────────────────

function extractTagEntities(content: string, memory: Record<string, unknown>): string[] {
  const entities = new Set<string>();
  const camelMatches = content.match(CAMELCASE_RE) ?? [];
  CAMELCASE_RE.lastIndex = 0;
  for (const m of camelMatches) entities.add(m);
  const fileMatches = content.match(FILE_PATH_RE) ?? [];
  FILE_PATH_RE.lastIndex = 0;
  for (const m of fileMatches) entities.add(m);

  const memTags = memory["tags"];
  if (Array.isArray(memTags)) {
    for (const t of memTags) {
      if (typeof t === "string") entities.add(t);
    }
  }
  return [...entities].sort().slice(0, 5);
}

function formatCreatedDate(memory: Record<string, unknown>): string {
  const created = memory["created_at"];
  if (!created) return "unknown";
  try {
    const dt = typeof created === "string" ? new Date(created) : (created as Date);
    if (isNaN(dt.getTime())) return String(created).slice(0, 10);
    return dt.toISOString().slice(0, 10);
  } catch {
    return String(created).slice(0, 10);
  }
}

function truncateTagRepr(
  summary: string,
  tagPart: string,
  dateStr: string,
  entityList: string[],
): string {
  let tagRepr = `${summary} | Tags: ${tagPart} | Created: ${dateStr}`;
  if (tagRepr.length > 200) {
    const suffix = ` | Tags: ${tagPart} | Created: ${dateStr}`;
    const available = 200 - suffix.length;
    let s = summary;
    let tp = tagPart;
    if (available > 10) {
      s = summary.slice(0, available - 3) + "...";
    } else {
      s = summary.slice(0, 30) + "...";
      tp = entityList.length > 0 ? entityList.slice(0, 2).join(", ") : "general";
    }
    tagRepr = `${s} | Tags: ${tp} | Created: ${dateStr}`;
  }
  if (tagRepr.length > 200) tagRepr = tagRepr.slice(0, 197) + "...";
  return tagRepr;
}

/**
 * Generate tag representation (compression level 2).
 *
 * Format: "[summary] | Tags: [entities] | Created: [date]"
 * Target: < 200 characters.
 *
 * Precondition: content is a non-empty string; memory carries optional tags/created_at.
 * Postcondition: returns a string <= 200 characters.
 */
function generateTag(content: string, memory: Record<string, unknown>): string {
  const entityList = extractTagEntities(content, memory);
  const sentences = splitSentences(content);
  const summary = sentences[0] ?? content.slice(0, 80);
  const dateStr = formatCreatedDate(memory);
  const tagPart = entityList.length > 0 ? entityList.join(", ") : "general";
  return truncateTagRepr(summary, tagPart, dateStr, entityList);
}

// ── Handler: per-memory compression ──────────────────────────────────────────

/**
 * Compress from full text (level 0) to gist (level 1).
 *
 * Returns the freshly computed (gist, gistEmbedding) so a caller advancing
 * straight to level 2 can reuse them instead of re-encoding.
 *
 * Precondition: mem["content"] is the original full text; mem is at level 0.
 * Postcondition (target_level == 1): memory written at level 1; 1 encode() call.
 * Postcondition (target_level >= 2): caller may pass gist+gistEmb to the tag step;
 *   total encode() calls = 2 (one for gist, one for tag).
 */
async function compressFullToGist(
  store: CompressionStore,
  embeddings: CompressionEmbeddingEngine,
  mem: Record<string, unknown>,
  stats: CompressionStageResult,
): Promise<[string, number[]]> {
  const original = mem["content"] as string;
  const gist = extractGist(original);
  const newEmb = await embeddings.encode(gist);

  await store.insertArchive({
    original_memory_id: mem["id"],
    content: original,
    embedding: mem["embedding"],
    archive_reason: "compression_gist",
  });
  await store.updateMemoryCompression(mem["id"] as number, gist, newEmb, 1, {
    originalContent: original,
  });
  stats.compressed_to_gist++;
  return [gist, newEmb];
}

/**
 * Continue compression from a freshly created gist to tag (level 2).
 *
 * Precondition: either both gist and gistEmb supplied (fast path,
 *   threaded through from compressFullToGist — no re-encode), or neither
 *   supplied (legacy path; recompute gist and encode for archive row).
 *
 * Postcondition — fast path: exactly 1 encode() call here (for the tag).
 *   Gist embedding is reused for archive row (was 3 encodes → now 2).
 * Postcondition — legacy path: 2 encodes (one for gist archive, one for tag).
 */
async function compressToTagFromGist(
  store: CompressionStore,
  embeddings: CompressionEmbeddingEngine,
  mem: Record<string, unknown>,
  stats: CompressionStageResult,
  opts: { gist?: string; gistEmb?: number[] } = {},
): Promise<void> {
  let { gist, gistEmb } = opts;
  if (!gist || !gistEmb) {
    gist = extractGist(mem["content"] as string);
    gistEmb = await embeddings.encode(gist);
  }

  const tag = generateTag(gist, mem);
  const tagEmb = await embeddings.encode(tag);

  await store.insertArchive({
    original_memory_id: mem["id"],
    content: gist,
    embedding: gistEmb,
    archive_reason: "compression_tag",
  });
  await store.updateMemoryCompression(mem["id"] as number, tag, tagEmb, 2);
  stats.compressed_to_tag++;
}

/**
 * Compress from gist (level 1) to tag (level 2).
 *
 * Precondition: mem is already at compression level 1.
 * Postcondition: memory written at level 2; exactly 1 encode() call.
 */
async function compressGistToTag(
  store: CompressionStore,
  embeddings: CompressionEmbeddingEngine,
  mem: Record<string, unknown>,
  stats: CompressionStageResult,
): Promise<void> {
  const tag = generateTag(mem["content"] as string, mem);
  const tagEmb = await embeddings.encode(tag);

  await store.insertArchive({
    original_memory_id: mem["id"],
    content: mem["content"],
    embedding: mem["embedding"],
    archive_reason: "compression_tag",
  });
  await store.updateMemoryCompression(mem["id"] as number, tag, tagEmb, 2);
  stats.compressed_to_tag++;
}

/**
 * Compress a single memory to the target level.
 *
 * Precondition: mem is not protected and not semantic (caller checks this).
 * Postcondition: stats updated; store updated if targetLevel > currentLevel.
 */
async function compressMemory(
  store: CompressionStore,
  settings: CompressionSettings,
  embeddings: CompressionEmbeddingEngine,
  mem: Record<string, unknown>,
  stats: CompressionStageResult,
): Promise<void> {
  const currentLevel = (mem["compression_level"] as number | undefined) ?? 0;
  const targetLevel = getCompressionSchedule(
    mem,
    settings.COMPRESSION_GIST_AGE_HOURS,
    settings.COMPRESSION_TAG_AGE_HOURS,
  );

  if (targetLevel <= currentLevel) return;

  try {
    if (targetLevel >= 1 && currentLevel === 0) {
      const [gist, gistEmb] = await compressFullToGist(store, embeddings, mem, stats);
      if (targetLevel >= 2) {
        await compressToTagFromGist(store, embeddings, mem, stats, { gist, gistEmb });
      }
    } else if (targetLevel >= 2 && currentLevel === 1) {
      await compressGistToTag(store, embeddings, mem, stats);
    }
  } catch {
    // non-fatal: individual compression failure must not block the cycle
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compress aging memories along the rate-distortion curve.
 *
 * `memories` may be pre-loaded by the consolidate handler (issue #13).
 * When null, loads all memories for decay from the store.
 *
 * Precondition: store is a valid CompressionStore; embeddings provides encode().
 * Postcondition: returned stats are non-negative; memories progressed from
 *   level 0 → 1 (gist) or 0 → 2 / 1 → 2 (tag) based on schedule.
 *   Protected and semantic memories are counted in skipped fields.
 */
export async function runCompressionCycle(
  store: CompressionStore,
  settings: CompressionSettings,
  embeddings: CompressionEmbeddingEngine,
  memories: readonly Record<string, unknown>[] | null = null,
): Promise<CompressionStageResult> {
  const mems = memories !== null ? memories : await store.getAllMemoriesForDecay();

  const stats: CompressionStageResult = {
    compressed_to_gist: 0,
    compressed_to_tag: 0,
    protected_skipped: 0,
    semantic_skipped: 0,
    rows_scanned: mems.length,
  };

  for (const mem of mems) {
    if (mem["is_protected"]) {
      stats.protected_skipped++;
      continue;
    }
    if ((mem["store_type"] as string | undefined) === "semantic") {
      stats.semantic_skipped++;
      continue;
    }

    await compressMemory(store, settings, embeddings, mem, stats);
  }

  return stats;
}
