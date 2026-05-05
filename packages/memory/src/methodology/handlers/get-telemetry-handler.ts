/**
 * Handler: get_telemetry — return in-process telemetry counters.
 *
 * Surfaces the read/write workload distribution: per-op call count,
 * latency (sum/avg/max), byte volume, success/failure split, and the
 * computed read/write ratio. This grounds the paper's "100x more reads
 * than writes" claim in measurement (Popper C6).
 *
 * Port of: mcp_server/handlers/get_telemetry.py
 * source: cortex@ed33435 mcp_server/handlers/get_telemetry.py
 */

import { READ_ONLY } from "../../shared/tool-meta.js";

// ── Types ─────────────────────────────────────────────────────────────────

export interface OpCounter {
  count: number;
  ok: number;
  fail: number;
  bytes_in: number;
  bytes_out: number;
  result_count: number;
  latency_ms_sum: number;
  latency_ms_max: number;
}

export interface TelemetrySummary {
  counters: Record<string, OpCounter>;
  derived: Record<string, { avg_latency_ms: number; max_latency_ms: number }>;
  ratio_reads_writes: number;
  log_path: string;
  disabled: boolean;
}

export interface TelemetrySource {
  summary(): TelemetrySummary;
}

// ── Schema ─────────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/get_telemetry.py:22

export const schema = {
  title: "Get Telemetry (read/write counters)",
  annotations: READ_ONLY,
  outputSchema: {
    type: "object",
    required: ["counters", "ratio_reads_writes"],
    properties: {
      counters: {
        type: "object",
        description:
          "Per-op counter map. Key is the canonical op name " +
          "(recall, remember, forget, ...); value is " +
          "{count, ok, fail, bytes_in, bytes_out, " +
          "result_count, latency_ms_sum, latency_ms_max}.",
      },
      derived: {
        type: "object",
        description: "Per-op derived stats: avg_latency_ms, max_latency_ms.",
      },
      ratio_reads_writes: {
        type: "number",
        description:
          "reads / max(writes, 1). Reads = recall, " +
          "recall_hierarchical, navigate_memory, " +
          "get_causal_chain, drill_down. Writes = remember, " +
          "forget, validate_memory, rate_memory.",
      },
      log_path: {
        type: "string",
        description: "Absolute path to the JSONL audit log.",
      },
      disabled: {
        type: "boolean",
        description: "True if CORTEX_TELEMETRY_DISABLED=1 was set.",
      },
    },
  },
  description:
    "Return the in-process telemetry snapshot: per-op call counts, " +
    "latency, byte volume, success/failure split, and the computed " +
    "read/write ratio. Use this to verify Cortex's empirical " +
    "read/write workload distribution (Popper C6 — grounds the " +
    "paper's '100x more reads than writes' claim in measurement, " +
    "not assertion). Counters are per-process and reset on restart; " +
    "the durable record is the JSONL at " +
    "~/.claude/methodology/telemetry.jsonl.",
  inputSchema: { type: "object", properties: {} },
} as const;

// ── Handler ────────────────────────────────────────────────────────────────

/**
 * Return current telemetry summary.
 *
 * precondition: none (read-only over in-memory dict).
 * postcondition: returns telemetry.summary() verbatim.
 *
 * Port of: mcp_server/handlers/get_telemetry.py::handler
 * source: cortex@ed33435 mcp_server/handlers/get_telemetry.py:78
 */
export async function handler(
  _args: Record<string, unknown> | null | undefined,
  telemetry: TelemetrySource,
): Promise<TelemetrySummary> {
  return telemetry.summary();
}
