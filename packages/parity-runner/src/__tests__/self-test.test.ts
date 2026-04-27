/**
 * @agentic/parity-runner — self-test.test.ts
 *
 * Self-test suite that validates the harness's diff-and-report logic
 * against synthetic mock-binary fixtures WITHOUT requiring any live
 * source-repo binaries (no CORTEX_PYTHON_BIN, AI_ARCH_BIN, PRD_GEN_BIN).
 *
 * Popperian design: these tests are designed to FAIL if the logic is
 * wrong, not to confirm when it happens to pass. Each test targets a
 * specific failure mode:
 *
 *   T1 — SENTINEL_NONDETERMINISTIC is honoured (key present → match)
 *   T2 — SENTINEL_NONDETERMINISTIC on absent key → MISSING_KEY divergence
 *   T3 — bounded assertion passes when value is in range
 *   T4 — bounded assertion fails when value is out of range
 *   T5 — VALUE_MISMATCH detected on differing primitives
 *   T6 — MISSING_KEY detected on absent expected key
 *   T7 — TYPE_MISMATCH detected on type change
 *   T8 — ARRAY_LENGTH_MISMATCH detected
 *   T9 — nested object diff recurses correctly
 *  T10 — _meta keys in input are stripped before dispatch
 *  T11 — TO-BE-CAPTURED shape-only mode validates required keys
 *  T12 — SHAPE-KNOWN-FROM-SOURCE mode performs full assertion
 *  T13 — adversarial probe generator produces exactly PROBES_PER_FIXTURE probes
 *  T14 — adversarial probe generator handles missing primary text field
 *  T15 — buildParityReport sets exit_code=0 on all-match
 *  T16 — buildParityReport sets exit_code=1 on any divergence
 *  T17 — strictExtraKeys: EXTRA_KEY divergence on unexpected key in actual
 *  T18 — metadata keys starting with _ are skipped in comparison
 *  T19 — arrays: element-wise diff surfaces all element divergences
 *  T20 — report printer does not throw on empty source list
 *
 * source: Mayo (1996). Error and the Growth of Experimental Knowledge, Ch. 6.
 *         "A severe test is one the hypothesis would fail if false."
 */

import { describe, it, expect } from "vitest";
import { compareWithMasking, diffFixture, checkShapeOnly } from "../diff.js";
import { generateProbes, PROBES_PER_FIXTURE } from "../adversarial.js";
import { buildParityReport, buildSourceReport, printReport } from "../report.js";
import type { FixtureResult } from "../types.js";

// ── Helper: minimal FixtureResult factory ─────────────────────────────────────

function makeMatchResult(fixture = "test/fixture.json"): FixtureResult {
  return {
    fixture,
    input: { query: "test" },
    expected: { result: "ok" },
    tsActual: { result: "ok" },
    liveActual: null,
    outcome: { status: "match" },
  };
}

function makeDivergedResult(fixture = "test/fixture.json"): FixtureResult {
  return {
    fixture,
    input: { query: "test" },
    expected: { result: "ok" },
    tsActual: { result: "wrong" },
    liveActual: null,
    outcome: {
      status: "diverged",
      divergences: [
        { path: "result", kind: "VALUE_MISMATCH", expected: "ok", actual: "wrong" },
      ],
    },
  };
}

// ── T1: nondeterministic sentinel — key present → match ───────────────────────

describe("T1: SENTINEL_NONDETERMINISTIC — key present → match", () => {
  it("returns no divergences when key is present and expected is the sentinel", () => {
    const actual = { memory_id: "some-uuid-value" };
    const expected = { memory_id: "<MASKED:nondeterministic>" };
    const divergences = compareWithMasking(actual, expected, "");
    expect(divergences).toHaveLength(0);
  });
});

// ── T2: nondeterministic sentinel — absent key → MISSING_KEY ──────────────────

