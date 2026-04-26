/**
 * Tests for schema-extraction and schema-engine.
 *
 * Pure-function tests — no I/O, no store.
 */

import { describe, expect, it } from "vitest";
import {
  extractSchemaFromCluster,
  generateLabel,
  mergeSchemas,
  schemaFromDict,
  schemaToDict,
  shouldMergeSchemas,
} from "../../src/codebase-analysis/schema-extraction.js";
import {
  accommodateSchema,
  classifySchemaMatch,
  computePredictionError,
  computeSchemaFreeEnergy,
  computeSchemaMatch,
  findBestMatchingSchema,
  generatePredictions,
  shouldReviseSchema,
} from "../../src/codebase-analysis/schema-engine.js";

// ── extractSchemaFromCluster ──────────────────────────────────────────────

describe("extractSchemaFromCluster", () => {
  const memories = Array.from({ length: 6 }, (_, i) => ({
    entities: ["Cortex", "memory"],
    tags: ["recall", "consolidation"],
    relationships: [],
    id: i,
  }));

  it("returns a schema when cluster is large enough", () => {
    const schema = extractSchemaFromCluster(memories, "test", "s1");
    expect(schema).not.toBeNull();
    expect(schema!.schemaId).toBe("s1");
  });

  it("returns null when cluster is too small", () => {
    const schema = extractSchemaFromCluster(memories.slice(0, 3), "test", "s2");
    expect(schema).toBeNull();
  });

  it("populates entitySignature with Cortex and memory", () => {
    const schema = extractSchemaFromCluster(memories, "test", "s1");
    expect(Object.keys(schema!.entitySignature)).toContain("Cortex");
    expect(Object.keys(schema!.entitySignature)).toContain("memory");
  });

  it("sets formationCount to cluster length", () => {
    const schema = extractSchemaFromCluster(memories, "test", "s1");
    expect(schema!.formationCount).toBe(6);
  });
});

// ── generateLabel ─────────────────────────────────────────────────────────

describe("generateLabel", () => {
  it("generates a label from entity and tag signatures", () => {
    const label = generateLabel({ Cortex: 0.9, memory: 0.7 }, { recall: 0.8 });
    expect(label).toContain("Cortex");
    expect(label).toContain("[recall]");
  });

  it("returns 'unnamed_schema' for empty signatures", () => {
    expect(generateLabel({}, {})).toBe("unnamed_schema");
  });
});

// ── mergeSchemas ──────────────────────────────────────────────────────────

describe("mergeSchemas / shouldMergeSchemas", () => {
  // 3 shared entities (Cortex, memory, recall) out of 4 total → Jaccard = 3/4 = 0.75 > 0.6
  const schemaA = extractSchemaFromCluster(
    Array.from({ length: 6 }, () => ({
      entities: ["Cortex", "memory", "recall"],
      tags: ["consolidation"],
      relationships: [],
    })),
    "test",
    "a",
  )!;
  const schemaB = extractSchemaFromCluster(
    Array.from({ length: 6 }, () => ({
      entities: ["Cortex", "memory", "recall", "graph"],
      tags: ["consolidation"],
      relationships: [],
    })),
    "test",
    "b",
  )!;

  it("detects similar schemas as mergeable (Jaccard >= 0.6)", () => {
    expect(shouldMergeSchemas(schemaA, schemaB)).toBe(true);
  });

  it("merges into a new schema", () => {
    const merged = mergeSchemas(schemaA, schemaB, "merged-ab");
    expect(merged.schemaId).toBe("merged-ab");
    expect(merged.formationCount).toBe(schemaA.formationCount + schemaB.formationCount);
  });
});

// ── Serialization round-trip ──────────────────────────────────────────────

describe("schemaToDict / schemaFromDict round-trip", () => {
  const schema = extractSchemaFromCluster(
    Array.from({ length: 6 }, () => ({
      entities: ["Cortex"],
      tags: ["recall"],
      relationships: [],
    })),
    "test",
    "rt1",
  )!;

  it("round-trips without data loss", () => {
    const dict = schemaToDict(schema);
    const restored = schemaFromDict(dict as Record<string, unknown>);
    expect(restored.schemaId).toBe(schema.schemaId);
    expect(restored.entitySignature).toEqual(schema.entitySignature);
    expect(restored.formationCount).toBe(schema.formationCount);
  });
});

// ── computeSchemaMatch ────────────────────────────────────────────────────

