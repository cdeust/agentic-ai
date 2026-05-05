/**
 * Sensory buffer — working memory for immediate context (pre-consolidation).
 *
 * Implements a bounded ring buffer for transient content that arrives too fast
 * to individually gate through the write gate. Content accumulates here during
 * a session, then is drained to long-term memory on:
 *   - Explicit drain() call (e.g., at session end)
 *   - Buffer fill (oldest items displaced)
 *   - Importance threshold crossing (item is too important to delay)
 *
 * Analogous to the hippocampal fast-binding system in neuroscience —
 * it holds recent experiences before they're consolidated into cortex.
 *
 * Pure business logic — no I/O. All state is in-process (not persisted).
 *
 * Port of: cortex@ed33435 mcp_server/core/sensory_buffer.py
 *
 * Sources:
 *   Hippocampal fast-binding: O'Keefe & Nadel (1978) "The Hippocampus as
 *   a Cognitive Map." Oxford University Press.
 */

// ── Buffer item ───────────────────────────────────────────────────────────

/**
 * A single item in the sensory buffer.
 *
 * source: cortex@ed33435 mcp_server/core/sensory_buffer.py:29-54
 */
export interface BufferItem {
  content: string;
  tags: string[];
  source: string;
  directory: string;
  domain: string;
  importance: number;
  valence: number;
  createdAt: string;
}

function makeBufferItem(
  content: string,
  tags: string[],
  source: string,
  directory: string,
  domain: string,
  importance: number,
  valence: number,
): BufferItem {
  return {
    content,
    tags,
    source,
    directory,
    domain,
    importance,
    valence,
    createdAt: new Date().toISOString(),
  };
}

function bufferItemToDict(item: BufferItem): Record<string, unknown> {
  return {
    content: item.content,
    tags: item.tags,
    source: item.source,
    directory: item.directory,
    domain: item.domain,
    importance: item.importance,
    valence: item.valence,
    created_at: item.createdAt,
  };
}

// ── Thermodynamics port ───────────────────────────────────────────────────
// Python source delegates to mcp_server.core.thermodynamics.compute_importance
// and compute_valence. We provide a local implementation derived from the
// same heuristics used in the TS port of thermodynamics.

function computeImportanceHeuristic(content: string, tags: string[]): number {
  // source: cortex@ed33435 mcp_server/core/thermodynamics.py — importance heuristics
  let score = 0.5;
  const lower = content.toLowerCase();
  if (/\b(error|exception|crash|fatal|fail(ed|ure)?|critical)\b/.test(lower)) score = Math.min(1.0, score + 0.2);
  if (/\b(decided|decision|important|key|crucial)\b/.test(lower)) score = Math.min(1.0, score + 0.15);
  if (/\b(fixed|resolved|completed|done)\b/.test(lower)) score = Math.min(1.0, score + 0.1);
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  if (tagSet.has("important") || tagSet.has("critical")) score = Math.min(1.0, score + 0.2);
  return score;
}

function computeValenceHeuristic(content: string): number {
  // source: cortex@ed33435 mcp_server/core/thermodynamics.py — valence heuristics
  const lower = content.toLowerCase();
  let v = 0.0;
  if (/\b(error|fail|broken|wrong|bug|crash)\b/.test(lower)) v -= 0.3;
  if (/\b(success|fixed|done|complete|great|good)\b/.test(lower)) v += 0.3;
  return Math.max(-1.0, Math.min(1.0, v));
}

// ── SensoryBuffer ─────────────────────────────────────────────────────────

export interface PushResult {
  buffered: boolean;
  isUrgent: boolean;
  importance: number;
  valence: number;
  bufferSize: number;
  item: Record<string, unknown> | null;
}

/**
 * Bounded working memory buffer.
 *
 * Items are held here until they are consolidated into long-term memory
 * via drain() or forced out by importance threshold.
 *
 * source: cortex@ed33435 mcp_server/core/sensory_buffer.py:59-219
 */
