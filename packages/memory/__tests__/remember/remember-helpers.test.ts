/**
 * Tests for remember-helpers.ts
 *
 * source: cortex@ed33435 mcp_server/handlers/remember_helpers.py
 *
 * Invariants tested:
 *   1. computeSimilarities — returns empty when embedding is null
 *   2. evaluateGate — gate_reason=="forced" when force=true
 *   3. computeGateDecision — decision-tag content bypasses gate
 *   4. isDecisionContent — detects decision markers
 *   5. classifyStoreType — episodic default, semantic for definitions
 *   6. buildInsertRecord — all fields populated
 *   7. applyModulations — heat clamped to [0,1]
 *   8. tryCuration — returns "create" when no embedding
 *   9. updateUserMoodEma — returns null for non-user sources
 *  10. estimateImportance — decision tags → 1.0
 */

import { describe, it, expect } from "vitest";
import {
  computeSimilarities,
  evaluateGate,
  computeGateDecision,
  isDecisionContent,
  classifyStoreType,
  buildInsertRecord,
  applyModulations,
  tryCuration,
  updateUserMoodEma,
  estimateImportance,
} from "../../src/remember/handlers/remember-helpers.js";
import type { MemoryStore } from "../../src/remember/storage/memory-store.js";

// ── Minimal MemoryStore stub ──────────────────────────────────────────────

function makeStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    insertMemory: () => 1,
    getMemory: () => null,
    deleteMemory: () => {},
    searchVectors: () => [],
    searchByFts: () => [],
    getHotMemories: () => [],
    getByIds: () => [],
    getMemoriesForDomain: () => [],
    getMemoriesForDirectory: () => [],
    bumpHeatRaw: () => {},
    updateMemoryCompression: () => {},
    updateMemoryHeat: () => {},
    updateMemoryAccess: () => {},
    incrementReplayCount: () => {},
    getEntityByName: () => null,
    upsertEntity: () => 0,
    linkMemoryEntity: () => {},
    insertRelationship: () => {},
    getAllActiveRules: () => [],
    getActiveProspectiveMemories: () => [],
    ...overrides,
  } as unknown as MemoryStore;
}

// ── Test 1: computeSimilarities with null embedding ───────────────────────

describe("computeSimilarities", () => {
  it("returns empty sims and vecHits when embedding is null", () => {
    const store = makeStore();
    const { sims, vecHits } = computeSimilarities(null, store);
    expect(sims).toEqual([]);
    expect(vecHits).toEqual([]);
  });

  it("returns empty sims when searchVectors returns nothing", () => {
    const store = makeStore({ searchVectors: () => [] });
    const emb = Buffer.from([1, 2, 3]);
    const { sims, vecHits } = computeSimilarities(emb, store);
    expect(sims).toEqual([]);
    expect(vecHits).toEqual([]);
  });

  it("converts distance to similarity: sim = 1/(1+dist)", () => {
    const store = makeStore({
      searchVectors: () => [[42, 0.0]] as [number, number][],
      getMemory: () => ({ id: 42, content: "test", heat_base: 0.5 } as unknown as ReturnType<MemoryStore["getMemory"]>),
    });
    const emb = Buffer.from([1, 2, 3]);
    const { sims, vecHits } = computeSimilarities(emb, store);
    expect(sims).toHaveLength(1);
    expect(sims[0]).toBeCloseTo(1.0);
    expect(vecHits[0]).toEqual([42, 0.0]);
  });
});

// ── Test 2: evaluateGate forced bypass ───────────────────────────────────

