/**
 * Template-driven draft page synthesizer — Phase 2.3 Path A.
 *
 * Takes a set of resolved ClaimEvent rows + a target kind, produces a
 * DraftPage with kind-specific structure. Deterministic, no LLM call.
 *
 * Routing per kind: each claim_type maps to a target section.
 * The lead is synthesised from the highest-confidence claim.
 *
 * Pure logic, no I/O. The handler wires this against pg_store_wiki and
 * the schema-loader's KindDefinition registry.
 *
 * source: mcp_server/core/draft_synthesizer.py (Cortex bc0ae4f)
 */

import type { KindDefinition } from "./schema-loader.js";
import type { DraftPage, Section, Provenance } from "./types.js";

// ── Per-kind claim_type → section routing ─────────────────────────────────
//
// Hardcoded defaults. A future phase migrates these into the KindDefinition
// frontmatter. source: mcp_server/core/draft_synthesizer.py:32-68

const DEFAULT_ROUTING: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  adr: {
    Context: ["observation", "method", "limitation"],
    Decision: ["decision"],
    Consequences: ["result", "limitation"],
    "Alternatives Considered": ["question"],
    References: ["reference"],
  },
  spec: {
    Scope: ["decision", "observation"],
    Inputs: ["method"],
    Outputs: ["method", "result"],
    Invariants: ["decision", "method"],
    "Non-Goals": ["limitation"],
    "Error Modes": ["limitation"],
    References: ["reference"],
  },
  lesson: {
    Trigger: ["observation", "limitation"],
    "Root Cause": ["limitation", "observation"],
    Rule: ["decision", "method"],
    Evidence: ["result", "reference"],
    Detection: ["observation", "method"],
  },
  convention: {
    Rule: ["decision", "method"],
    Rationale: ["observation", "decision"],
    Example: ["method", "result"],
    "Counter-Example": ["limitation"],
    References: ["reference"],
  },
  note: {
    Context: ["observation", "method"],
    Observations: ["observation", "result", "method"],
    "Open Questions": ["question", "limitation"],
  },
};

// Score weight per claim type when picking the lead claim.
// source: mcp_server/core/draft_synthesizer.py:71-77
const LEAD_TYPE_BIAS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  adr: { decision: 1.5, method: 1.0, observation: 0.8 },
  spec: { decision: 1.3, method: 1.4, result: 1.0 },
  lesson: { limitation: 1.5, observation: 1.2, decision: 1.0 },
  convention: { decision: 1.5, method: 1.0 },
  note: { observation: 1.2, method: 1.0, decision: 1.0 },
};

// ── Named scoring constants ───────────────────────────────────────────────
//
// All values sourced from mcp_server/core/draft_synthesizer.py.

// source: mcp_server/core/draft_synthesizer.py:96 — default confidence fallback
const DEFAULT_CONFIDENCE = 0.5;
// source: mcp_server/core/draft_synthesizer.py:97 — default lead-type bias fallback
const DEFAULT_LEAD_BIAS = 0.7;
// source: mcp_server/core/draft_synthesizer.py:99 — evidence presence bonus
const EVIDENCE_BONUS = 0.15;
// source: mcp_server/core/draft_synthesizer.py:103 — min chars for length bonus
const LEAD_MIN_CHARS = 50;
// source: mcp_server/core/draft_synthesizer.py:103 — max chars for length bonus
const LEAD_MAX_CHARS = 300;
// source: mcp_server/core/draft_synthesizer.py:104 — mid-length score bonus
const LEAD_LENGTH_BONUS = 0.1;
// source: mcp_server/core/draft_synthesizer.py:106 — short-claim penalty
const LEAD_SHORT_PENALTY = -0.2;
// source: mcp_server/core/draft_synthesizer.py:108 — long-claim threshold
const LEAD_LONG_THRESHOLD = 600;
// source: mcp_server/core/draft_synthesizer.py:109 — long-claim penalty
const LEAD_LONG_PENALTY = -0.1;
// source: mcp_server/core/draft_synthesizer.py:114 — lead truncation cap in chars
const LEAD_TRUNCATE_MAX_CHARS = 280;
// source: mcp_server/core/draft_synthesizer.py:124 — 60% threshold for sentence split
const TRUNCATE_SENTENCE_THRESHOLD = 0.6;
// source: mcp_server/core/draft_synthesizer.py:127 — 70% threshold for word split
const TRUNCATE_WORD_THRESHOLD = 0.7;
// source: mcp_server/core/draft_synthesizer.py:209 — max scan distance for first sentence
const TITLE_MAX_SCAN_CHARS = 120;
// source: mcp_server/core/draft_synthesizer.py:216 — title hard cap in chars
const TITLE_MAX_CHARS = 80;
// source: mcp_server/core/draft_synthesizer.py:217 — ellipsis start position
const TITLE_ELLIPSIS_CUT = 77;
// source: mcp_server/core/draft_synthesizer.py:249 — default required section count
const DEFAULT_REQUIRED_SECTIONS = 3;
// source: mcp_server/core/draft_synthesizer.py (draft confidence fallback for empty corpus)
const EMPTY_CORPUS_CONFIDENCE = 0.4;

