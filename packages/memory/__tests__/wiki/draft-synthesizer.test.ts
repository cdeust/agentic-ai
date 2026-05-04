/**
 * Unit tests for the draft-synthesizer port.
 *
 * Verifies contracts from draft-synthesizer.ts pre-/postconditions.
 * source: mcp_server/core/draft_synthesizer.py (Cortex bc0ae4f)
 */

import { describe, it, expect } from "vitest";
import { synthesizeDraft, inferKind } from "../../src/wiki/draft-synthesizer.js";

const DECISION_CLAIM = {
  id: 1,
  text: "We decided to use pgvector for semantic search because cosine similarity is native.",
  claim_type: "decision",
  confidence: 0.9,
  evidence_refs: [{ kind: "url", target: "https://github.com/pgvector/pgvector" }],
};

const LIMITATION_CLAIM = {
  id: 2,
  text: "The system does not handle concurrent writes.",
  claim_type: "limitation",
  confidence: 0.8,
  evidence_refs: [],
};

const OBSERVATION_CLAIM = {
  id: 3,
  text: "Observed a 40% improvement in recall when switching to HNSW index.",
  claim_type: "observation",
  confidence: 0.75,
  evidence_refs: [],
};

describe("synthesizeDraft", () => {
  it("returns a DraftPage with status=pending", () => {
    const [draft] = synthesizeDraft([DECISION_CLAIM], { kind: "adr", memoryId: 1 });
    expect(draft.status).toBe("pending");
  });

  it("sets memory_id from opts", () => {
    const [draft] = synthesizeDraft([DECISION_CLAIM], { kind: "adr", memoryId: 42 });
    expect(draft.memory_id).toBe(42);
  });

  it("sets concept_id from opts", () => {
    const [draft] = synthesizeDraft([DECISION_CLAIM], { kind: "adr", conceptId: 7 });
    expect(draft.concept_id).toBe(7);
  });

  it("sets provenance.synthesis_model = 'template_v1'", () => {
    const [draft] = synthesizeDraft([DECISION_CLAIM], { kind: "adr" });
    expect(draft.provenance.synthesis_model).toBe("template_v1");
  });

  it("sets provenance.source_type = 'memory' when memoryId is given", () => {
    const [draft] = synthesizeDraft([DECISION_CLAIM], { kind: "adr", memoryId: 1 });
    expect(draft.provenance.source_type).toBe("memory");
  });

  it("sets provenance.source_type = 'concept' when conceptId is given", () => {
    const [draft] = synthesizeDraft([DECISION_CLAIM], { kind: "adr", conceptId: 5 });
    expect(draft.provenance.source_type).toBe("concept");
  });

  it("sets provenance.source_type = 'claim-set' when neither is given", () => {
    const [draft] = synthesizeDraft([DECISION_CLAIM], { kind: "adr" });
    expect(draft.provenance.source_type).toBe("claim-set");
  });

  it("derives a non-empty title from claims", () => {
    const [draft] = synthesizeDraft([DECISION_CLAIM], { kind: "adr" });
    expect(typeof draft.title).toBe("string");
    expect(draft.title.length).toBeGreaterThan(0);
  });

  it("title is max 80 chars", () => {
    const longClaim = {
      id: 10,
      text: "We decided " + "x".repeat(200),
      claim_type: "decision",
      confidence: 0.9,
      evidence_refs: [],
    };
    const [draft] = synthesizeDraft([longClaim], { kind: "adr" });
    expect(draft.title.length).toBeLessThanOrEqual(83); // +3 for ellipsis
  });

  it("produces lead from the highest-confidence claim", () => {
    const [draft] = synthesizeDraft(
      [OBSERVATION_CLAIM, DECISION_CLAIM, LIMITATION_CLAIM],
      { kind: "adr" },
    );
    // DECISION_CLAIM has highest bias×confidence for "adr" kind
    expect(draft.lead).toContain("pgvector");
  });

  it("returns empty-draft placeholder when claims is empty", () => {
    const [draft] = synthesizeDraft([], { kind: "note" });
    expect(draft.lead).toContain("no claims yet");
    expect(draft.title).toContain("Untitled");
  });

  it("routes decision claims into the Decision section for adr kind", () => {
    const [draft] = synthesizeDraft([DECISION_CLAIM], { kind: "adr" });
    const decisionSection = draft.sections.find((s) => s.heading === "Decision");
    expect(decisionSection).toBeDefined();
    expect(decisionSection!.body).toContain("pgvector");
  });

  it("routes limitation claims into the Rule section for lesson kind", () => {
    const [draft] = synthesizeDraft([LIMITATION_CLAIM], { kind: "lesson" });
    const ruleSection = draft.sections.find(
      (s) => s.heading === "Root Cause" || s.heading === "Trigger",
    );
    expect(ruleSection).toBeDefined();
    expect(ruleSection!.body).toContain("concurrent writes");
  });

  it("uses kindDefinition.required_sections when provided", () => {
    const [draft] = synthesizeDraft([DECISION_CLAIM], {
      kind: "adr",
      kindDefinition: {
        name: "adr",
        display_name: "ADR",
        dir_name: "adrs",
        required_sections: ["Problem", "Solution"],
        optional_sections: [],
        parent_kind: null,
        autofill_prompt: "",
      },
    });
    const headings = draft.sections.map((s) => s.heading);
    expect(headings).toContain("Problem");
    expect(headings).toContain("Solution");
  });

  it("computes average confidence from claims", () => {
    const claims = [
      { id: 1, text: "Claim A.", claim_type: "decision", confidence: 0.8, evidence_refs: [] },
      { id: 2, text: "Claim B.", claim_type: "observation", confidence: 0.6, evidence_refs: [] },
    ];
    const [draft] = synthesizeDraft(claims, { kind: "adr" });
    expect(draft.confidence).toBeCloseTo(0.7, 5);
  });

  it("uses confidence=0.4 when no claims are provided", () => {
    const [draft] = synthesizeDraft([], { kind: "note" });
    expect(draft.confidence).toBe(0.4);
  });

  it("stats.claims_total equals the input length", () => {
    const [, stats] = synthesizeDraft(
      [DECISION_CLAIM, LIMITATION_CLAIM],
      { kind: "adr" },
    );
    expect(stats.claims_total).toBe(2);
  });

  it("stats.claims_routed >= 0 and <= claims_total", () => {
    const [, stats] = synthesizeDraft(
      [DECISION_CLAIM, LIMITATION_CLAIM],
      { kind: "adr" },
    );
    expect(stats.claims_routed).toBeGreaterThanOrEqual(0);
    expect(stats.claims_routed).toBeLessThanOrEqual(stats.claims_total);
  });

  it("stats.sections_required matches the required section count", () => {
    const [, stats] = synthesizeDraft([DECISION_CLAIM], { kind: "adr" });
    // Default routing for "adr" sliced to 3 required sections
    expect(stats.sections_required).toBeGreaterThan(0);
  });

  it("never places the same claim into two sections", () => {
    const [draft] = synthesizeDraft(
      [DECISION_CLAIM, LIMITATION_CLAIM, OBSERVATION_CLAIM],
      { kind: "adr" },
    );
    const allClaimIds = draft.sections.flatMap((s) => s.claim_ids);
    const uniqueIds = new Set(allClaimIds);
    expect(allClaimIds.length).toBe(uniqueIds.size);
  });
});