export class SensoryBuffer {
  private readonly _capacity: number;
  private readonly _importanceThreshold: number;
  private _buffer: BufferItem[];
  private _displaced: BufferItem[];

  /**
   * precondition:  capacity > 0; importanceThreshold ∈ (0, 1].
   * postcondition: buffer is empty; capacity and threshold are set.
   *
   * source: cortex@ed33435 mcp_server/core/sensory_buffer.py:74-82
   *   capacity default = 50
   *   importance_threshold default = 0.7
   */
  constructor(capacity = 50, importanceThreshold = 0.7) {
    this._capacity = capacity;
    this._importanceThreshold = importanceThreshold;
    this._buffer = [];
    this._displaced = [];
  }

  // ── Write ────────────────────────────────────────────────────────────

  /** Append item to buffer, tracking any displaced item.
   * source: cortex@ed33435 mcp_server/core/sensory_buffer.py:86-90
   */
  private _appendWithDisplacement(item: BufferItem): void {
    if (this._buffer.length >= this._capacity) {
      const evicted = this._buffer.shift();
      if (evicted) this._displaced.push(evicted);
    }
    this._buffer.push(item);
  }

  /**
   * Add an item to the buffer, computing importance and valence automatically.
   *
   * precondition:  content is non-empty.
   * postcondition: if importance >= threshold, item is NOT buffered (isUrgent=true);
   *   otherwise item is appended; oldest item displaced if buffer was at capacity.
   *   returned object has buffered, isUrgent, importance, valence, bufferSize, item.
   *
   * source: cortex@ed33435 mcp_server/core/sensory_buffer.py:92-126
   */
  push(
    content: string,
    opts: {
      tags?: string[];
      source?: string;
      directory?: string;
      domain?: string;
    } = {},
  ): PushResult {
    const tags = opts.tags ?? [];
    const source = opts.source ?? "buffer";
    const directory = opts.directory ?? "";
    const domain = opts.domain ?? "";

    const importance = computeImportanceHeuristic(content, tags);
    const valence = computeValenceHeuristic(content);

    const item = makeBufferItem(content, tags, source, directory, domain, importance, valence);
    const isUrgent = importance >= this._importanceThreshold;

    if (!isUrgent) {
      this._appendWithDisplacement(item);
    }

    return {
      buffered: !isUrgent,
      isUrgent,
      importance: Math.round(importance * 1e4) / 1e4,
      valence: Math.round(valence * 1e4) / 1e4,
      bufferSize: this._buffer.length,
      item: isUrgent ? bufferItemToDict(item) : null,
    };
  }

  // ── Read ─────────────────────────────────────────────────────────────

  /**
   * Return the n most-recently-added items without removing them.
   *
   * precondition:  n >= 0.
   * postcondition: returned array length <= min(n, bufferSize).
   *
   * source: cortex@ed33435 mcp_server/core/sensory_buffer.py:130-133
   */
  peek(n = 5): BufferItem[] {
    return this._buffer.slice(-n);
  }

  /**
   * Return items above an importance threshold without removing them.
   *
   * precondition:  threshold is a float or null (uses 0.8 * importanceThreshold).
   * postcondition: every returned item has importance >= threshold.
   *
   * source: cortex@ed33435 mcp_server/core/sensory_buffer.py:135-140
   */
  peekImportant(threshold: number | null = null): BufferItem[] {
    const thresh = threshold !== null ? threshold : this._importanceThreshold * 0.8;
    return this._buffer.filter((item) => item.importance >= thresh);
  }

  // ── Drain ────────────────────────────────────────────────────────────