describe("T2: SENTINEL_NONDETERMINISTIC — absent key → MISSING_KEY", () => {
  it("returns MISSING_KEY when a sentinel key is absent in actual", () => {
    const actual = {};
    const expected = { memory_id: "<MASKED:nondeterministic>" };
    const divergences = compareWithMasking(actual, expected, "");
    expect(divergences).toHaveLength(1);
    expect(divergences[0]?.kind).toBe("MISSING_KEY");
    expect(divergences[0]?.path).toBe("memory_id");
  });
});

// ── T3: bounded assertion — in range → passes ─────────────────────────────────

describe("T3: bounded assertion — value in range → passes", () => {
  it("returns no divergences when heat satisfies the bounded predicate", () => {
    const actual = { heat: 0.5 };
    const expected = {
      heat: "<MASKED:nondeterministic-but-bounded: assertHeat(result.heat < 0.8 && result.heat > 0.0)>",
    };
    const divergences = compareWithMasking(actual, expected, "");
    expect(divergences).toHaveLength(0);
  });
});

// ── T4: bounded assertion — out of range → BOUNDED_ASSERT_FAIL ────────────────

describe("T4: bounded assertion — value out of range → BOUNDED_ASSERT_FAIL", () => {
  it("returns BOUNDED_ASSERT_FAIL when heat violates the bounded predicate", () => {
    const actual = { heat: 0.95 };
    const expected = {
      heat: "<MASKED:nondeterministic-but-bounded: assertHeat(result.heat < 0.8 && result.heat > 0.0)>",
    };
    const divergences = compareWithMasking(actual, expected, "");
    expect(divergences).toHaveLength(1);
    expect(divergences[0]?.kind).toBe("BOUNDED_ASSERT_FAIL");
    expect(divergences[0]?.note).toContain("false");
  });
});

// ── T5: VALUE_MISMATCH ────────────────────────────────────────────────────────

describe("T5: VALUE_MISMATCH on differing primitive", () => {
  it("detects mismatch between string values", () => {
    const divergences = compareWithMasking(
      { status: "wrong_value" },
      { status: "ok" },
      "",
    );
    expect(divergences).toHaveLength(1);
    expect(divergences[0]?.kind).toBe("VALUE_MISMATCH");
    expect(divergences[0]?.path).toBe("status");
    expect(divergences[0]?.expected).toBe("ok");
    expect(divergences[0]?.actual).toBe("wrong_value");
  });
});

// ── T6: MISSING_KEY ───────────────────────────────────────────────────────────

describe("T6: MISSING_KEY when actual omits an expected key", () => {
  it("surfaces MISSING_KEY for every absent key", () => {
    const divergences = compareWithMasking(
      {},
      { results: [], total: 0, query_intent: "semantic" },
      "",
    );
    expect(divergences).toHaveLength(3);
    const kinds = new Set(divergences.map((d) => d.kind));
    expect(kinds.size).toBe(1);
    expect([...kinds][0]).toBe("MISSING_KEY");
    const paths = divergences.map((d) => d.path).sort();
    expect(paths).toEqual(["query_intent", "results", "total"]);
  });
});

// ── T7: TYPE_MISMATCH ─────────────────────────────────────────────────────────

describe("T7: TYPE_MISMATCH on incompatible types", () => {
  it("detects string-vs-array type mismatch", () => {
    const divergences = compareWithMasking(
      { results: "not-an-array" },
      { results: [] },
      "",
    );
    expect(divergences).toHaveLength(1);
    expect(divergences[0]?.kind).toBe("TYPE_MISMATCH");
  });

  it("detects number-vs-boolean type mismatch", () => {
    const divergences = compareWithMasking(
      { stored: 1 },
      { stored: true },
      "",
    );
    expect(divergences).toHaveLength(1);
    expect(divergences[0]?.kind).toBe("TYPE_MISMATCH");
  });
});

// ── T8: ARRAY_LENGTH_MISMATCH ─────────────────────────────────────────────────

