/**
 * Phase 3 — Concept emergence (Strauss grounded-theory mechanics).
 *
 * Inputs:
 *   claim_events with entity_ids and claim_type
 *   existing wiki.concepts state (for incremental update)
 *
 * Outputs:
 *   EmergencePlans the handler persists into wiki.concepts:
 *     - new candidate concepts (clusters)
 *     - axial_slot updates
 *     - saturation_streak / status transitions
 *     - merge / split / promote candidates
 *
 * Algorithm (deterministic, server-side, no LLM):
 *
 *   1. Group claims by entity_id → per-entity claim sets
 *   2. For each entity with ≥ MIN_CLAIMS_PER_CONCEPT claims, form a
 *      candidate concept with that entity as its center
 *   3. Merge candidates whose claim_id sets overlap > MERGE_JACCARD
 *   4. For each (existing or new) concept, compute:
 *      - axial_slots: distribute claim texts by claim_type into
 *        Strauss's four buckets (conditions, context, strategies,
 *        consequences)
 *      - new_properties_this_pass: claim types/phrases not seen before
 *      - saturation_rate: rolling rate of new_properties / new_memories
 *      - saturation_streak: consecutive memories that added nothing
 *   5. Promote a concept to 'saturating' when saturation_streak ≥ 3
 *   6. Promote to 'promoted' (ready for synthesis) when:
 *      - len(grounding_memory_ids) ≥ MIN_GROUNDING_MEMORIES
 *      - axial_slots: ≥ 3 of 4 non-empty
 *      - saturation_streak ≥ 5
 *
 * Pure logic, no I/O.
 *
 * source: mcp_server/core/concept_emerger.py
 * source: Strauss, A. & Corbin, J. (1990). Basics of Qualitative Research.
 *         Sage Publications. Chapters 7–9 (Axial Coding & Saturation).
 * source: Glaser, B. & Strauss, A. (1967). The Discovery of Grounded Theory.
 *         Aldine Publishing. Chapter 5 (Theoretical Sampling).
 */

import type { ConceptStatus } from "./types.js";

// ── Tunable thresholds ────────────────────────────────────────────────────

export const MIN_CLAIMS_PER_CONCEPT = 3;
export const MERGE_JACCARD = 0.5;
export const SATURATION_PROMOTE_STREAK = 3;
export const PROMOTION_PROMOTE_STREAK = 5;
export const MIN_GROUNDING_MEMORIES = 3;
export const MIN_AXIAL_SLOTS_FILLED = 3;
export const ABANDON_AFTER_DAYS = 60;

export const COLD_START_MEMORY_THRESHOLD = 50;
export const COLD_START_MIN_CLAIMS_PER_CONCEPT = 1;
export const COLD_START_SATURATION_STREAK = 1;
export const COLD_START_PROMOTION_STREAK = 2;
export const COLD_START_MIN_GROUNDING_MEMORIES = 1;
export const COLD_START_MIN_AXIAL_SLOTS_FILLED = 2;

// ── Axial coding ──────────────────────────────────────────────────────────
//
// Strauss & Corbin's coding paradigm — distribute claims into four
// slots that together describe the concept structurally:
//
//   conditions   — what gives rise to the phenomenon
//   context      — the conditions in which strategies are taken
//   strategies   — actions/methods used
//   consequences — what results
//
// source: Strauss & Corbin (1990) Chapter 7 (Axial Coding Paradigm)

const AXIAL_FROM_CLAIM_TYPE: Readonly<Record<string, string>> = {
  observation: "conditions",
  limitation: "conditions",
  decision: "strategies",
  method: "strategies",
  result: "consequences",
  reference: "context",
  question: "context",
  assertion: "context",
} as const;

// ── Plan types ────────────────────────────────────────────────────────────

export interface ConceptPlan {
  readonly concept_id: number | null;
  readonly label: string;
  readonly entity_ids: readonly number[];
  readonly grounding_memory_ids: readonly number[];
  readonly grounding_claim_ids: readonly number[];
  readonly properties: Readonly<Record<string, readonly string[]>>;
  readonly axial_slots: Readonly<Record<string, readonly string[]>>;
  readonly saturation_rate: number;
  readonly saturation_streak: number;
  readonly status: ConceptStatus;
}

export interface EmergenceStats {
  readonly candidate_concepts: number;
  readonly promoted: number;
  readonly saturating: number;
  readonly abandoned: number;
  readonly claims_grouped: number;
  readonly new_concepts: number;
  readonly updated_concepts: number;
}

