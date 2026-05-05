/**
 * Tests for remember-response.ts
 *
 * source: cortex@ed33435 mcp_server/handlers/remember_response.py
 *
 * Invariants tested:
 *   1. buildEmotionalInfo — returns null when is_emotional=false
 *   2. buildSchemaInfo — returns null when match=0
 *   3. describeSignals — dominant field names correct signal
 *   4. buildResponse — has all required fields
 *   5. buildMergeResponse — action=="merged"
 *   6. buildRejectionResponse — stored==false
 */

import { describe, it, expect } from "vitest";
import {
  buildEmotionalInfo,
  buildSchemaInfo,
  describeSignals,
  buildResponse,
  buildMergeResponse,
  buildRejectionResponse,
} from "../../src/remember/handlers/remember-response.js";

// ── Test 1: buildEmotionalInfo ────────────────────────────────────────────

describe("buildEmotionalInfo", () => {
  it("returns null when etag is null", () => {
    expect(buildEmotionalInfo(null)).toBeNull();
  });
  it("returns null when is_emotional=false", () => {
    expect(buildEmotionalInfo({
      is_emotional: false,
      dominant_emotion: "neutral",
      arousal: 0,
      importance_boost: 0,
    })).toBeNull();
  });
  it("returns EmotionalInfo when is_emotional=true", () => {
    const result = buildEmotionalInfo({
      is_emotional: true,
      dominant_emotion: "distress",
      arousal: 0.8,
      importance_boost: 0.15,
    });
    expect(result).not.toBeNull();
    expect(result?.dominant).toBe("distress");
    expect(result?.arousal).toBeCloseTo(0.8);
  });
});

// ── Test 2: buildSchemaInfo ───────────────────────────────────────────────

describe("buildSchemaInfo", () => {
  it("returns null when match_score=0", () => {
    expect(buildSchemaInfo(0, null)).toBeNull();
  });
  it("returns SchemaInfo when match>0", () => {
    const result = buildSchemaInfo(0.9, "schema-123");
    expect(result).not.toBeNull();
    expect(result?.schema_id).toBe("schema-123");
    expect(result?.pathway).toBe("assimilation");
  });
  it("returns accommodation pathway for score 0.6", () => {
    const result = buildSchemaInfo(0.6, null);
    expect(result?.pathway).toBe("accommodation");
  });
  it("returns equilibration pathway for score 0.3", () => {
    const result = buildSchemaInfo(0.3, null);
    expect(result?.pathway).toBe("equilibration");
  });
});

// ── Test 3: describeSignals dominant ─────────────────────────────────────

describe("describeSignals", () => {
  it("identifies temporal as dominant when it's highest", () => {
    const result = describeSignals(0.1, 0.2, 0.9, 0.3, 0.5);
    expect(result.dominant).toBe("temporal");
  });
  it("identifies embedding as dominant by default when tied", () => {
    const result = describeSignals(0.5, 0.5, 0.5, 0.5, 0.5);
    expect(result.dominant).toBe("embedding");
  });
  it("rounds all values to 4 decimal places", () => {
    const result = describeSignals(0.12345, 0.23456, 0.34567, 0.45678, 0.56789);
    expect(result.emb.toString().split(".")[1]?.length ?? 0).toBeLessThanOrEqual(4);
  });
});

// ── Test 4: buildResponse ─────────────────────────────────────────────────

describe("buildResponse", () => {
  const mod = {
    heat: 0.8,
    importance: 0.7,
    valence: 0.1,
    gate_reason: "novel",
    emb_nov: 0.5,
    ent_nov: 0.3,
    temp_nov: 0.6,
    struct_nov: 0.4,
    neuro_mod: null,
    emotional_tag: null,
    theta: 0.5,
    enc_mod: 1.0,
    schema_match: 0.0,
    schema_id: null,
  };

  it("has stored=true", () => {
    const result = buildResponse(1, "stored", "episodic", "cortex", mod, 0.5, [], [], null, 0, 0, 0);
    expect(result.stored).toBe(true);
  });

  it("has memory_id", () => {
    const result = buildResponse(42, "stored", "episodic", "cortex", mod, 0.5, [], [], null, 0, 0, 0);
    expect(result.memory_id).toBe(42);
  });

  it("has novelty field with 4 signals", () => {
    const result = buildResponse(1, "stored", "episodic", "test", mod, 0.5, [], [], null, 0, 0.1, 0.05);
    expect(result.novelty).toHaveProperty("emb");
    expect(result.novelty).toHaveProperty("ent");
    expect(result.novelty).toHaveProperty("temp");
    expect(result.novelty).toHaveProperty("struct");
  });

  it("heat is rounded to 4 decimal places", () => {
    const result = buildResponse(1, "stored", "episodic", "test", mod, 0.5, [], [], null, 0, 0, 0);
    expect(result.heat.toString().split(".")[1]?.length ?? 0).toBeLessThanOrEqual(4);
  });
});

// ── Test 5: buildMergeResponse ────────────────────────────────────────────

describe("buildMergeResponse", () => {
  it("returns action=='merged'", () => {
    const result = buildMergeResponse(
      7, "cortex",
      { heat: 0.9, importance: 0.8 },
      { emb_nov: 0.3, ent_nov: 0.2, temp_nov: 0.5, struct_nov: 0.4, score: 0.4 },
    );
    expect(result.action).toBe("merged");
    expect(result.stored).toBe(true);
    expect(result.memory_id).toBe(7);
  });

  it("reason is merged_with_existing", () => {
    const result = buildMergeResponse(null, "test",
      { heat: 0.5, importance: 0.5 },
      { score: 0.3 },
    );
    expect(result.reason).toBe("merged_with_existing");
  });
});

// ── Test 6: buildRejectionResponse ────────────────────────────────────────

describe("buildRejectionResponse", () => {
  it("returns stored=false", () => {
    const result = buildRejectionResponse(
      "below_threshold", 0.5, { score: 0.1 },
    );
    expect(result.stored).toBe(false);
    expect(result.reason).toBe("below_threshold");
  });

  it("importance is in range", () => {
    const result = buildRejectionResponse("noise", 0.35, { score: 0.1 });
    expect(result.importance).toBeGreaterThanOrEqual(0);
    expect(result.importance).toBeLessThanOrEqual(1);
  });
});
