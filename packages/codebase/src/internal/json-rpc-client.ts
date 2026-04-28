/**
 * @agentic/codebase — internal/json-rpc-client.ts
 *
 * Newline-delimited JSON-RPC 2.0 client over a ProcessSupervisor's stdio.
 *
 * Dijkstra genius-gate compliance:
 *   - Exactly one request is in-flight at any time (enforced by SerialQueue).
 *   - The line-buffer reader handles partial frames by accumulating in
 *     ProcessSupervisor._stdoutBuffer; each complete line emits one 'line' event.
 *   - No shared state between request and response paths except the
 *     in-flight Map<id, resolver> which is bounded to size 1 by the queue.
 *   - No deadlock possible: every in-flight request has an outer timeout;
 *     the timeout rejects the promise and removes it from the in-flight map.
 *
 * source: docs/PHASE_3_PLAN.md §3.4 — NDJSON framing decision
 * source: docs/PHASE_3_PLAN.md §4.2 — per-method timeout constants
 * source: packages/parity-runner/src/runners/codebase.ts:74-82 — reference impl
 *
 * Layer: infrastructure / internal
 * Allowed imports: @agentic/core errors, ./process-supervisor, ./serial-queue
 */

import {
  CodebaseSubprocessError,
  CodebaseTimeoutError,
} from "@agentic/core";
import type { ProcessSupervisor } from "./process-supervisor.js";
import { SerialQueue, type QueueMetrics } from "./serial-queue.js";

/**
 * Per-method timeout constants.
 *
 * source: docs/PHASE_3_PLAN.md §4.2 — "lspResolve 32 s (ADR-0001),
 *   analyzeCodebase 5 minutes, other Stage-3 tools default to 60 s"
 */
export const METHOD_TIMEOUTS_MS: Readonly<Record<string, number>> = {
  // Stage 0
  health_check: 10_000, // source: docs/PHASE_3_PLAN.md §4.2 — health probe generous bound
  // Stage 3 graph tools
  index_codebase: 300_000,   // source: docs/PHASE_3_PLAN.md §4.2 — 5 min for large repos
  query_graph: 60_000,       // source: docs/PHASE_3_PLAN.md §4.2 — default 60 s
  get_symbol: 60_000,        // source: docs/PHASE_3_PLAN.md §4.2 — default 60 s
  resolve_graph: 120_000,    // source: docs/PHASE_3_PLAN.md §4.2 — double default for resolver
  cluster_graph: 120_000,    // source: docs/PHASE_3_PLAN.md §4.2 — double default for Louvain
  get_processes: 60_000,     // source: docs/PHASE_3_PLAN.md §4.2 — default 60 s
  get_impact: 60_000,        // source: docs/PHASE_3_PLAN.md §4.2 — default 60 s
  search_codebase: 60_000,   // source: docs/PHASE_3_PLAN.md §4.2 — default 60 s
  get_context: 60_000,       // source: docs/PHASE_3_PLAN.md §4.2 — default 60 s
  analyze_codebase: 300_000, // source: docs/PHASE_3_PLAN.md §4.2 — composite, 5 min
  lsp_resolve: 32_000,       // source: docs/PHASE_3_PLAN.md §4.2 — LSP_TIMEOUT_MS=30_000 + 2_000 overhead
} as const;

// source: docs/PHASE_3_PLAN.md §4.2 — default 60 s for unlisted tools
const DEFAULT_TIMEOUT_MS = 60_000;

/** Max chars to log from a malformed stdout line; truncates runaway output. */
const LOG_TRUNCATE_CHARS = 200; // source: arbitrary diagnostic truncation — enough for a readable error

/**
 * JSON-RPC 2.0 success response shape.
 * source: docs/PHASE_3_PLAN.md §1.6 — Response shape (success)
 */
interface JsonRpcSuccess {
  readonly jsonrpc: "2.0";
  readonly id: number;
  readonly result: unknown;
}

/**
 * JSON-RPC 2.0 error response shape.
 * source: docs/PHASE_3_PLAN.md §1.6 — Response shape (error)
 */