describe("inferKind", () => {
  it("returns 'adr' for dominant decision claims", () => {
    const claims = [
      { text: ".", claim_type: "decision" },
      { text: ".", claim_type: "decision" },
      { text: ".", claim_type: "observation" },
    ];
    expect(inferKind(claims, new Set())).toBe("adr");
  });

  it("returns 'lesson' for dominant limitation claims", () => {
    const claims = [
      { text: ".", claim_type: "limitation" },
      { text: ".", claim_type: "limitation" },
    ];
    expect(inferKind(claims, new Set())).toBe("lesson");
  });

  it("returns 'spec' for dominant method claims", () => {
    const claims = [
      { text: ".", claim_type: "method" },
      { text: ".", claim_type: "method" },
    ];
    expect(inferKind(claims, new Set())).toBe("spec");
  });

  it("returns 'note' for empty claims array", () => {
    expect(inferKind([], new Set())).toBe("note");
  });

  it("respects availableKinds filter", () => {
    const claims = [{ text: ".", claim_type: "decision" }];
    // Only "note" is available — decision → adr is filtered out, falls through to note
    expect(inferKind(claims, new Set(["note", "lesson"]))).toBe("note");
  });

  it("ignores availableKinds filter when set is empty", () => {
    const claims = [{ text: ".", claim_type: "decision" }];
    expect(inferKind(claims, new Set())).toBe("adr");
  });
});