// ── Types ─────────────────────────────────────────────────────────────────

export interface ClaimForSynthesis {
  readonly id?: number | null;
  readonly text: string;
  readonly claim_type?: string;
  readonly confidence?: number | null;
  readonly evidence_refs?: readonly unknown[];
  readonly memory_id?: number | null;
}

export interface SynthesisStats {
  readonly claims_total: number;
  readonly claims_routed: number;
  readonly sections_filled: number;
  readonly sections_required: number;
}

// ── Scoring ───────────────────────────────────────────────────────────────

/**
 * Score a claim's fitness to become the lead paragraph.
 *
 * Precondition:  claim is a non-null ClaimForSynthesis; kind is a string.
 * Postcondition: returns a finite float; higher = better candidate for lead.
 *
 * source: mcp_server/core/draft_synthesizer.py:94-111
 */
function leadScore(claim: ClaimForSynthesis, kind: string): number {
  const base = typeof claim.confidence === "number" ? claim.confidence : DEFAULT_CONFIDENCE;
  const bias = (LEAD_TYPE_BIAS[kind] ?? {})[claim.claim_type ?? ""] ?? DEFAULT_LEAD_BIAS;
  const hasEvidence = Array.isArray(claim.evidence_refs) && claim.evidence_refs.length > 0;
  const evidenceBonus = hasEvidence ? EVIDENCE_BONUS : 0.0;
  const length = (claim.text ?? "").length;
  // Mid-length claims make better leads than fragments or blobs.
  // source: mcp_server/core/draft_synthesizer.py:103-111
  let lengthBonus = 0.0;
  if (length >= LEAD_MIN_CHARS && length <= LEAD_MAX_CHARS) {
    lengthBonus = LEAD_LENGTH_BONUS;
  } else if (length < LEAD_MIN_CHARS) {
    lengthBonus = LEAD_SHORT_PENALTY;
  } else if (length > LEAD_LONG_THRESHOLD) {
    lengthBonus = LEAD_LONG_PENALTY;
  }
  return base * bias + evidenceBonus + lengthBonus;
}

// ── Text helpers ──────────────────────────────────────────────────────────

/**
 * Truncate at a sentence boundary if possible.
 *
 * Precondition:  text is a string; maxChars > 0.
 * Postcondition: result.length <= maxChars (approximately — may overshoot by 1
 *                if the chosen sentence ends at exactly maxChars).
 *
 * source: mcp_server/core/draft_synthesizer.py:114-129
 */
function truncateLead(text: string, maxChars: number = LEAD_TRUNCATE_MAX_CHARS): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  const cut = t.slice(0, maxChars);
  // Prefer ending on a full sentence
  for (const terminator of [". ", "! ", "? "]) {
    const last = cut.lastIndexOf(terminator);
    if (last > maxChars * TRUNCATE_SENTENCE_THRESHOLD) {
      return cut.slice(0, last + 1).trim();
    }
  }
  // Fallback: word boundary
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > maxChars * TRUNCATE_WORD_THRESHOLD) {
    return cut.slice(0, lastSpace).trim() + "…";
  }
  return cut.trim() + "…";
}

