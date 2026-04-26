/**
 * Wiki pipeline Intermediate Representations.
 *
 * Each IR is a named, inspectable boundary between pipeline phases:
 *
 *   transcript → ClaimEvent[] → Concept[] → DraftPage[] → ApprovedPage[] → rendered
 *
 * Propp grammar note: every wiki page has a finite lifecycle of typed state
 * transitions (functions): Create → Refine → Link → Verify → Retire.
 * Actors (user, LLM, daemon) are interchangeable; the function is primary.
 *
 * Pure data — no I/O. Stdlib only.
 *
 * source: mcp_server/shared/wiki_ir.py
 */

// ── Phase output: transcript → ClaimEvent ─────────────────────────────────

export type ClaimType =
  | "assertion"
  | "decision"
  | "observation"
  | "question"
  | "method"
  | "result"
  | "limitation"
  | "reference";

export type EvidenceKind =
  | "file"
  | "commit"
  | "paper"
  | "memory"
  | "claim"
  | "benchmark"
  | "url";

export interface EvidenceRef {
  readonly kind: EvidenceKind;
  readonly target: string;
  readonly context?: string | null;
}

/**
 * Atomic extracted assertion from a transcript or memory.
 *
 * One claim = one falsifiable/citable unit. If it needs an "and",
 * it should be split into two ClaimEvents.
 */
export interface ClaimEvent {
  readonly id?: number | null;
  readonly memory_id?: number | null;
  readonly session_id: string;
  readonly text: string;
  readonly claim_type: ClaimType;
  readonly entity_ids: readonly number[];
  readonly evidence_refs: readonly EvidenceRef[];
  readonly confidence: number;
  readonly supersedes?: number | null;
  readonly extracted_at?: string | null;
}

// ── Phase output: ClaimEvents → Concept ───────────────────────────────────

export type ConceptStatus =
  | "candidate"
  | "saturating"
  | "promoted"
  | "merged"
  | "split"
  | "abandoned";

/**
 * The four axial-coding slots per Strauss & Corbin.
 *
 * A concept graduates from candidate → saturating when at least
 * three of the four slots are non-empty.
 *
 * source: Strauss, A. & Corbin, J. (1990). Basics of Qualitative Research.
 *         Sage Publications. Chapter 7 (Axial Coding).
 */
export interface AxialSlots {
  readonly conditions: readonly string[];
  readonly context: readonly string[];
  readonly strategies: readonly string[];
  readonly consequences: readonly string[];
}

/**
 * Candidate concept emerging from entity co-occurrence + embedding density.
 *
 * Promotion to page requires:
 *   - ≥ M grounding memories (default M = 3)
 *   - ≥ 3 of 4 axial slots populated
 *   - saturation_streak ≥ N consecutive memories with no new properties
 *     (default N = 5)
 */
export interface Concept {
  readonly id?: number | null;
  readonly label: string;
  readonly status: ConceptStatus;
  readonly entity_ids: readonly number[];
  readonly grounding_memory_ids: readonly number[];
  readonly grounding_claim_ids: readonly number[];
  readonly properties: Readonly<Record<string, readonly string[]>>;
  readonly axial_slots: AxialSlots;
  readonly saturation_rate: number;
  readonly saturation_streak: number;
  readonly first_seen_at?: string | null;
  readonly last_property_at?: string | null;
  readonly promoted_page_id?: number | null;
  readonly merged_into_id?: number | null;
  readonly split_into_ids: readonly number[];
}

// ── Phase output: Concept + Claims → DraftPage ────────────────────────────

export type DraftStatus = "pending" | "approved" | "rejected" | "published";

export interface Section {
  readonly heading: string;
  readonly body: string;
  readonly claim_ids: readonly number[];
}

export interface Provenance {
  readonly source_type: "concept" | "memory" | "user" | "claim-set";
  readonly source_ids: readonly number[];
  readonly synthesis_model?: string | null;
  readonly synthesis_prompt_hash?: string | null;
  readonly generated_at?: string | null;
}

