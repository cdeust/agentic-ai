/**
 * Telemetry wrapping helper for handler entry points.
 *
 * Wrap a handler's handler(args) coroutine with this and the call is
 * timed + recorded against the telemetry counters. Negligible overhead
 * (<1ms measured): one perf_counter pair, one JSON-len, one dispatch
 * to telemetry.record.
 *
 * Port of: mcp_server/handlers/_telemetry_wrap.py
 * source: cortex@ed33435 mcp_server/handlers/_telemetry_wrap.py
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type HandlerFn<A = Record<string, unknown> | null | undefined,
  R = Record<string, unknown>> = (args: A) => Promise<R>;

// ── Telemetry record interface ─────────────────────────────────────────────
// Decoupled from concrete implementation — callers inject a recorder.

export interface TelemetryRecorder {
  record(
    op: string,
    latencyMs: number,
    bytesIn: number,
    resultCount: number,
    ok: boolean,
  ): void;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Return the JSON-serialised byte length of args.
 * source: cortex@ed33435 mcp_server/handlers/_telemetry_wrap.py:27
 */
function safeJsonLen(args: unknown): number {
  if (!args) return 0;
  try {
    return JSON.stringify(args).length;
  } catch {
    return 0;
  }
}

/**
 * Extract a result count from a result dict.
 * source: cortex@ed33435 mcp_server/handlers/_telemetry_wrap.py:36
 */
function resultCount(result: unknown, key: string | null): number {
  if (!result || typeof result !== "object" || key === null) return 0;
  const val = (result as Record<string, unknown>)[key];
  if (Array.isArray(val)) return val.length;
  if (typeof val === "number") return val;
  return 0;
}

// ── Instrument ────────────────────────────────────────────────────────────

/**
 * Return an awaitable wrapper that records telemetry around fn.
 *
 * precondition: fn is an async callable accepting a single args dict
 *   and returning a dict; recorder satisfies TelemetryRecorder.
 * postcondition: every call to the returned wrapper records exactly
 *   one telemetry sample (op, latency_ms, bytes_in, result_count, ok)
 *   and re-raises any exception unchanged after marking ok=false.
 *
 * Port of: mcp_server/handlers/_telemetry_wrap.py::instrument
 * source: cortex@ed33435 mcp_server/handlers/_telemetry_wrap.py:47
 */
export function instrument<A = Record<string, unknown> | null | undefined,
  R extends Record<string, unknown> = Record<string, unknown>>(
  op: string,
  fn: HandlerFn<A, R>,
  recorder: TelemetryRecorder,
  resultCountKey: string | null = null,
): HandlerFn<A, R> {
  return async function wrapped(args: A): Promise<R> {
    const t0 = Date.now();
    let ok = true;
    let result: R = {} as R;
    try {
      result = await fn(args);
      return result;
    } catch (err) {
      ok = false;
      throw err;
    } finally {
      recorder.record(
        op,
        (Date.now() - t0),
        safeJsonLen(args),
        resultCount(result, resultCountKey),
        ok,
      );
    }
  };
}