function formatClaimsAsProse(claims: readonly ClaimForSynthesis[]): string {
  // source: mcp_server/core/draft_synthesizer.py:184-195
  if (!claims.length) return "_(to be filled)_";
  if (claims.length === 1) return (claims[0]?.text ?? "").trim();
  return claims.map((c) => `- ${(c.text ?? "").trim()}`).join("\n");
}

/**
 * Derive a noun-phrase title from the claim corpus.
 *
 * Postcondition: result is non-empty; ≤ 80 chars.
 * source: mcp_server/core/draft_synthesizer.py:198-220
 */
function deriveTitle(
  claims: readonly ClaimForSynthesis[],
  kind: string,
  leadClaim: ClaimForSynthesis | null,
): string {
  const source = ((leadClaim ?? claims[0])?.text ?? "").trim();
  if (!source) return `Untitled ${kind}`;

  let trimmed = source;
  // Take up to first sentence terminator
  // source: mcp_server/core/draft_synthesizer.py:209
  for (const term of [". ", "! ", "? ", "\n"]) {
    const i = trimmed.indexOf(term);
    if (i > 0 && i < TITLE_MAX_SCAN_CHARS) {
      trimmed = trimmed.slice(0, i).trim();
      break;
    }
  }
  // Strip common imperative / first-person prefixes
  for (const prefix of ["We ", "I ", "Let's ", "Decision: ", "Decided: "]) {
    if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
      trimmed = trimmed.slice(prefix.length).trim();
    }
  }
  if (trimmed.length > TITLE_MAX_CHARS) {
    const cut = trimmed.slice(0, TITLE_ELLIPSIS_CUT);
    const sp = cut.lastIndexOf(" ");
    trimmed = (sp > 0 ? cut.slice(0, sp) : cut) + "…";
  }
  return trimmed || `Untitled ${kind}`;
}

// ── Routing ───────────────────────────────────────────────────────────────

