/**
 * Unit tests for internal/serial-queue.ts
 *
 * Verifies:
 *   - FIFO execution order
 *   - Exactly one task in-flight at a time (Dijkstra genius gate)
 *   - Rejection of one task does not prevent subsequent tasks (drain continues)
 *   - Monotonic requestId sequence (Lamport compliance)
 *   - Metrics reflect queue depth accurately
 *
 * source: docs/ADR/0002-analyze-codebase-serial-vs-parallel.md
 * source: docs/PHASE_3_PLAN.md §3.5 — serial FIFO queue; §6.5 — Lamport gate
 */

import { describe, it, expect } from "vitest";
import { SerialQueue } from "../../src/internal/serial-queue.js";

describe("SerialQueue", () => {
  it("executes tasks in FIFO order", async () => {
    const queue = new SerialQueue();
    const log: number[] = [];

    const { result: r1 } = queue.enqueue(async () => {
      log.push(1);
    });
    const { result: r2 } = queue.enqueue(async () => {
      log.push(2);
    });
    const { result: r3 } = queue.enqueue(async () => {
      log.push(3);
    });

    await Promise.all([r1, r2, r3]);
    expect(log).toEqual([1, 2, 3]);
  });

  it("assigns strictly monotonic requestIds", () => {
    const queue = new SerialQueue();
    const ids: number[] = [];

    for (let i = 0; i < 5; i++) {
      const { requestId } = queue.enqueue(async () => undefined);
      ids.push(requestId);
    }

    // ids must be strictly increasing
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBeGreaterThan(ids[i - 1] as number);
    }
  });

  it("provides the requestId to the task function", async () => {
    const queue = new SerialQueue();
    let capturedId: number | null = null;

    const { requestId, result } = queue.enqueue(async (id) => {
      capturedId = id;
    });

    await result;
    expect(capturedId).toBe(requestId);
  });

  it("continues draining after a task rejects", async () => {
    const queue = new SerialQueue();
    const log: string[] = [];

    const { result: r1 } = queue.enqueue(async () => {
      log.push("before-fail");
      throw new Error("intentional failure");
    });
    const { result: r2 } = queue.enqueue(async () => {
      log.push("after-fail");
    });

    await expect(r1).rejects.toThrow("intentional failure");
    await r2;
    expect(log).toEqual(["before-fail", "after-fail"]);
  });

  it("never runs two tasks concurrently (Dijkstra: at-most-one-in-flight)", async () => {
    const queue = new SerialQueue();
    let concurrency = 0;
    let maxConcurrency = 0;

    const tasks = Array.from({ length: 10 }, (_, i) =>
      queue.enqueue(async () => {
        concurrency++;
        maxConcurrency = Math.max(maxConcurrency, concurrency);
        // Yield to give other tasks a chance to run (they shouldn't).
        await new Promise((r) => setTimeout(r, 1));
        concurrency--;
        return i;
      }),
    );

    await Promise.all(tasks.map((t) => t.result));
    expect(maxConcurrency).toBe(1);
  });

  it("reports correct queue depth", async () => {
    const queue = new SerialQueue();

    // Create a barrier so the first task blocks inside the queue.
    let unblock!: () => void;
    const barrier = new Promise<void>((r) => {
      unblock = r;
    });

    // Enqueue blocking task.
    queue.enqueue(async () => {
      await barrier;
    });

    // Enqueue two more tasks while the first is blocking.
    queue.enqueue(async () => undefined);
    queue.enqueue(async () => undefined);

    // Yield to the microtask queue so the first task starts executing
    // (and decrements depth from 3 to 2). After this point the first task
    // is in-flight and blocked on the barrier; the other two are waiting.
    await Promise.resolve();
    await Promise.resolve(); // two yields to ensure the chain starts

    // depth should be 2 (two tasks behind the in-flight one).
    // Note: depth tracks queued-but-not-executing tasks.
    expect(queue.metrics.depth).toBe(2);

    unblock();
    // Let the queue drain.
    await new Promise((r) => setTimeout(r, 20));
    expect(queue.metrics.depth).toBe(0);
  });

  it("Lamport: task results resolve in id order, not clock order", async () => {
    // Stub Date.now to zero — results must still arrive in correct order.
    const realDateNow = Date.now;
    Date.now = () => 0;

    const queue = new SerialQueue();
    const resolved: number[] = [];

    const tasks = [1, 2, 3, 4, 5].map((n) =>
      queue.enqueue(async (id) => {
        resolved.push(id);
        return n;
      }),
    );

    await Promise.all(tasks.map((t) => t.result));
    // Ids must be in sorted order regardless of Date.now.
    expect(resolved).toEqual([...resolved].sort((a, b) => a - b));

    Date.now = realDateNow;
  });
});