interface JsonRpcError {
  readonly jsonrpc: "2.0";
  readonly id: number;
  readonly error: {
    readonly code: number;
    readonly message: string;
  };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

/**
 * Pending call state: the resolver/rejecter pair waiting for the response.
 *
 * Bounded to size 1 by the SerialQueue — only one call is ever in-flight.
 */
interface PendingCall {
  resolve: (result: unknown) => void;
  reject: (reason: unknown) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
  method: string;
  timeoutMs: number;
}

/**
 * JsonRpcClient wraps a ProcessSupervisor and a SerialQueue to provide
 * typed, timeout-guarded, one-at-a-time JSON-RPC calls.
 *
 * Class invariant:
 *   - _pending is empty when no call is in-flight.
 *   - _pending has exactly one entry when a call is executing.
 *   - The queue ensures no two entries are ever in _pending simultaneously.
 */
export class JsonRpcClient {
  private readonly _queue = new SerialQueue();
  // invariant: size is 0 or 1; enforced by SerialQueue
  private readonly _pending = new Map<number, PendingCall>();

  constructor(private readonly _supervisor: ProcessSupervisor) {
    // Bind the response listener once.
    this._supervisor.on("line", (line: string) => {
      this._handleLine(line);
    });
  }

  /**
   * Send a JSON-RPC call and return the raw result (before envelope unwrap).
   *
   * precondition: method is a non-empty string; params is a plain object
   * postcondition: returns the result field of the JSON-RPC success response;
   *   throws CodebaseSubprocessError on JSON-RPC error response;
   *   throws CodebaseTimeoutError if no response arrives within timeoutMs
   *
   * Lamport compliance: the requestId is the Lamport clock for this call; the
   * Rust child echoes it back; we match by id, not by wall-clock.
   *
   * source: docs/PHASE_3_PLAN.md §3.5 — monotonic sequence number / Lamport clock
   */
  async call(method: string, params: Record<string, unknown>): Promise<unknown> {
    const timeoutMs = METHOD_TIMEOUTS_MS[method] ?? DEFAULT_TIMEOUT_MS;

    const { requestId, result } = this._queue.enqueue(async (id) => {
      return await new Promise<unknown>((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          this._pending.delete(id);
          reject(new CodebaseTimeoutError(method, timeoutMs));
        }, timeoutMs);

        this._pending.set(id, {
          resolve,
          reject,
          timeoutHandle,
          method,
          timeoutMs,
        });

        // Send request.
        const request = JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: {
            name: method,
            arguments: params,
          },
        });

        try {
          this._supervisor.send(request);
        } catch (err) {
          clearTimeout(timeoutHandle);
          this._pending.delete(id);
          reject(err);
        }
      });
    });

    // Suppress "unused variable" — requestId is embedded in the closure above.
    void requestId;
    return result;
  }

  /** Queue telemetry passthrough. */
  get metrics(): QueueMetrics {
    return this._queue.metrics;
  }

  /**
   * Handle a single line from the child's stdout.
   *
   * precondition: line is a complete (non-partial) JSON-RPC response line
   * postcondition: the corresponding pending call is resolved or rejected;
   *   _pending is reduced by one
   */
  private _handleLine(line: string): void {
    let parsed: JsonRpcResponse;
    try {
      parsed = JSON.parse(line) as JsonRpcResponse;
    } catch {
      // Malformed line — log to stderr and skip. Do not crash the listener.
      process.stderr.write(
        `[codebase:rpc] malformed stdout line from binary: ${line.slice(0, LOG_TRUNCATE_CHARS)}\n`,
      );
      return;
    }

    const id = parsed.id;
    const pending = this._pending.get(id);
    if (pending === undefined) {
      // Response for an unknown id (or after timeout). Safe to ignore.
      process.stderr.write(
        `[codebase:rpc] received response for unknown id=${String(id)}\n`,
      );
      return;
    }

    clearTimeout(pending.timeoutHandle);
    this._pending.delete(id);

    if ("error" in parsed) {
      pending.reject(
        new CodebaseSubprocessError(
          parsed.error.message,
          parsed.error.code,
        ),
      );
    } else {
      pending.resolve(parsed.result);
    }
  }
}