function routeClaimsToSections(
  claims: readonly ClaimForSynthesis[],
  kind: string,
  requiredSections: readonly string[],
  optionalSections: readonly string[],
): [readonly Section[], number] {
  // source: mcp_server/core/draft_synthesizer.py:132-181
  // DEFAULT_ROUTING["note"] is always defined — it's a hardcoded constant in this module.
  const noteRouting = DEFAULT_ROUTING["note"] ?? {};
  const routing = DEFAULT_ROUTING[kind] ?? noteRouting;

  const bySection: Record<string, ClaimForSynthesis[]> = {};
  for (const h of requiredSections) bySection[h] = [];
  for (const h of optionalSections) if (!bySection[h]) bySection[h] = [];

  const seenClaimIds = new Set<number | string>();
  for (const c of claims) {
    const ct = c.claim_type ?? "";
    for (const [heading, acceptedTypes] of Object.entries(routing)) {
      if ((acceptedTypes as readonly string[]).includes(ct) && heading in bySection) {
        // heading was added to bySection above; the lookup is always defined here
        const sectionBucket = bySection[heading];
        if (sectionBucket) sectionBucket.push(c);
        // Use id if present, otherwise object identity key
        seenClaimIds.add(c.id != null ? c.id : String(c.text));
        break; // one section per claim — no duplication
      }
    }
  }

  const sections: Section[] = [];

  for (const heading of requiredSections) {
    const cs = bySection[heading] ?? [];
    sections.push({
      heading,
      body: formatClaimsAsProse(cs),
      claim_ids: cs.flatMap((c) => (c.id != null ? [c.id] : [])),
    });
  }
  for (const heading of optionalSections) {
    const cs = bySection[heading] ?? [];
    if (!cs.length) continue;
    sections.push({
      heading,
      body: formatClaimsAsProse(cs),
      claim_ids: cs.flatMap((c) => (c.id != null ? [c.id] : [])),
    });
  }

  return [sections, seenClaimIds.size];
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Produce a DraftPage from a set of claims for the given kind.
 *
 * Precondition:  claims is an array (may be empty); kind is a non-empty string.
 * Postcondition: returns a DraftPage with status='pending' and a SynthesisStats.
 *                Never throws on empty input (returns an empty-draft placeholder).
 *
 * source: mcp_server/core/draft_synthesizer.py:223-310
 */
export function synthesizeDraft(
  claims: readonly ClaimForSynthesis[],
  opts: {
    readonly kind: string;
    readonly kindDefinition?: KindDefinition | null;
    readonly memoryId?: number | null;
    readonly conceptId?: number | null;
  },
): [DraftPage, SynthesisStats] {
  const { kind, kindDefinition, memoryId, conceptId } = opts;

  // Resolve required/optional sections
  // source: mcp_server/core/draft_synthesizer.py:245-250
  let requiredSections: string[];
  let optionalSections: string[];
  if (kindDefinition != null) {
    requiredSections = [...kindDefinition.required_sections];
    optionalSections = [...kindDefinition.optional_sections];
  } else {
    const fallbackRouting = DEFAULT_ROUTING[kind] ?? DEFAULT_ROUTING["note"] ?? {};
    // source: mcp_server/core/draft_synthesizer.py:249 — take first DEFAULT_REQUIRED_SECTIONS keys
    requiredSections = Object.keys(fallbackRouting).slice(0, DEFAULT_REQUIRED_SECTIONS);
    optionalSections = [];
  }

  // Pick the lead claim — max by lead score
  const leadClaim: ClaimForSynthesis | null = claims.length
    ? claims.reduce((best, c) => leadScore(c, kind) > leadScore(best, kind) ? c : best)
    : null;

  // Build sections
  const [sections, routedCount] = routeClaimsToSections(claims, kind, requiredSections, optionalSections);

  // Build lead paragraph
  const lead = leadClaim ? truncateLead(leadClaim.text ?? "") : "_(no claims yet — empty draft)_";

  // Title
  const title = deriveTitle(claims, kind, leadClaim);

  // Compute average confidence
  const confidences = claims
    .map((c) => (typeof c.confidence === "number" ? c.confidence : null))
    .filter((v): v is number => v !== null);
  const draftConfidence = confidences.length
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : EMPTY_CORPUS_CONFIDENCE;

  // Provenance
  const provenance: Provenance = {
    source_type: conceptId != null ? "concept" : memoryId != null ? "memory" : "claim-set",
    source_ids: conceptId != null ? [conceptId] : memoryId != null ? [memoryId] : [],
    synthesis_model: "template_v1",
    synthesis_prompt_hash: null,
    generated_at: new Date().toISOString(),
  };

  const draft: DraftPage = {
    memory_id: memoryId ?? null,
    concept_id: conceptId ?? null,
    title,
    kind,
    lead,
    sections,
    frontmatter: { updated: new Date().toISOString() },
    provenance,
    confidence: draftConfidence,
    status: "pending",
  };

  const stats: SynthesisStats = {
    claims_total: claims.length,
    claims_routed: routedCount,
    sections_filled: sections.filter(
      (s) => s.body && !s.body.startsWith("_("),
    ).length,
    sections_required: requiredSections.length,
  };

  return [draft, stats];
}

// ── Kind inference ────────────────────────────────────────────────────────

// source: mcp_server/handlers/wiki_synthesize.py:116-126
const TYPE_TO_KIND_AFFINITY: Readonly<Record<string, string>> = {
  decision: "adr",
  limitation: "lesson",
  method: "spec",
  result: "spec",
  observation: "note",
  question: "note",
  reference: "note",
  assertion: "note",
};

/**
 * Pick a target kind from the dominant claim_type.
 *
 * Precondition:  claims may be empty; availableKinds may be empty.
 * Postcondition: returns a valid kind string present in availableKinds
 *                (when non-empty), or "note" as fallback.
 *
 * source: mcp_server/handlers/wiki_synthesize.py:128-141
 */
export function inferKind(
  claims: readonly ClaimForSynthesis[],
  availableKinds: ReadonlySet<string>,
): string {
  if (!claims.length) return "note";

  const counts: Record<string, number> = {};
  for (const c of claims) {
    const k = TYPE_TO_KIND_AFFINITY[c.claim_type ?? ""] ?? "note";
    counts[k] = (counts[k] ?? 0) + 1;
  }

  // Prefer adr / lesson / convention over note when present
  for (const preferred of ["adr", "lesson", "convention", "spec", "note"]) {
    if (counts[preferred]) {
      if (!availableKinds.size || availableKinds.has(preferred)) {
        return preferred;
      }
    }
  }
  return "note";
}