describe("computeSchemaMatch", () => {
  const schema = extractSchemaFromCluster(
    Array.from({ length: 6 }, () => ({
      entities: ["Cortex", "memory"],
      tags: ["recall"],
      relationships: [],
    })),
    "test",
    "m1",
  )!;

  it("returns high score for matching memory", () => {
    const score = computeSchemaMatch(["Cortex", "memory"], ["recall"], schema);
    expect(score).toBeGreaterThan(0.5);
  });

  it("returns low score for non-matching memory", () => {
    const score = computeSchemaMatch(["unrelated", "entity"], ["other"], schema);
    expect(score).toBeLessThan(0.3);
  });
});

// ── classifySchemaMatch ───────────────────────────────────────────────────

describe("classifySchemaMatch", () => {
  it("classifies 0.8 as assimilate", () => expect(classifySchemaMatch(0.8)).toBe("assimilate"));
  it("classifies 0.5 as normal", () => expect(classifySchemaMatch(0.5)).toBe("normal"));
  it("classifies 0.1 as accommodate", () => expect(classifySchemaMatch(0.1)).toBe("accommodate"));
});

// ── findBestMatchingSchema ────────────────────────────────────────────────

describe("findBestMatchingSchema", () => {
  const schema = extractSchemaFromCluster(
    Array.from({ length: 6 }, () => ({
      entities: ["Cortex", "memory"],
      tags: ["recall"],
      relationships: [],
    })),
    "test",
    "bm1",
  )!;

  it("finds the best schema", () => {
    const [best, score] = findBestMatchingSchema(
      ["Cortex", "memory"],
      ["recall"],
      [schema],
    );
    expect(best).not.toBeNull();
    expect(score).toBeGreaterThan(0.1);
  });

  it("returns null for no good match", () => {
    const [best] = findBestMatchingSchema(["unrelated"], ["other"], [schema]);
    expect(best).toBeNull();
  });
});

// ── accommodateSchema ────────────────────────────────────────────────────

describe("accommodateSchema", () => {
  const base = extractSchemaFromCluster(
    Array.from({ length: 6 }, () => ({
      entities: ["Cortex"],
      tags: ["recall"],
      relationships: [],
    })),
    "test",
    "acc1",
  )!;

  it("adds new entity to signature", () => {
    const updated = accommodateSchema(base, ["Cortex", "newEntity"], ["recall"]);
    expect(Object.keys(updated.entitySignature)).toContain("newEntity");
  });

  it("increments violation count", () => {
    const updated = accommodateSchema(base, ["new"], ["other"]);
    expect(updated.violationCount).toBe(base.violationCount + 1);
  });

  it("does not mutate original", () => {
    const originalEntities = { ...base.entitySignature };
    accommodateSchema(base, ["extra"], ["x"]);
    expect(base.entitySignature).toEqual(originalEntities);
  });
});

// ── shouldReviseSchema ────────────────────────────────────────────────────

describe("shouldReviseSchema", () => {
  it("triggers revision when violations >= 10", () => {
    const s = extractSchemaFromCluster(
      Array.from({ length: 6 }, () => ({ entities: ["x"], tags: [], relationships: [] })),
      "t",
      "r1",
    )!;
    const revised = { ...s, violationCount: 10, formationCount: 20 };
    expect(shouldReviseSchema(revised)).toBe(true);
  });

  it("no revision when violations are low", () => {
    const s = extractSchemaFromCluster(
      Array.from({ length: 6 }, () => ({ entities: ["x"], tags: [], relationships: [] })),
      "t",
      "r2",
    )!;
    expect(shouldReviseSchema(s)).toBe(false);
  });
});

// ── generatePredictions / computePredictionError / freeEnergy ────────────

describe("predictive coding pipeline", () => {
  const schema = extractSchemaFromCluster(
    Array.from({ length: 6 }, () => ({
      entities: ["Cortex", "memory"],
      tags: [],
      relationships: [],
    })),
    "t",
    "pc1",
  )!;

  it("generatePredictions returns entity signature", () => {
    const preds = generatePredictions(schema);
    expect(preds).toHaveProperty("Cortex");
  });

  it("computePredictionError flags missing and novel entities", () => {
    const preds = { Cortex: 0.9, memory: 0.7 };
    const errors = computePredictionError(preds, ["Cortex", "newEntity"]);
    // memory was predicted but not observed → positive error
    expect(errors["memory"]).toBeGreaterThan(0);
    // newEntity was observed but not predicted → negative error
    expect(errors["newEntity"]).toBe(-0.5);
  });

  it("computeSchemaFreeEnergy returns sum of squared errors", () => {
    const errors = { a: 0.5, b: -0.5 };
    const fe = computeSchemaFreeEnergy(errors);
    expect(fe).toBeCloseTo(0.25 + 0.25, 5);
  });
});