describe("T8: ARRAY_LENGTH_MISMATCH when arrays differ in length", () => {
  it("flags length mismatch and still recurses into overlapping elements", () => {
    const divergences = compareWithMasking(
      { results: [{ score: 0.5 }] },
      { results: [{ score: 0.5 }, { score: 0.3 }] },
      "",
    );
    expect(divergences.some((d) => d.kind === "ARRAY_LENGTH_MISMATCH")).toBe(true);
    expect(divergences[0]?.path).toBe("results");
    expect(divergences[0]?.expected).toBe(2);
    expect(divergences[0]?.actual).toBe(1);
  });
});

// ── T9: nested object recursive diff ─────────────────────────────────────────

describe("T9: nested object diff recurses correctly", () => {
  it("surfaces divergence at the correct nested path", () => {
    const divergences = compareWithMasking(
      { signals: { bm25: 0.4, semantic: 0.3 } },
      { signals: { bm25: 0.4, semantic: 0.9 } },
      "",
    );
    expect(divergences).toHaveLength(1);
    expect(divergences[0]?.path).toBe("signals.semantic");
    expect(divergences[0]?.kind).toBe("VALUE_MISMATCH");
    expect(divergences[0]?.expected).toBe(0.9);
    expect(divergences[0]?.actual).toBe(0.3);
  });
});

// ── T10: _meta keys stripped ──────────────────────────────────────────────────

describe("T10: metadata _meta keys in expected are skipped", () => {
  it("does not flag _capture_status or _schema_shape as divergences", () => {
    const divergences = compareWithMasking(
      { stored: true },
      {
        _capture_status: "SHAPE-KNOWN-FROM-SOURCE",
        _schema_shape: { stored: "boolean" },
        stored: true,
      },
      "",
    );
    expect(divergences).toHaveLength(0);
  });
});

// ── T11: TO-BE-CAPTURED shape-only mode ───────────────────────────────────────

describe("T11: TO-BE-CAPTURED shape-only mode validates required keys", () => {
  it("returns shape_only when all required keys are present", () => {
    const result = diffFixture(
      { results: [], total: 0, query_intent: "semantic" },
      {
        _capture_status: "TO-BE-CAPTURED-IN-PHASE-0-DAY-1",
        _required_keys: ["results", "total", "query_intent"],
      },
    );
    expect(result.status).toBe("shape_only");
  });

  it("returns diverged when a required key is absent", () => {
    const result = diffFixture(
      { results: [] },
      {
        _capture_status: "TO-BE-CAPTURED-IN-PHASE-0-DAY-1",
        _required_keys: ["results", "total"],
      },
    );
    expect(result.status).toBe("diverged");
    if (result.status === "diverged") {
      expect(result.divergences.some((d) => d.path === "total")).toBe(true);
    }
  });
});

// ── T12: SHAPE-KNOWN-FROM-SOURCE performs full assertion ─────────────────────

describe("T12: SHAPE-KNOWN-FROM-SOURCE performs full assertion", () => {
  it("returns match when values match exactly", () => {
    const result = diffFixture(
      { stored: false, reason: "no_content" },
      {
        _capture_status: "SHAPE-KNOWN-FROM-SOURCE",
        stored: false,
        reason: "no_content",
      },
    );
    expect(result.status).toBe("match");
  });

  it("returns diverged when a value differs", () => {
    const result = diffFixture(
      { stored: true, reason: "no_content" },
      {
        _capture_status: "SHAPE-KNOWN-FROM-SOURCE",
        stored: false,
        reason: "no_content",
      },
    );
    expect(result.status).toBe("diverged");
    if (result.status === "diverged") {
      expect(result.divergences.some((d) => d.path === "stored")).toBe(true);
    }
  });
});

// ── T13: adversarial probe generator — exact probe count ─────────────────────

