/**
 * Tests for remember-helpers.ts
 *
 * source: cortex@ed33435 mcp_server/handlers/remember_helpers.py
 *
 * Invariants tested:
 *   1.  approximateVaderCompound — range [-1,1], case-insensitive, empty→0
 *   2.  computeSimilarities — returns empty when embedding is null
 *   3.  evaluateGate — gate_reason=="forced" when force=true
 *   4.  computeGateDecision — decision-tag content bypasses gate
 *   5.  isDecisionContent — detects decision markers
 *   6.  classifyStoreType — episodic default, semantic for definitions
 *   7.  buildInsertRecord — all fields populated
 *   8.  applyModulations — heat clamped to [0,1]
 *   9.  tryCuration — returns "create" when no embedding
 *  10.  updateUserMoodEma — returns null for non-user sources; EMA decay
 *  11.  estimateImportance — decision tags → 1.0
 */

import { describe, it, expect, vi } from "vitest";
import {
  approximateVaderCompound,
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
  type MoodStore,
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

// ── Test 1: approximateVaderCompound ──────────────────────────────────────

describe("approximateVaderCompound", () => {
  it("returns 0.0 for empty text", () => {
    expect(approximateVaderCompound("")).toBe(0.0);
  });

  it("returns positive value for clearly positive text", () => {
    const result = approximateVaderCompound("This is excellent! The bug is fixed and works great.");
    expect(result).toBeGreaterThan(0.0);
  });

  it("returns negative value for clearly negative text", () => {
    const result = approximateVaderCompound("Error: crash! The bug broke everything. Problem detected.");
    expect(result).toBeLessThan(0.0);
  });

  it("returns value in [-1, 1]", () => {
    for (const text of [
      "great success",
      "error bug fail",
      "neutral text about something",
      "",
      "good good good good error error",
    ]) {
      const v = approximateVaderCompound(text);
      expect(v).toBeGreaterThanOrEqual(-1.0);
      expect(v).toBeLessThanOrEqual(1.0);
    }
  });

  it("is case-insensitive", () => {
    const lower = approximateVaderCompound("great success");
    const upper = approximateVaderCompound("GREAT SUCCESS");
    expect(lower).toBeCloseTo(upper, 4);
  });
});

// ── Test 2: computeSimilarities with null embedding ───────────────────────

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

// ── Test 3: evaluateGate forced bypass ───────────────────────────────────

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

// ── Test 4: computeGateDecision decision-tag bypass ───────────────────────

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

// ── Test 5: isDecisionContent ─────────────────────────────────────────────

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

// ── Test 6: classifyStoreType ─────────────────────────────────────────────

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

// ── Test 7: buildInsertRecord ─────────────────────────────────────────────

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

// ── Test 8: applyModulations heat clamping ────────────────────────────────

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

// ── Test 9: tryCuration returns "create" with no embedding ────────────────

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

// ── Test 10: updateUserMoodEma ────────────────────────────────────────────

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

  it("returns null when source is not 'user' (MoodStore variant)", () => {
    const store: MoodStore = { getUserMood: vi.fn(), setUserMood: vi.fn() };
    const result = updateUserMoodEma("great success", "tool", store);
    expect(result).toBeNull();
    expect(store.setUserMood).not.toHaveBeenCalled();
  });

  it("returns null when store lacks mood methods (MoodStore variant)", () => {
    const store: MoodStore = {}; // no getUserMood / setUserMood
    const result = updateUserMoodEma("great success", "user", store);
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

  it("updates mood EMA for source='user' (MoodStore variant)", () => {
    let storedMood: number | null = null;
    const store: MoodStore = {
      getUserMood: () => storedMood,
      setUserMood: (v: number) => { storedMood = v; },
    };

    const result = updateUserMoodEma("The fix works and is great!", "user", store);

    expect(result).not.toBeNull();
    expect(typeof result).toBe("number");
    expect(storedMood).not.toBeNull();
    expect(result!).toBeGreaterThanOrEqual(-1.0);
    expect(result!).toBeLessThanOrEqual(1.0);
  });

  it("EMA decays from previous value (α=0.3)", () => {
    // source: MOOD_EMA_ALPHA = 0.3 — remember_helpers.py:426
    // With old=0.0 and compound>0, new = (1-0.3)*0 + 0.3*compound = 0.3*compound
    let storedMood: number | null = 0.0;
    const store: MoodStore = {
      getUserMood: () => storedMood,
      setUserMood: (v: number) => { storedMood = v; },
    };

    const compound = approximateVaderCompound("great success fixed works");
    const result = updateUserMoodEma("great success fixed works", "user", store);

    if (compound > 0 && result !== null) {
      const expected = 0.3 * compound; // (1-0.3)*0 + 0.3*compound
      expect(result).toBeCloseTo(expected, 2);
    } else {
      expect(result).toBeCloseTo(0.0, 4);
    }
  });

  it("returns null (not throws) when setUserMood throws", () => {
    const store: MoodStore = {
      getUserMood: () => 0.5,
      setUserMood: () => { throw new Error("DB down"); },
    };

    const result = updateUserMoodEma("great content", "user", store);
    expect(result).toBeNull(); // Never throws — failures swallowed
  });
});

// ── Test 11: estimateImportance ───────────────────────────────────────────

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
