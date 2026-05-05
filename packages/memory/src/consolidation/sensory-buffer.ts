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
 * Port of: mcp_server/core/sensory_buffer.py
 * source: cortex@ed33435 mcp_server/core/sensory_buffer.py
 */

// ── Buffer item ────────────────────────────────────────────────────────────

export interface BufferItemData {
  content: string;
  tags: string[];
  source: string;
  directory: string;
  domain: string;
  importance: number;
  valence: number;
  created_at: string;
}

export class BufferItem {
  readonly content: string;
  readonly tags: string[];
  readonly source: string;
  readonly directory: string;
  readonly domain: string;
  readonly importance: number;
  readonly valence: number;
  readonly created_at: string;

  constructor(data: Omit<BufferItemData, "created_at"> & { created_at?: string }) {
    this.content = data.content;
    this.tags = data.tags;
    this.source = data.source;
    this.directory = data.directory;
    this.domain = data.domain;
    this.importance = data.importance;
    this.valence = data.valence;
    this.created_at = data.created_at ?? new Date().toISOString();
  }

  toDict(): BufferItemData {
    return {
      content: this.content,
      tags: this.tags,
      source: this.source,
      directory: this.directory,
      domain: this.domain,
      importance: this.importance,
      valence: this.valence,
      created_at: this.created_at,
    };
  }
}

// ── Thermodynamics interface ───────────────────────────────────────────────

export interface ThermodynamicsCompute {
  computeImportance(content: string, tags: string[]): number;
  computeValence(content: string): number;
}

// ── Push result ────────────────────────────────────────────────────────────

export interface PushResult {
  buffered: boolean;
  is_urgent: boolean;
  importance: number;
  valence: number;
  buffer_size: number;
  item: BufferItemData | null;
}

// ── Sensory buffer ─────────────────────────────────────────────────────────

/**
 * Bounded working memory buffer.
 *
 * Items are held here until they are consolidated into long-term memory
 * via drain() or forced out by importance threshold.
 *
 * Port of: mcp_server/core/sensory_buffer.py::SensoryBuffer
 * source: cortex@ed33435 mcp_server/core/sensory_buffer.py:59
 */
export class SensoryBuffer {
  private readonly _buffer: BufferItem[];
  private readonly _capacity: number;
  private readonly _importanceThreshold: number;
  private _displaced: BufferItem[];

  constructor(
    capacity: number = 50, // source: cortex@ed33435 mcp_server/core/sensory_buffer.py:78
    importanceThreshold: number = 0.7, // source: cortex@ed33435 mcp_server/core/sensory_buffer.py:79
  ) {
    this._buffer = [];
    this._capacity = capacity;
    this._importanceThreshold = importanceThreshold;
    this._displaced = [];
  }

  // ── Write ──────────────────────────────────────────────────────────

  /**
   * Append item to buffer, tracking any displaced item.
   * source: cortex@ed33435 mcp_server/core/sensory_buffer.py:86
   */
  private _appendWithDisplacement(item: BufferItem): void {
    if (this._buffer.length >= this._capacity) {
      this._displaced.push(this._buffer.shift()!);
    }
    this._buffer.push(item);
  }

  /**
   * Add an item to the buffer, computing importance and valence automatically.
   *
   * precondition: thermo provides importance/valence computation.
   * postcondition: item buffered when importance < threshold;
   *   urgent items (importance >= threshold) are NOT buffered and flagged.
   *
   * Port of: mcp_server/core/sensory_buffer.py::SensoryBuffer.push
   * source: cortex@ed33435 mcp_server/core/sensory_buffer.py:92
   */
  push(
    content: string,
    opts: {
      tags?: string[];
      source?: string;
      directory?: string;
      domain?: string;
    } = {},
    thermo: ThermodynamicsCompute,
  ): PushResult {
    const tags = opts.tags ?? [];
    const importance = thermo.computeImportance(content, tags);
    const valence = thermo.computeValence(content);

    const item = new BufferItem({
      content,
      tags,
      source: opts.source ?? "buffer",
      directory: opts.directory ?? "",
      domain: opts.domain ?? "",
      importance,
      valence,
    });

    const isUrgent = importance >= this._importanceThreshold;
    if (!isUrgent) {
      this._appendWithDisplacement(item);
    }

    return {
      buffered: !isUrgent,
      is_urgent: isUrgent,
      importance: Math.round(importance * 10000) / 10000,
      valence: Math.round(valence * 10000) / 10000,
      buffer_size: this._buffer.length,
      item: isUrgent ? item.toDict() : null,
    };
  }

  // ── Read ───────────────────────────────────────────────────────────

  /**
   * Return the n most-recently-added items without removing them.
   * Port of: mcp_server/core/sensory_buffer.py::SensoryBuffer.peek
   * source: cortex@ed33435 mcp_server/core/sensory_buffer.py:130
   */
  peek(n: number = 5): BufferItem[] {
    return this._buffer.slice(-n);
  }