describe("evaluateGate", () => {
  it("returns should_store=true and gate_reason='forced' when force=true", () => {
    const store = makeStore();
    const result = evaluateGate("some content", [], null, true, store, "test", 0.4);
    expect(result.should_store).toBe(true);
    expect(result.gate_reason).toBe("forced");
  });

  it("returns should_store=false when score is below threshold and not forced", () => {
    const store = makeStore({
      searchVectors: () => [[1, 0.01]] as [number, number][],
      getMemory: (id: number) => ({
        id,
        content: "exact same content",
        heat_base: 0.5,
        created_at: new Date(Date.now() - 1000).toISOString(),
      } as unknown as ReturnType<MemoryStore["getMemory"]>),
      getHotMemories: () => [{ id: 1, content: "exact same content", heat_base: 0.5 } as unknown as ReturnType<MemoryStore["getHotMemories"]>[number]],
    });
    // Very high threshold to force rejection
    const result = evaluateGate("some content", [], null, false, store, "test", 0.99);
    expect(result.should_store).toBe(false);
  });
});

// ── Test 3: computeGateDecision decision-tag bypass ───────────────────────

describe("computeGateDecision", () => {
  it("bypass_decision when 'decision' tag present", () => {
    const { shouldStore, gateReason } = computeGateDecision(0.0, false, "no", ["decision"], 0.4);
    expect(shouldStore).toBe(true);
    expect(gateReason).toBe("bypass_decision");
  });

  it("below_threshold when score < threshold and no bypass triggers", () => {
    const { shouldStore, gateReason } = computeGateDecision(0.1, false, "neutral text", [], 0.4);
    expect(shouldStore).toBe(false);
    expect(gateReason).toBe("below_threshold");
  });

  it("novel when score >= threshold", () => {
    const { shouldStore, gateReason } = computeGateDecision(0.8, false, "neutral", [], 0.4);
    expect(shouldStore).toBe(true);
    expect(gateReason).toBe("novel");
  });

  it("bypass_error when 'error' tag present", () => {
    const { shouldStore, gateReason } = computeGateDecision(0.0, false, "text", ["error"], 0.4);
    expect(shouldStore).toBe(true);
    expect(gateReason).toBe("bypass_error");
  });
});

// ── Test 4: isDecisionContent ─────────────────────────────────────────────

describe("isDecisionContent", () => {
  it("returns true for 'decided'", () => {
    expect(isDecisionContent("We decided to use pgvector")).toBe(true);
  });
  it("returns true for 'ADR-' prefix", () => {
    expect(isDecisionContent("ADR-0045: use semaphores")).toBe(true);
  });
  it("returns false for regular content", () => {
    expect(isDecisionContent("just a log line")).toBe(false);
  });
});

// ── Test 5: classifyStoreType ─────────────────────────────────────────────

describe("classifyStoreType", () => {
  it("returns 'episodic' by default", () => {
    expect(classifyStoreType("a log line", [], "/work")).toBe("episodic");
  });
  it("returns 'semantic' for 'definition' tag", () => {
    expect(classifyStoreType("BM25 is ...", ["definition"], "/work")).toBe("semantic");
  });
  it("returns 'procedural' for 'procedure' tag", () => {
    expect(classifyStoreType("steps to...", ["procedure"], "/work")).toBe("procedural");
  });
  it("returns 'semantic' for migration directories", () => {
    expect(classifyStoreType("some content", [], "/Users/alice/migrations")).toBe("semantic");
  });
});

// ── Test 6: buildInsertRecord ─────────────────────────────────────────────

describe("buildInsertRecord", () => {
  it("builds a fully-populated record", () => {
    const mod = {
      heat: 0.8,
      importance: 0.7,
      valence: 0.1,
      theta: 0.5,
      enc_mod: 1.0,
      schema_match: 0.0,
      schema_id: null,
      neuro_mod: null,
      emotional_tag: null,
      gate_reason: "novel",
      emb_nov: 0.5,
      ent_nov: 0.3,
      temp_nov: 0.6,
      struct_nov: 0.4,
    };
    const record = buildInsertRecord(
      "test content", null, ["test"], "user", "cortex", "/work",
      mod, 0.5, false, "episodic", 0.1, 0.05, "engineer", false,
    );
    expect(record.content).toBe("test content");
    expect(record.store_type).toBe("episodic");
    expect(record.domain).toBe("cortex");
    expect(record.consolidation_stage).toBe("labile");
    expect(record.hippocampal_dependency).toBe(1.0);
    expect(record.is_protected).toBe(false);
    expect(record.agent_context).toBe("engineer");
  });

  it("normalizes domain to lowercase", () => {
    const mod = { heat: 0.5, importance: 0.5, valence: 0, theta: 0.5, enc_mod: 1, schema_match: 0, schema_id: null, neuro_mod: null, emotional_tag: null };
    const record = buildInsertRecord("c", null, [], "user", "CORTEX", "/w", mod, 0, false, "episodic", 0, 0, "", false);
    expect(record.domain).toBe("cortex");
  });
});