export interface EmergenceThresholds {
  readonly min_claims_per_concept?: number;
  readonly saturation_streak?: number;
  readonly promotion_streak?: number;
  readonly min_grounding_memories?: number;
  readonly min_axial_slots_filled?: number;
}

export type ClaimForEmergence = {
  readonly id?: number | null;
  readonly memory_id?: number | null;
  readonly text?: string | null;
  readonly claim_type?: string | null;
  readonly entity_ids?: readonly number[] | null;
  [key: string]: unknown;
};

export type ExistingConcept = {
  readonly id?: number | null;
  readonly label?: string | null;
  readonly status?: ConceptStatus | null;
  readonly entity_ids?: readonly number[] | null;
  readonly grounding_memory_ids?: readonly number[] | null;
  readonly grounding_claim_ids?: readonly number[] | null;
  readonly properties?: Readonly<Record<string, readonly string[]>> | null;
  readonly axial_slots?: Readonly<Record<string, readonly string[]>> | null;
  readonly saturation_streak?: number | null;
  [key: string]: unknown;
};

// ── Helpers ───────────────────────────────────────────────────────────────

function entityLabel(claimTexts: readonly string[], entityId: number): string {
  if (!claimTexts.length) return `concept-${entityId}`;
  const counts = new Map<string, number>();
  for (const t of claimTexts) {
    for (const m of t.matchAll(/\b([A-Z][a-zA-Z]+|[a-z]+_[a-z_]+)\b/g)) {
      const tok = m[1]!;
      if (tok.length >= 3 && tok.length <= 40) {
        counts.set(tok, (counts.get(tok) ?? 0) + 1);
      }
    }
  }
  if (!counts.size) return `concept-${entityId}`;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]!;
}

