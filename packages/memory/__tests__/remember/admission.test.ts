/**
 * Tests for admission.ts (+ latency_class.ts)
 *
 * source: cortex@ed33435 mcp_server/handlers/admission.py
 * source: cortex@ed33435 mcp_server/handlers/latency_class.py
 *
 * Invariants tested:
 *   1. classify — 'recall' is interactive
 *   2. classify — 'consolidate' is batch
 *   3. classify — unknown batch-marker tools are batch
 *   4. classify — unknown non-marker tools are interactive
 *   5. budgetFor — 'recall' has override of 8
 *   6. budgetFor — default interactive = 4
 *   7. admit — allows concurrent acquisitions up to budget
 *   8. resetSemaphores — clears the cache
 *   9. allRegisteredTools — returns non-empty sorted array
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  classify,
  budgetFor,
  admit,
  resetSemaphores,
  allRegisteredTools,
  DEFAULT_SEMAPHORE,
} from "../../src/remember/handlers/admission.js";

afterEach(() => {
  resetSemaphores();
});

// ── Test 1-4: classify ────────────────────────────────────────────────────

describe("classify", () => {
  it("'recall' is interactive", () => {
    expect(classify("recall")).toBe("interactive");
  });
  it("'consolidate' is batch", () => {
    expect(classify("consolidate")).toBe("batch");
  });
  it("unknown tool with 'ingest' in name is batch", () => {
    expect(classify("ingest_my_stuff")).toBe("batch");
  });
  it("unknown tool without batch markers is interactive", () => {
    expect(classify("my_new_tool")).toBe("interactive");
  });
  it("'wiki_reindex' is batch", () => {
    expect(classify("wiki_reindex")).toBe("batch");
  });
  it("'remember' is interactive", () => {
    expect(classify("remember")).toBe("interactive");
  });
});

// ── Test 5-6: budgetFor ───────────────────────────────────────────────────

describe("budgetFor", () => {
  it("'recall' has override of 8", () => {
    expect(budgetFor("recall")).toBe(8);
  });
  it("unlisted interactive tool defaults to 4", () => {
    expect(budgetFor("my_interactive_tool")).toBe(DEFAULT_SEMAPHORE.interactive);
  });
  it("batch tool defaults to 1", () => {
    expect(budgetFor("consolidate")).toBe(DEFAULT_SEMAPHORE.batch);
  });
});

// ── Test 7: admit concurrency budget ─────────────────────────────────────

describe("admit", () => {
  it("allows N concurrent acquisitions up to budget", async () => {
    // 'my_test_tool' is unlisted → interactive → budget=4
    const tool = "my_test_tool_concurrent";
    const budget = budgetFor(tool);
    // Acquire budget slots simultaneously
    const releases = await Promise.all(
      Array.from({ length: budget }, () => admit(tool)),
    );
    // All should be resolved (not blocked)
    expect(releases).toHaveLength(budget);
    // Release all
    for (const release of releases) release();
  });

  it("blocks when budget exceeded and unblocks on release", async () => {
    const tool = "my_blocking_tool";
    const budget = budgetFor(tool); // 4 for interactive

    const releases: Array<() => void> = [];
    for (let i = 0; i < budget; i++) {
      const release = await admit(tool);
      releases.push(release);
    }

    // Next acquire must block — wrap in race with timeout
    let blocked = true;
    const blockedPromise = admit(tool).then((r) => {
      blocked = false;
      r();
    });

    // Give it a tick to try to acquire
    await new Promise((r) => setTimeout(r, 5));
    expect(blocked).toBe(true);

    // Release one — the blocked acquire should proceed
    const first = releases.shift();
    if (first) first();

    await blockedPromise;
    expect(blocked).toBe(false);

    for (const r of releases) r();
  });
});

// ── Test 8: resetSemaphores ───────────────────────────────────────────────

describe("resetSemaphores", () => {
  it("clearing semaphores allows fresh state on next acquire", async () => {
    // Saturate a tool
    const tool = "my_reset_tool";
    const budget = budgetFor(tool);
    const releases: Array<() => void> = [];
    for (let i = 0; i < budget; i++) {
      releases.push(await admit(tool));
    }
    // Reset (drops the saturated semaphore)
    resetSemaphores();
    // New admits should work immediately (fresh semaphore)
    const r = await admit(tool);
    expect(r).toBeDefined();
    r();
    for (const rel of releases) rel();
  });
});

// ── Test 9: allRegisteredTools ────────────────────────────────────────────

describe("allRegisteredTools", () => {
  it("returns a non-empty sorted array", () => {
    const tools = allRegisteredTools();
    expect(tools.length).toBeGreaterThan(0);
    const sorted = [...tools].sort();
    expect(tools).toEqual(sorted);
  });

  it("includes 'recall' and 'consolidate'", () => {
    const tools = allRegisteredTools();
    expect(tools).toContain("recall");
    expect(tools).toContain("consolidate");
  });
});