describe("T13: adversarial probe generator produces exactly PROBES_PER_FIXTURE probes", () => {
  it("generates exactly 5 probes for a typical recall input", () => {
    const input = { query: "why did we choose pgvector?", limit: 10 };
    const probes = generateProbes("recall/recall_simple_query.json", input);
    expect(probes).toHaveLength(PROBES_PER_FIXTURE);
    expect(PROBES_PER_FIXTURE).toBe(5); // source: mission brief §4
  });

  it("assigns sequential probe indices 1–5", () => {
    const input = { query: "test" };
    const probes = generateProbes("test.json", input);
    const indices = probes.map((p) => p.probeIndex).sort((a, b) => a - b);
    expect(indices).toEqual([1, 2, 3, 4, 5]);
  });

  it("each probe has a distinct mutationLabel", () => {
    const input = { content: "hello", tags: ["a"] };
    const probes = generateProbes("remember.json", input);
    const labels = new Set(probes.map((p) => p.mutationLabel));
    expect(labels.size).toBe(5);
  });
});

// ── T14: adversarial probe generator — no primary text field ──────────────────

describe("T14: adversarial probe generator handles missing primary text field", () => {
  it("falls back to _probe_synthetic key when no primary field found", () => {
    const input = { unrecognised_field: 42 };
    const probes = generateProbes("edge.json", input);
    expect(probes).toHaveLength(PROBES_PER_FIXTURE);
    // Probes 1 and 2 should target _probe_synthetic
    const p1 = probes.find((p) => p.probeIndex === 1);
    expect(p1).toBeDefined();
    expect(p1?.input["_probe_synthetic"]).toBe("");
  });
});

// ── T15: buildParityReport exit_code=0 on all-match ──────────────────────────

describe("T15: buildParityReport exit_code=0 on all-match", () => {
  it("sets exit_code=0 when all fixtures match", () => {
    const sourceReport = buildSourceReport("cortex", [
      makeMatchResult("a.json"),
      makeMatchResult("b.json"),
    ]);
    const report = buildParityReport([sourceReport]);
    expect(report.exit_code).toBe(0);
    expect(report.divergences).toHaveLength(0);
  });
});

// ── T16: buildParityReport exit_code=1 on any divergence ─────────────────────

describe("T16: buildParityReport exit_code=1 on any divergence", () => {
  it("sets exit_code=1 when any fixture diverges", () => {
    const sourceReport = buildSourceReport("cortex", [
      makeMatchResult("a.json"),
      makeDivergedResult("b.json"),
    ]);
    const report = buildParityReport([sourceReport]);
    expect(report.exit_code).toBe(1);
    expect(report.divergences).toHaveLength(1);
    expect(report.divergences[0]?.fixture).toBe("b.json");
    expect(report.divergences[0]?.source).toBe("cortex");
  });
});

// ── T17: strictExtraKeys — EXTRA_KEY on unexpected actual key ─────────────────

describe("T17: strictExtraKeys — EXTRA_KEY divergence on unexpected key", () => {
  it("flags EXTRA_KEY when actual has a key not in expected (strict mode)", () => {
    const divergences = compareWithMasking(
      { stored: true, unexpected_new_field: "surprise" },
      { stored: true },
      "",
      true, // strictExtraKeys = true
    );
    expect(divergences).toHaveLength(1);
    expect(divergences[0]?.kind).toBe("EXTRA_KEY");
    expect(divergences[0]?.path).toBe("unexpected_new_field");
  });

  it("does not flag EXTRA_KEY when strictExtraKeys is false (default)", () => {
    const divergences = compareWithMasking(
      { stored: true, unexpected_new_field: "surprise" },
      { stored: true },
      "",
      false,
    );
    expect(divergences).toHaveLength(0);
  });
});

// ── T18: _-prefixed metadata keys are always skipped ──────────────────────────