function jaccard(a: ReadonlySet<number>, b: ReadonlySet<number>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

function axialDistribution(claims: readonly ClaimForEmergence[]): Record<string, string[]> {
  const slots: Record<string, string[]> = {
    conditions: [],
    context: [],
    strategies: [],
    consequences: [],
  };
  for (const c of claims) {
    const slot = AXIAL_FROM_CLAIM_TYPE[c.claim_type ?? ""] ?? "context";
    const text = (c.text ?? "").trim();
    if (text && !(slots[slot] ?? []).includes(text)) {
      (slots[slot] ??= []).push(text.slice(0, 300));
    }
  }
  return slots;
}

function propertiesFromClaims(claims: readonly ClaimForEmergence[]): Record<string, string[]> {
  const props: Record<string, string[]> = {};
  for (const c of claims) {
    const ct = c.claim_type ?? "assertion";
    const fp = (c.text ?? "").trim().slice(0, 80);
    if (!fp) continue;
    if (!props[ct]) props[ct] = [];
    if (!props[ct]!.includes(fp)) props[ct]!.push(fp);
  }
  return props;
}

function countAxialSlotsFilled(slots: Readonly<Record<string, readonly string[]>>): number {
  return Object.values(slots).filter((v) => v.length > 0).length;
}

// ── Clustering ────────────────────────────────────────────────────────────

interface Cluster {
  centerEntity: number;
  entityIds: Set<number>;
  claimIds: Set<number>;
  memoryIds: Set<number>;
}

function clusterByEntity(
  claims: readonly ClaimForEmergence[],
  minClaims: number = MIN_CLAIMS_PER_CONCEPT,
): Cluster[] {
  const byEntity = new Map<number, Cluster>();

  for (const c of claims) {
    const cid = c.id;
    const mid = c.memory_id;
    for (const eid of c.entity_ids ?? []) {
      if (!byEntity.has(eid)) {
        byEntity.set(eid, { centerEntity: eid, entityIds: new Set(), claimIds: new Set(), memoryIds: new Set() });
      }
      const cluster = byEntity.get(eid)!;
      cluster.entityIds.add(eid);
      if (cid != null) cluster.claimIds.add(cid);
      if (mid != null) cluster.memoryIds.add(mid);
    }
  }

  const seeds = [...byEntity.values()].filter((c) => c.claimIds.size >= minClaims);
  seeds.sort((a, b) => b.claimIds.size - a.claimIds.size);

  const merged: Cluster[] = [];
  for (const seed of seeds) {
    let absorbed = false;
    for (const existing of merged) {
      if (jaccard(seed.claimIds, existing.claimIds) >= MERGE_JACCARD) {
        for (const e of seed.entityIds) existing.entityIds.add(e);
        for (const c of seed.claimIds) existing.claimIds.add(c);
        for (const m of seed.memoryIds) existing.memoryIds.add(m);
        absorbed = true;
        break;
      }
    }
    if (!absorbed) merged.push(seed);
  }
  return merged;
}

// ── Saturation detection ──────────────────────────────────────────────────

function saturationUpdate(
  existingProps: Readonly<Record<string, readonly string[]>>,
  existingMemoryIds: ReadonlySet<number>,
  existingStreak: number,
  newProps: Readonly<Record<string, readonly string[]>>,
  newMemoryIds: ReadonlySet<number>,
): [number, number] {
  const deltaMemories = [...newMemoryIds].filter((m) => !existingMemoryIds.has(m));
  let newPropertyCount = 0;
  for (const [ct, fps] of Object.entries(newProps)) {
    const existingSet = new Set(existingProps[ct] ?? []);
    for (const fp of fps) {
      if (!existingSet.has(fp)) newPropertyCount++;
    }
  }
  const nDeltaMems = deltaMemories.length;
  if (nDeltaMems === 0) return [0.0, existingStreak];
  const rate = newPropertyCount / nDeltaMems;
  if (rate === 0) return [0.0, existingStreak + 1];
  return [rate, 0];
}

function decideStatus(args: {
  grounding_memory_count: number;
  axial_slots_filled: number;
  saturation_streak: number;
  current_status: ConceptStatus;
  thresholds?: EmergenceThresholds | null;
}): ConceptStatus {
  const t = args.thresholds ?? {};
  const minGrounding = t.min_grounding_memories ?? MIN_GROUNDING_MEMORIES;
  const minAxial = t.min_axial_slots_filled ?? MIN_AXIAL_SLOTS_FILLED;
  const promoteStreak = t.promotion_streak ?? PROMOTION_PROMOTE_STREAK;
  const saturateStreak = t.saturation_streak ?? SATURATION_PROMOTE_STREAK;

  if (args.current_status === "merged" || args.current_status === "split" || args.current_status === "abandoned") {
    return args.current_status;
  }
  if (args.current_status === "promoted") return "promoted";
  if (
    args.grounding_memory_count >= minGrounding &&
    args.axial_slots_filled >= minAxial &&
    args.saturation_streak >= promoteStreak
  ) {
    return "promoted";
  }
  if (args.saturation_streak >= saturateStreak) return "saturating";
  return "candidate";
}

// ── Threshold bundles ─────────────────────────────────────────────────────

/**
 * Threshold bundle for a small corpus (< COLD_START_MEMORY_THRESHOLD).
 *
 * Handlers call this when memory counts are low and pass the result
 * through emerge(..., thresholds=...). Once the corpus grows past
 * the threshold the handler should stop passing this bundle.
 */
export function coldStartThresholds(): EmergenceThresholds {
  return {
    min_claims_per_concept: COLD_START_MIN_CLAIMS_PER_CONCEPT,
    saturation_streak: COLD_START_SATURATION_STREAK,
    promotion_streak: COLD_START_PROMOTION_STREAK,
    min_grounding_memories: COLD_START_MIN_GROUNDING_MEMORIES,
    min_axial_slots_filled: COLD_START_MIN_AXIAL_SLOTS_FILLED,
  };
}

// ── Public entry point ────────────────────────────────────────────────────

export interface EmergeArgs {
  readonly claims: readonly ClaimForEmergence[];
  readonly existingConceptsByEntities: Readonly<Record<string | number, ExistingConcept>>;
  readonly thresholds?: EmergenceThresholds | null;
}

/**
 * Run a single emergence pass.
 *
 * Returns (plans, stats). Each ConceptPlan is either:
 *   - a new candidate (concept_id=null) → handler INSERTs
 *   - an update to an existing concept (concept_id set) → handler UPSERTs
 *
 * Never raises on bad input.
 */
export function emerge(args: EmergeArgs): [ConceptPlan[], EmergenceStats] {
  const { claims, existingConceptsByEntities, thresholds } = args;

  if (!claims.length) {
    return [[], { candidate_concepts: 0, promoted: 0, saturating: 0, abandoned: 0, claims_grouped: 0, new_concepts: 0, updated_concepts: 0 }];
  }

  const minClaims = thresholds?.min_claims_per_concept ?? MIN_CLAIMS_PER_CONCEPT;
  const clusters = clusterByEntity(claims, minClaims);
  const plans: ConceptPlan[] = [];
  let promoted = 0, saturating = 0, abandoned = 0, newConcepts = 0, updatedConcepts = 0, claimsGrouped = 0;

  const claimsById = new Map<number, ClaimForEmergence>();
  for (const c of claims) {
    if (c.id != null) claimsById.set(c.id, c);
  }

  for (const cluster of clusters) {
    const clusterClaims = [...cluster.claimIds]
      .map((cid) => claimsById.get(cid))
      .filter((c): c is ClaimForEmergence => c !== undefined);
    if (!clusterClaims.length) continue;
    claimsGrouped += clusterClaims.length;

    // Match an existing concept by entity-overlap
    let existing: ExistingConcept | null = null;
    let bestOverlap = 0;
    for (const ec of Object.values(existingConceptsByEntities)) {
      const ecEntities = new Set<number>((ec.entity_ids ?? []) as number[]);
      let overlap = 0;
      for (const e of cluster.entityIds) if (ecEntities.has(e)) overlap++;
      if (overlap > bestOverlap) { bestOverlap = overlap; existing = ec; }
    }

    const newProps = propertiesFromClaims(clusterClaims);
    const newAxial = axialDistribution(clusterClaims);

    if (existing) {
      const existingProps = existing.properties ?? {};
      const existingMemoryIds = new Set<number>((existing.grounding_memory_ids ?? []) as number[]);
      const existingStreak = existing.saturation_streak ?? 0;
      const currentStatus: ConceptStatus = (existing.status ?? "candidate") as ConceptStatus;

      const [rate, streak] = saturationUpdate(existingProps, existingMemoryIds, existingStreak, newProps, cluster.memoryIds);

      // Merge property sets
      const mergedProps: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(existingProps)) mergedProps[k] = [...v];
      for (const [k, vs] of Object.entries(newProps)) {
        if (!mergedProps[k]) mergedProps[k] = [];
        for (const v of vs) if (!mergedProps[k]!.includes(v)) mergedProps[k]!.push(v);
      }

      const mergedAxial: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(existing.axial_slots ?? {})) mergedAxial[k] = [...v];
      for (const [k, vs] of Object.entries(newAxial)) {
        if (!mergedAxial[k]) mergedAxial[k] = [];
        for (const v of vs) if (!mergedAxial[k]!.includes(v)) mergedAxial[k]!.push(v);
      }

      const mergedMemoryIds = [...new Set([...existingMemoryIds, ...cluster.memoryIds])].sort((a, b) => a - b);
      const mergedClaimIds = [...new Set([...(existing.grounding_claim_ids ?? []) as number[], ...cluster.claimIds])].sort((a, b) => a - b);
      const mergedEntityIds = [...new Set([...(existing.entity_ids ?? []) as number[], ...cluster.entityIds])].sort((a, b) => a - b);

      const newStatus = decideStatus({
        grounding_memory_count: mergedMemoryIds.length,
        axial_slots_filled: countAxialSlotsFilled(mergedAxial),
        saturation_streak: streak,
        current_status: currentStatus,
        thresholds,
      });

      plans.push({
        concept_id: existing.id ?? null,
        label: existing.label ?? entityLabel(clusterClaims.map((c) => c.text ?? ""), cluster.centerEntity),
        entity_ids: mergedEntityIds,
        grounding_memory_ids: mergedMemoryIds,
        grounding_claim_ids: mergedClaimIds,
        properties: mergedProps,
        axial_slots: mergedAxial,
        saturation_rate: rate,
        saturation_streak: streak,
        status: newStatus,
      });
      updatedConcepts++;
    } else {
      const label = entityLabel(clusterClaims.map((c) => c.text ?? ""), cluster.centerEntity);
      const status = decideStatus({
        grounding_memory_count: cluster.memoryIds.size,
        axial_slots_filled: countAxialSlotsFilled(newAxial),
        saturation_streak: 0,
        current_status: "candidate",
        thresholds,
      });

      plans.push({
        concept_id: null,
        label,
        entity_ids: [...cluster.entityIds].sort((a, b) => a - b),
        grounding_memory_ids: [...cluster.memoryIds].sort((a, b) => a - b),
        grounding_claim_ids: [...cluster.claimIds].sort((a, b) => a - b),
        properties: newProps,
        axial_slots: newAxial,
        saturation_rate: 1.0,
        saturation_streak: 0,
        status,
      });
      newConcepts++;
    }
  }

  for (const p of plans) {
    if (p.status === "promoted") promoted++;
    else if (p.status === "saturating") saturating++;
    else if (p.status === "abandoned") abandoned++;
  }

  return [
    plans,
    {
      candidate_concepts: plans.length,
      promoted,
      saturating,
      abandoned,
      claims_grouped: claimsGrouped,
      new_concepts: newConcepts,
      updated_concepts: updatedConcepts,
    },
  ];
}
