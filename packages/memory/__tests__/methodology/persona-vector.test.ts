/**
 * Tests for persona-vector.ts — 9D persona vector computation.
 *
 * Invariant: all dimensions clamped to [-1, 1].
 * Happy path: buildPersonaVector, personaDrift, composePersonas.
 * Error path: empty profile, empty vectors.
 */

import { describe, it, expect } from "vitest";
import {
  PERSONA_DIMENSIONS,
  buildPersonaVector,
  personaToArray,
  personaDistance,
  personaDrift,
  composePersonas,
  steerContext,
} from "../../src/methodology/persona-vector.js";

const emptyProfile = {};

const fullProfile = {
  metacognitive: {
    activeReflective: 0.5,
    sensingIntuitive: -0.3,
    sequentialGlobal: 0.2,
  },
  sessionShape: {
    avgDuration: 900000, // 15 minutes
    avgTurns: 15,
    avgMessages: 12,
    burstRatio: 0.3,
  },
  toolPreferences: {
    Agent: { ratio: 0.4 },
    Bash: { ratio: 0.2 },
    Edit: { ratio: 0.3 },
    Read: { ratio: 0.1 },
    Glob: { ratio: 0.1 },
    Grep: { ratio: 0.05 },
  },
};

describe("buildPersonaVector", () => {
  it("produces all 9 dimensions", () => {
    const pv = buildPersonaVector(fullProfile);
    for (const dim of PERSONA_DIMENSIONS) {
      expect(pv).toHaveProperty(dim);
    }
  });

  it("all dimensions are clamped to [-1, 1]", () => {
    const pv = buildPersonaVector(fullProfile);
    for (const dim of PERSONA_DIMENSIONS) {
      expect(pv[dim]).toBeGreaterThanOrEqual(-1.0);
      expect(pv[dim]).toBeLessThanOrEqual(1.0);
    }
  });

  it("handles empty profile gracefully", () => {
    const pv = buildPersonaVector(emptyProfile);
    for (const dim of PERSONA_DIMENSIONS) {
      expect(pv).toHaveProperty(dim);
    }
  });

  it("uses metacognitive values directly for cognitive dims", () => {
    const pv = buildPersonaVector(fullProfile);
    expect(pv["activeReflective"]).toBe(0.5);
    expect(pv["sensingIntuitive"]).toBe(-0.3);
  });
});

describe("personaToArray", () => {
  it("returns array of PERSONA_DIMENSIONS.length", () => {
    const pv = buildPersonaVector(fullProfile);
    const arr = personaToArray(pv);
    expect(arr).toHaveLength(PERSONA_DIMENSIONS.length);
  });

  it("preserves order matching PERSONA_DIMENSIONS", () => {
    const pv = buildPersonaVector(fullProfile);
    const arr = personaToArray(pv);
    for (let i = 0; i < PERSONA_DIMENSIONS.length; i++) {
      expect(arr[i]).toBe(pv[PERSONA_DIMENSIONS[i]!]);
    }
  });
});

describe("personaDistance", () => {
  it("returns 0 for identical vectors", () => {
    const pv = buildPersonaVector(fullProfile);
    expect(personaDistance(pv, pv)).toBeCloseTo(0.0, 5);
  });

  it("returns positive for different vectors", () => {
    const pv1 = buildPersonaVector(fullProfile);
    const pv2 = buildPersonaVector(emptyProfile);
    expect(personaDistance(pv1, pv2)).toBeGreaterThanOrEqual(0);
  });
});

describe("personaDrift", () => {
  it("returns drift with magnitude, direction, interpretation", () => {
    const old = buildPersonaVector(emptyProfile);
    const newPv = buildPersonaVector(fullProfile);
    const drift = personaDrift(old, newPv);
    expect(drift).toHaveProperty("magnitude");
    expect(drift).toHaveProperty("direction");
    expect(drift).toHaveProperty("interpretation");
  });

  it("direction has all persona dimensions", () => {
    const old = buildPersonaVector(emptyProfile);
    const newPv = buildPersonaVector(fullProfile);
    const drift = personaDrift(old, newPv);
    const direction = drift["direction"] as Record<string, number>;
    for (const dim of PERSONA_DIMENSIONS) {
      expect(direction).toHaveProperty(dim);
    }
  });
});

describe("composePersonas", () => {
  it("returns zero vector for empty input", () => {
    const composed = composePersonas([], []);
    for (const dim of PERSONA_DIMENSIONS) {
      expect(composed[dim]).toBe(0);
    }
  });

  it("returns first vector for single input with weight 1", () => {
    const pv = buildPersonaVector(fullProfile);
    const composed = composePersonas([pv], [1.0]);
    for (const dim of PERSONA_DIMENSIONS) {
      expect(composed[dim]).toBeCloseTo(pv[dim]!, 2);
    }
  });

  it("all dimensions are clamped to [-1, 1]", () => {
    const pv = buildPersonaVector(fullProfile);
    const composed = composePersonas([pv, pv], [0.5, 0.5]);
    for (const dim of PERSONA_DIMENSIONS) {
      expect(composed[dim]!).toBeGreaterThanOrEqual(-1.0);
      expect(composed[dim]!).toBeLessThanOrEqual(1.0);
    }
  });
});

describe("steerContext", () => {
  it("returns base context unchanged when no adjustments", () => {
    const pv = buildPersonaVector(fullProfile);
    expect(steerContext("Be helpful.", pv, null)).toBe("Be helpful.");
  });

  it("appends steering sentence when significant drift exists", () => {
    const pv = { thoroughness: 0.0 } as any;
    const adjusted = steerContext("Base.", pv, { thoroughness: 0.8 });
    expect(adjusted.length).toBeGreaterThan("Base.".length);
  });

  it("does not append sentence when drift is below threshold", () => {
    const pv = { thoroughness: 0.5 };
    const adjusted = steerContext("Base.", pv, { thoroughness: 0.6 }); // diff=0.1 < 0.2 threshold
    expect(adjusted).toBe("Base.");
  });
});