  /**
   * Drain items from the buffer for consolidation into long-term memory.
   *
   * Items are removed from the buffer as they are drained.
   *
   * precondition:  minImportance ∈ [0, 1]; maxItems >= 0 or null (drain all).
   * postcondition: returned items have importance >= minImportance;
   *   sorted most-important first; removed from internal buffer;
   *   returned length <= maxItems if maxItems is specified.
   *
   * source: cortex@ed33435 mcp_server/core/sensory_buffer.py:144-175
   */
  drain(minImportance = 0.0, maxItems: number | null = null): BufferItem[] {
    const qualifying = this._buffer
      .filter((item) => item.importance >= minImportance)
      .sort((a, b) => b.importance - a.importance);

    const toDrain = maxItems !== null ? qualifying.slice(0, maxItems) : qualifying;
    const drainedSet = new Set(toDrain);

    this._buffer = this._buffer.filter((item) => !drainedSet.has(item));
    return toDrain;
  }

  /**
   * Return and clear items that were evicted due to buffer overflow.
   *
   * source: cortex@ed33435 mcp_server/core/sensory_buffer.py:177-181
   */
  drainDisplaced(): BufferItem[] {
    const evicted = [...this._displaced];
    this._displaced = [];
    return evicted;
  }

  /**
   * Drain everything, sorted by importance descending.
   *
   * postcondition: buffer is empty; returned array has all prior items,
   *   sorted most-important first.
   *
   * source: cortex@ed33435 mcp_server/core/sensory_buffer.py:183-187
   */
  drainAll(): BufferItem[] {
    const all = [...this._buffer].sort((a, b) => b.importance - a.importance);
    this._buffer = [];
    return all;
  }

  // ── Stats ────────────────────────────────────────────────────────────

  /** Current number of buffered items. */
  get size(): number { return this._buffer.length; }

  /** True iff buffer has reached capacity. */
  get isFull(): boolean { return this._buffer.length >= this._capacity; }

  /** Maximum items the buffer can hold. */
  get capacity(): number { return this._capacity; }

  /**
   * Return buffer statistics.
   *
   * postcondition: returned object has size, capacity, fillPct,
   *   avgImportance, maxImportance, displacedPending, sources.
   *
   * source: cortex@ed33435 mcp_server/core/sensory_buffer.py:203-219
   */
  stats(): Record<string, unknown> {
    const items = this._buffer;
    const importances = items.map((i) => i.importance);
    const avgImportance = importances.length > 0
      ? importances.reduce((a, b) => a + b, 0) / importances.length
      : 0.0;
    const maxImportance = importances.length > 0 ? Math.max(...importances) : 0.0;
    const sources = [...new Set(items.map((i) => i.source))];

    return {
      size: items.length,
      capacity: this._capacity,
      fill_pct: this._capacity > 0
        ? Math.round((items.length / this._capacity) * 100 * 10) / 10
        : 0,
      avg_importance: Math.round(avgImportance * 1e4) / 1e4,
      max_importance: Math.round(maxImportance * 1e4) / 1e4,
      displaced_pending: this._displaced.length,
      sources,
    };
  }
}

// ── Module-level singleton ────────────────────────────────────────────────
// Shared buffer for the current process lifetime.
// Handlers can import and use this directly.
//
// source: cortex@ed33435 mcp_server/core/sensory_buffer.py:222-245

let _globalBuffer: SensoryBuffer | null = null;

/**
 * Get or create the module-level shared sensory buffer.
 *
 * precondition:  capacity > 0; importanceThreshold ∈ (0, 1].
 * postcondition: returns the same SensoryBuffer instance for the process
 *   lifetime; creates it on first call with given parameters.
 *
 * source: cortex@ed33435 mcp_server/core/sensory_buffer.py:229-239
 */
export function getGlobalBuffer(
  capacity = 50,
  importanceThreshold = 0.7,
): SensoryBuffer {
  if (_globalBuffer === null) {
    _globalBuffer = new SensoryBuffer(capacity, importanceThreshold);
  }
  return _globalBuffer;
}

/**
 * Reset the global buffer (useful for testing).
 *
 * source: cortex@ed33435 mcp_server/core/sensory_buffer.py:242-245
 */
export function resetGlobalBuffer(): void {
  _globalBuffer = null;
}
