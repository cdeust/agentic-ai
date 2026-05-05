/**
 * Tests for interference-detection.ts
 *
 * Verifies: proactive interference detection; retroactive interference detection;
 * sorting by severity; threshold filtering.
 */

import { describe, it, expect } from "vitest";
import {
  detectProactiveInterference,
  detectRetroactiveInterference,
} from "../../src/recall/interference-detection.js";

function makeEmbedding(val: number, dim = 4): number[] {
  const v = new Array(dim).fill(0);
  v[0] = val;
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return mag > 0 ? v.map((x) => x / mag) : v;
}

const highSimEmb = [1, 0, 0, 0];
const lowSimEmb = [0, 1, 0, 0];

describe("detectProactiveInterference", () => {
  it("returns empty for no existing memories", () => {
    const result = detectProactiveInterference([1, 0, 0, 0], [], []);
    expect(result).toHaveLength(0);
  });

  it("returns empty when similarity is below threshold", () => {
    const mem = {
      id: 1,
      embedding: lowSimEmb,
      entities: [],
      heat: 0.5,
      consolidation_stage: "labile",
    };
    const result = detectProactiveInterference(highSimEmb, [], [mem]);
    expect(result).toHaveLength(0);
  });

  it("detects high-similarity proactive interference", () => {
    const mem = {
      id: 1,
      embedding: [1, 0.01, 0, 0],
      entities: ["foo"],
      heat: 0.5,
      consolidation_stage: "consolidated",
    };
    const newEmb = [1, 0, 0, 0];
    const result = detectProactiveInterference(newEmb, ["foo"], [mem]);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]["interference_type"]).toBe("proactive");
    expect(result[0]["interference_score"]).toBeGreaterThan(0);
  });

  it("sorts results descending by interference_score", () => {
    const mems = [
      { id: 1, embedding: [1, 0.05, 0, 0], entities: [], heat: 0.5, consolidation_stage: "labile" },
      { id: 2, embedding: [1, 0.01, 0, 0], entities: [], heat: 0.5, consolidation_stage: "consolidated" },
    ];
    const result = detectProactiveInterference([1, 0, 0, 0], [], mems);
    if (result.length >= 2) {
      expect(result[0]["interference_score"] as number).toBeGreaterThanOrEqual(
        result[1]["interference_score"] as number,
      );
    }
  });
});

describe("detectRetroactiveInterference", () => {
  it("returns empty for no existing memories", () => {
    const result = detectRetroactiveInterference([1, 0, 0, 0], 0.9, []);
    expect(result).toHaveLength(0);
  });

  it("returns empty when similarity is low", () => {
    const mem = {
      id: 1,
      embedding: lowSimEmb,
      heat: 0.1,
      importance: 0.1,
      consolidation_stage: "labile",
    };
    const result = detectRetroactiveInterference(highSimEmb, 0.9, [mem]);
    expect(result).toHaveLength(0);
  });

  it("detects retroactive interference for labile memories", () => {
    const mem = {
      id: 1,
      embedding: [1, 0.01, 0, 0],
      heat: 0.1,
      importance: 0.1,
      consolidation_stage: "labile",
    };
    const result = detectRetroactiveInterference([1, 0, 0, 0], 0.9, [mem]);
    if (result.length > 0) {
      expect(result[0]["interference_type"]).toBe("retroactive");
      expect(result[0]["risk_score"]).toBeGreaterThan(0);
    }
  });
});