describe("T18: _-prefixed metadata keys are skipped in comparison", () => {
  it("does not produce divergences for any _ key in expected", () => {
    const divergences = compareWithMasking(
      { results: [] },
      {
        _capture_status: "anything",
        _capture_command: "python ...",
        _schema_shape: {},
        _critical_invariants: [],
        _masked_fields: {},
        _required_keys: [],
        _capture_blocked_reason: "reason",
        _shape_source: "source",
        results: [],
      },
      "",
    );
    expect(divergences).toHaveLength(0);
  });
});

// ── T19: array element-wise diff surfaces all element divergences ─────────────

describe("T19: array element-wise diff surfaces all divergences", () => {
  it("collects divergences from multiple elements in a single pass", () => {
    const divergences = compareWithMasking(
      { results: [{ score: 0.1 }, { score: 0.2 }, { score: 0.3 }] },
      { results: [{ score: 0.9 }, { score: 0.8 }, { score: 0.7 }] },
      "",
    );
    // Three VALUE_MISMATCH divergences — one per element.
    const valueMismatches = divergences.filter((d) => d.kind === "VALUE_MISMATCH");
    expect(valueMismatches).toHaveLength(3);
    expect(valueMismatches[0]?.path).toBe("results[0].score");
    expect(valueMismatches[1]?.path).toBe("results[1].score");
    expect(valueMismatches[2]?.path).toBe("results[2].score");
  });
});

// ── T20: printReport does not throw on empty source list ──────────────────────

describe("T20: printReport does not throw on empty source list", () => {
  it("handles an empty sources array gracefully", () => {
    const report = buildParityReport([]);
    expect(() => printReport(report)).not.toThrow();
    expect(report.total).toBe(0);
    expect(report.exit_code).toBe(0);
  });
});

// ── T21: checkShapeOnly — non-object actual → diverged ────────────────────────

describe("T21: checkShapeOnly on non-object actual", () => {
  it("returns diverged with TYPE_MISMATCH when actual is not an object", () => {
    const result = checkShapeOnly("not-an-object", ["results"]);
    expect(result.status).toBe("diverged");
    if (result.status === "diverged") {
      expect(result.divergences[0]?.kind).toBe("TYPE_MISMATCH");
    }
  });
});

// ── T22: compound bounded assertion — fails on lower bound ───────────────────

describe("T22: bounded assertion fails on lower bound violation", () => {
  it("returns BOUNDED_ASSERT_FAIL when value is 0 (below lower bound > 0.0)", () => {
    const divergences = compareWithMasking(
      { heat: 0.0 },
      {
        heat: "<MASKED:nondeterministic-but-bounded: assertHeat(result.heat < 0.8 && result.heat > 0.0)>",
      },
      "",
    );
    expect(divergences).toHaveLength(1);
    expect(divergences[0]?.kind).toBe("BOUNDED_ASSERT_FAIL");
  });
});

// ── T23: buildSourceReport counters are correct ───────────────────────────────

describe("T23: buildSourceReport aggregation counters", () => {
  it("correctly counts matches, shapeOnly, skipped, errored, diverged", () => {
    const fixtures: FixtureResult[] = [
      { ...makeMatchResult(), outcome: { status: "match" } },
      { ...makeMatchResult(), outcome: { status: "shape_only", reason: "x" } },
      { ...makeMatchResult(), outcome: { status: "skipped", reason: "x" } },
      { ...makeMatchResult(), outcome: { status: "error", error: "x" } },
      {
        ...makeMatchResult(),
        outcome: {
          status: "diverged",
          divergences: [
            { path: "x", kind: "VALUE_MISMATCH", expected: 1, actual: 2 },
          ],
        },
      },
    ];
    const report = buildSourceReport("cortex", fixtures);
    expect(report.total).toBe(5);
    expect(report.matches).toBe(1);
    expect(report.shapeOnly).toBe(1);
    expect(report.skipped).toBe(1);
    expect(report.errored).toBe(1);
    expect(report.diverged).toBe(1);
  });
});