// ── Test 7: applyModulations heat clamping ────────────────────────────────

describe("applyModulations", () => {
  it("clamps heat to [0,1]", () => {
    const result = applyModulations("success resolved fixed", ["success"], 1.2, 0.9, 0.0);
    expect(result.heat).toBeLessThanOrEqual(1.0);
    expect(result.heat).toBeGreaterThanOrEqual(0.0);
  });

  it("sets emotional_tag for error content", () => {
    const result = applyModulations("error broken bug failure", [], 0.5, 0.5, 0.0);
    expect(result.emotional_tag).not.toBeNull();
    expect(result.emotional_tag?.dominant_emotion).toBe("distress");
  });

  it("returns null emotional_tag for neutral content", () => {
    const result = applyModulations("routine update to documentation", [], 0.5, 0.5, 0.0);
    expect(result.emotional_tag).toBeNull();
  });
});

// ── Test 8: tryCuration returns "create" with no embedding ────────────────

describe("tryCuration", () => {
  it("returns action='create' when embedding is null", () => {
    const store = makeStore();
    const { action, mergedId } = tryCuration("content", null, false, store, [] as string[]);
    expect(action).toBe("create");
    expect(mergedId).toBeNull();
  });

  it("returns action='create' when force=true", () => {
    const store = makeStore();
    const emb = Buffer.from([1, 2, 3]);
    const { action } = tryCuration("content", emb, true, store, [] as string[]);
    expect(action).toBe("create");
  });

  it("returns action='create' when no candidates found", () => {
    const store = makeStore({ searchVectors: () => [] });
    const emb = Buffer.from([1, 2, 3]);
    const { action } = tryCuration("content", emb, false, store, [] as string[]);
    expect(action).toBe("create");
  });
});

// ── Test 9: updateUserMoodEma non-user source ─────────────────────────────

describe("updateUserMoodEma", () => {
  it("returns null for non-user source", () => {
    const store = makeStore();
    const result = updateUserMoodEma("content", "tool", store);
    expect(result).toBeNull();
  });

  it("returns null when store lacks getUserMood/setUserMood", () => {
    const store = makeStore();
    const result = updateUserMoodEma("content", "user", store);
    expect(result).toBeNull();
  });

  it("returns a number for user source with mood API", () => {
    let storedMood = 0;
    const store = makeStore() as unknown as MemoryStore & {
      getUserMood: () => number;
      setUserMood: (v: number) => void;
    };
    (store as Record<string, unknown>)["getUserMood"] = () => storedMood;
    (store as Record<string, unknown>)["setUserMood"] = (v: number) => { storedMood = v; };

    const result = updateUserMoodEma("great success resolved", "user", store);
    expect(typeof result).toBe("number");
    expect(result).toBeGreaterThanOrEqual(-1.0);
    expect(result).toBeLessThanOrEqual(1.0);
  });
});

// ── Test 10: estimateImportance ───────────────────────────────────────────

describe("estimateImportance", () => {
  it("returns 1.0 for 'decision' tag", () => {
    expect(estimateImportance("some content", ["decision"])).toBe(1.0);
  });
  it("returns 0.9 for 'error' tag", () => {
    expect(estimateImportance("some content", ["error"])).toBe(0.9);
  });
  it("returns 0.3 for very short content", () => {
    expect(estimateImportance("hi", [])).toBe(0.3);
  });
  it("returns 0.7 for long content", () => {
    const longContent = "word ".repeat(120);
    expect(estimateImportance(longContent, [])).toBe(0.7);
  });
});