/**
 * Synthesised page awaiting curation (approval/rejection).
 *
 * Produced by the synthesise phase from a Concept + its ClaimEvents.
 * Human or rule-driven gate decides promotion to ApprovedPage.
 */
export interface DraftPage {
  readonly id?: number | null;
  readonly concept_id?: number | null;
  readonly memory_id?: number | null;
  readonly title: string;
  readonly kind: string;
  readonly lead: string;
  readonly sections: readonly Section[];
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly provenance: Provenance;
  readonly confidence: number;
  readonly status: DraftStatus;
}

// ── Phase output: DraftPage → ApprovedPage ────────────────────────────────

export type PageStatus = "seedling" | "budding" | "evergreen";
export type LifecycleState = "active" | "area" | "archived" | "evergreen";

/**
 * Published wiki page with thermodynamic state + facet metadata.
 */
export interface ApprovedPage {
  readonly id?: number | null;
  readonly memory_id?: number | null;
  readonly concept_id?: number | null;
  readonly rel_path: string;
  readonly slug: string;
  readonly kind: string;
  readonly title: string;
  readonly domain: string;
  readonly domains: readonly string[];
  readonly tags: readonly string[];
  readonly audience: readonly string[];
  readonly requires: readonly string[];
  readonly status: PageStatus;
  readonly lifecycle_state: LifecycleState;
  readonly supersedes?: string | null;
  readonly superseded_by?: string | null;
  readonly verified?: string | null;
  readonly lead: string;
  readonly sections: readonly Section[];
  readonly body_hash: string;
  readonly heat: number;
  readonly access_count: number;
  readonly citation_count: number;
  readonly backlink_count: number;
  readonly is_stale: boolean;
  readonly planted?: string | null;
  readonly tended?: string | null;
}

// ── Curation memo (Strauss memoing) ───────────────────────────────────────

export type MemoSubject = "concept" | "draft" | "page" | "claim";

/**
 * The grounded-theory memoing layer.
 *
 * Captures *why* a decision was made: the inputs considered, the
 * alternatives rejected, and the confidence. Without this, grounded
 * theory is not grounded.
 *
 * source: Glaser, B. & Strauss, A. (1967). The Discovery of Grounded Theory.
 *         Aldine Publishing. Chapter 5 (Theoretical Memos).
 */
export interface CurationMemo {
  readonly id?: number | null;
  readonly subject_type: MemoSubject;
  readonly subject_id: number;
  readonly decision: string;
  readonly rationale: string;
  readonly alternatives: readonly Readonly<Record<string, unknown>>[];
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly confidence: number;
  readonly author: string;
  readonly created_at?: string | null;
}

// ── Wiki page kinds ───────────────────────────────────────────────────────

export type WikiKind =
  | "adr"
  | "specs"
  | "guides"
  | "reference"
  | "conventions"
  | "lessons"
  | "notes"
  | "journal"
  | "files";

export interface WikiPage {
  readonly path: string;
  readonly kind: WikiKind;
  readonly content: string;
}

export interface Citation {
  readonly kind: "paper" | "url" | "doi" | "arxiv";
  readonly ref: string;
  readonly context?: string;
}

export interface Link {
  readonly relation: string;
  readonly target: string;
}

// ── Write result ──────────────────────────────────────────────────────────

export interface WriteResult {
  readonly path: string;
  readonly mode: string;
  readonly created: boolean;
  readonly bytes_written: number;
}

// ── Errors ────────────────────────────────────────────────────────────────

export class WikiExists extends Error {
  constructor(path: string) {
    super(`wiki page already exists: ${path}`);
    this.name = "WikiExists";
  }
}

export class WikiMissing extends Error {
  constructor(path: string) {
    super(`wiki page not found: ${path}`);
    this.name = "WikiMissing";
  }
}
