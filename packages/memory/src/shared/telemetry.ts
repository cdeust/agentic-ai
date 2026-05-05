/**
 * Cortex telemetry — lightweight per-process counters for reads + writes.
 *
 * Captures the empirical workload distribution (read/write ratio, latency
 * per op kind, cumulative byte-volume, success/failure split) so the
 * paper's "100x more reads than writes" claim is grounded in measurement,
 * not assertion.
 *
 * Storage: In-memory Map (per process) for fast snapshot/inspection.
 *   JSONL append is omitted in the TS port — the Node.js I/O layer is
 *   not available in all runtime environments. Callers that need durable
 *   telemetry should inject a LogSink.
 *
 * Opt-out: Set CORTEX_TELEMETRY_DISABLED=1 to disable.
 *
 * Pure business logic — no I/O (the optional LogSink is injected, not
 * hardcoded; callers provide it at the composition root).
 *
 * Port of: cortex@ed33435 mcp_server/core/telemetry.py
 */

// ── Counter types ─────────────────────────────────────────────────────────

export interface OpCounters {
  count: number;
  ok: number;
  fail: number;
  bytesIn: number;
  bytesOut: number;
  resultCount: number;
  latencyMsSum: number;
  latencyMsMax: number;
}

export interface RecordParams {
  latencyMs: number;
  bytesIn?: number;
  bytesOut?: number;
  resultCount?: number;
  ok?: boolean;
}

/** Optional sink for durable JSONL append. */
export interface TelemetryLogSink {
  append(line: string): void;
}

// ── Module state ──────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/telemetry.py:52-53
// Single process-level map; no lock needed in single-threaded JS.

const _counters = new Map<string, OpCounters>();
let _logSink: TelemetryLogSink | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────

/** source: cortex@ed33435 mcp_server/core/telemetry.py:56-58 */
function isDisabled(): boolean {
  if (typeof process === "undefined") return false;
  return process.env["CORTEX_TELEMETRY_DISABLED"] === "1";
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Register a log sink for durable JSONL append.
 * source: cortex@ed33435 mcp_server/core/telemetry.py:44 (JSONL path)
 */
export function registerLogSink(sink: TelemetryLogSink): void {
  _logSink = sink;
}

/**
 * Record one operation.
 *
 * precondition:  op is non-empty; latencyMs >= 0.
 * postcondition: counters[op] is updated; one JSONL line is appended to
 *   the log sink if registered; no exception escapes.
 *
 * source: cortex@ed33435 mcp_server/core/telemetry.py:61-116
 */
export function record(op: string, params: RecordParams): void {
  if (isDisabled()) return;

  const {
    latencyMs,
    bytesIn = 0,
    bytesOut = 0,
    resultCount = 0,
    ok = true,
  } = params;

  let c = _counters.get(op);
  if (!c) {
    c = {
      count: 0, ok: 0, fail: 0,
      bytesIn: 0, bytesOut: 0, resultCount: 0,
      latencyMsSum: 0.0, latencyMsMax: 0.0,
    };
    _counters.set(op, c);
  }

  c.count++;
  if (ok) c.ok++; else c.fail++;
  c.bytesIn += bytesIn;
  c.bytesOut += bytesOut;
  c.resultCount += resultCount;
  c.latencyMsSum += latencyMs;
  if (latencyMs > c.latencyMsMax) c.latencyMsMax = latencyMs;

  // Best-effort log sink append — never throws
  try {
    if (_logSink !== null) {
      const line = JSON.stringify({
        ts: Date.now() / 1000,
        op,
        latency_ms: Math.round(latencyMs * 1000) / 1000,
        bytes_in: bytesIn,
        bytes_out: bytesOut,
        result_count: resultCount,
        ok,
      });
      _logSink.append(line);
    }
  } catch { /* best-effort */ }
}

/**
 * Return a deep-enough copy of the current counters for inspection.
 * source: cortex@ed33435 mcp_server/core/telemetry.py:119-122
 */
export function snapshot(): Record<string, OpCounters> {
  const result: Record<string, OpCounters> = {};
  for (const [op, c] of _counters) {
    result[op] = { ...c };
  }
  return result;
}

// ── Read/write op sets ────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/telemetry.py:125-133

const READ_OPS = new Set([
  "recall", "recall_hierarchical", "navigate_memory",
  "get_causal_chain", "drill_down",
]);

const WRITE_OPS = new Set([
  "remember", "forget", "validate_memory", "rate_memory",
]);

/**
 * Compute reads / max(writes, 1) over the current counters.
 *
 * postcondition: returns 0.0 when no writes have been recorded.
 * source: cortex@ed33435 mcp_server/core/telemetry.py:135-145
 */
export function ratioReadsWrites(
  snap: Record<string, OpCounters> | null = null,
): number {
  const s = snap ?? snapshot();
  let reads = 0;
  let writes = 0;
  for (const [op, c] of Object.entries(s)) {
    if (READ_OPS.has(op)) reads += c.count;
    if (WRITE_OPS.has(op)) writes += c.count;
  }
  return reads / Math.max(writes, 1);
}

/**
 * Wipe the in-memory counters. The on-disk JSONL is not touched.
 * source: cortex@ed33435 mcp_server/core/telemetry.py:148-151
 */
export function resetTelemetry(): void {
  _counters.clear();
}

/**
 * Snapshot + computed read/write ratio + per-op average latency.
 * source: cortex@ed33435 mcp_server/core/telemetry.py:154-170
 */
export function summaryTelemetry(): Record<string, unknown> {
  const snap = snapshot();
  const derived: Record<string, Record<string, number>> = {};
  for (const [op, c] of Object.entries(snap)) {
    const count = Math.max(c.count, 1);
    derived[op] = {
      avg_latency_ms: Math.round((c.latencyMsSum / count) * 1000) / 1000,
      max_latency_ms: Math.round(c.latencyMsMax * 1000) / 1000,
    };
  }
  return {
    counters: snap,
    derived,
    ratio_reads_writes: Math.round(ratioReadsWrites(snap) * 1000) / 1000,
    disabled: isDisabled(),
  };
}