  /**
   * Return items above an importance threshold without removing them.
   * Port of: mcp_server/core/sensory_buffer.py::SensoryBuffer.peek_important
   * source: cortex@ed33435 mcp_server/core/sensory_buffer.py:135
   */
  peekImportant(threshold?: number): BufferItem[] {
    const thresh =
      threshold !== undefined
        ? threshold
        : this._importanceThreshold * 0.8; // source: cortex@ed33435 sensory_buffer.py:138
    return this._buffer.filter((item) => item.importance >= thresh);
  }

  // ── Drain ──────────────────────────────────────────────────────────

  /**
   * Drain items from the buffer for consolidation into long-term memory.
   *
   * Items are removed from the buffer as they are drained.
   *
   * precondition: minImportance in [0, 1]; maxItems >= 1 or undefined.
   * postcondition: returns qualifying items sorted importance desc;
   *   drained items removed from buffer.
   *
   * Port of: mcp_server/core/sensory_buffer.py::SensoryBuffer.drain
   * source: cortex@ed33435 mcp_server/core/sensory_buffer.py:144
   */
  drain(minImportance: number = 0.0, maxItems?: number): BufferItem[] {
    const qualifying = this._buffer
      .filter((item) => item.importance >= minImportance)
      .sort((a, b) => b.importance - a.importance);

    const toReturn = maxItems !== undefined ? qualifying.slice(0, maxItems) : qualifying;

    // Remove drained items from buffer
    const drainedSet = new Set<BufferItem>(toReturn);
    const remaining = this._buffer.filter((item) => !drainedSet.has(item));
    this._buffer.length = 0;
    for (const item of remaining) this._buffer.push(item);

    return toReturn;
  }

  /**
   * Return and clear items that were evicted due to buffer overflow.
   * Port of: mcp_server/core/sensory_buffer.py::SensoryBuffer.drain_displaced
   * source: cortex@ed33435 mcp_server/core/sensory_buffer.py:177
   */
  drainDisplaced(): BufferItem[] {
    const evicted = [...this._displaced];
    this._displaced = [];
    return evicted;
  }

  /**
   * Drain everything, sorted by importance descending.
   * Port of: mcp_server/core/sensory_buffer.py::SensoryBuffer.drain_all
   * source: cortex@ed33435 mcp_server/core/sensory_buffer.py:183
   */
  drainAll(): BufferItem[] {
    const allItems = [...this._buffer].sort((a, b) => b.importance - a.importance);
    this._buffer.length = 0;
    return allItems;
  }

  // ── Stats ──────────────────────────────────────────────────────────

  get size(): number {
    return this._buffer.length;
  }

  get isFull(): boolean {
    return this._buffer.length >= this._capacity;
  }

  get capacity(): number {
    return this._capacity;
  }

  /**
   * Return buffer statistics.
   * Port of: mcp_server/core/sensory_buffer.py::SensoryBuffer.stats
   * source: cortex@ed33435 mcp_server/core/sensory_buffer.py:203
   */
  stats(): {
    size: number;
    capacity: number;
    fill_pct: number;
    avg_importance: number;
    max_importance: number;
    displaced_pending: number;
    sources: string[];
  } {
    const importances = this._buffer.map((item) => item.importance);
    return {
      size: this._buffer.length,
      capacity: this._capacity,
      fill_pct:
        this._capacity > 0
          ? Math.round((this._buffer.length / this._capacity) * 100 * 10) / 10
          : 0,
      avg_importance:
        importances.length > 0
          ? Math.round(
              (importances.reduce((s, v) => s + v, 0) / importances.length) * 10000,
            ) / 10000
          : 0,
      max_importance:
        importances.length > 0
          ? Math.round(Math.max(...importances) * 10000) / 10000
          : 0,
      displaced_pending: this._displaced.length,
      sources: [...new Set(this._buffer.map((item) => item.source))],
    };
  }
}

// ── Module-level singleton ────────────────────────────────────────────────

let _globalBuffer: SensoryBuffer | null = null;

/**
 * Get or create the module-level shared sensory buffer.
 * Port of: mcp_server/core/sensory_buffer.py::get_global_buffer
 * source: cortex@ed33435 mcp_server/core/sensory_buffer.py:229
 */
export function getGlobalBuffer(
  capacity: number = 50, // source: cortex@ed33435 sensory_buffer.py:230
  importanceThreshold: number = 0.7, // source: cortex@ed33435 sensory_buffer.py:230
): SensoryBuffer {
  if (_globalBuffer === null) {
    _globalBuffer = new SensoryBuffer(capacity, importanceThreshold);
  }
  return _globalBuffer;
}

/**
 * Reset the global buffer (useful for testing).
 * Port of: mcp_server/core/sensory_buffer.py::reset_global_buffer
 * source: cortex@ed33435 mcp_server/core/sensory_buffer.py:242
 */
export function resetGlobalBuffer(): void {
  _globalBuffer = null;
}
