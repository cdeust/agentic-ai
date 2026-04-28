/**
 * @agentic/codebase — internal/serial-queue.ts
 *
 * FIFO serial queue for JSON-RPC calls to the Rust subprocess.
 *
 * Lamport compliance: ordering is determined by the strict-monotonic request_id
 * sequence, not by wall-clock timestamps. No Date.now() calls.
 *
 * ADR-0002 compliance: all tool calls are serialised through a single FIFO
 * chain. Parallelism on the TS side would gain nothing because the Rust binary
 * serialises at its own RwLock<GraphState> anyway.
 *
 * source: docs/ADR/0002-analyze-codebase-serial-vs-parallel.md
 * source: docs/PHASE_3_PLAN.md §3.5 — serial FIFO queue decision
 *
 * Layer: infrastructure / internal
 * Allowed imports: stdlib only
 */

/**
 * Telemetry snapshot exposed via adapter.metrics().
 * source: docs/PHASE_3_PLAN.md §3.5 — telemetry requirement
 */
export interface QueueMetrics {
  /** Number of calls waiting behind the current in-flight call. */
  readonly depth: number;
  /** Strict-monotonic id of the last issued request. */
  readonly lastRequestId: number;
}

/**
 * SerialQueue — a promise-chained FIFO that enforces at-most-one-in-flight.
 *
 * Class invariant: at any point in time, at most one enqueued call is
 * executing (the one at the head of the chain). All subsequent calls are
 * appended to the tail and execute in strict FIFO order.
 *
 * source: docs/ADR/0002-analyze-codebase-serial-vs-parallel.md §Rationale
 */
export class SerialQueue {
  // invariant: _chain is the tail of the promise sequence; each new enqueue
  // extends it before storing the new tail.
  private _chain: Promise<void> = Promise.resolve();

  // invariant: _depth counts only calls that are queued but not yet executing.
  private _depth = 0;

  // invariant: _nextId is strictly increasing; never decreases; never resets
  // during the lifetime of this queue instance.
  // source: docs/PHASE_3_PLAN.md §3.5 — monotonic sequence number
  private _nextId = 1;

  /**
   * Enqueue a task. The task will execute only after all previously-enqueued
   * tasks have settled (resolved or rejected). Rejection of a prior task does
   * NOT prevent subsequent tasks from executing.
   *
   * precondition: task is a zero-argument async function
   * postcondition: the returned promise resolves/rejects with the same value
   *   as task(); execution order is FIFO with respect to other enqueue() calls
   *
   * @returns A monotonic request_id that can be used to correlate JSON-RPC
   *   request and response. The id is assigned at enqueue time (before the
   *   task executes) so callers can embed it in the outgoing request.
   */
  enqueue<T>(task: (requestId: number) => Promise<T>): {
    requestId: number;
    result: Promise<T>;
  } {
    const requestId = this._nextId++;
    this._depth++;

    let resolveResult!: (value: T | PromiseLike<T>) => void;
    let rejectResult!: (reason: unknown) => void;
    const result = new Promise<T>((res, rej) => {
      resolveResult = res;
      rejectResult = rej;
    });

    // Extend the chain: run after the current tail settles (regardless of
    // whether prior tasks succeeded or failed — the queue must keep draining).
    this._chain = this._chain.then(async () => {
      this._depth--;
      try {
        const value = await task(requestId);
        resolveResult(value);
      } catch (err) {
        rejectResult(err);
      }
    });

    return { requestId, result };
  }

  /**
   * Current queue telemetry.
   * postcondition: returns a snapshot; depth >= 0; lastRequestId >= 1 if any
   *   call has been enqueued.
   */
  get metrics(): QueueMetrics {
    return {
      depth: this._depth,
      lastRequestId: this._nextId - 1,
    };
  }
}
