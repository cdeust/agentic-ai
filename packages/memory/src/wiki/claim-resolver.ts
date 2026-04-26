/**
 * Phase 2.2 — Claim resolution.
 *
 * Three responsibilities:
 *
 *   1. Entity linking — each ClaimEvent inherits its source memory's
 *      entity_ids (the existing memory_entities join table is the
 *      authority). Also harvests inline entity name mentions from claim
 *      text against the entities catalogue.
 *
 *   2. Supersedes resolution — when a claim's text contains
 *      "supersedes / replaces / deprecated by", find the most likely
 *      prior claim it overrides (same entities + earlier in time + same
 *      claim_type when sensible). Writes claim_events.supersedes.
 *
 *   3. Conflict detection — claims about the same entities with
 *      opposing types (decision vs limitation about the same target) are
 *      surfaced as candidates. Writes a memo per detected pair.
 *
 * Pure logic — no I/O. The handler wires this against pg_store_wiki.
 *
 * Design constraint: the resolver must not JOIN into the memories
 * hot path. All inputs are pre-fetched by the handler; the resolver
 * returns plans (entity-id lists, supersedes pairs, conflict pairs)
 * that the handler persists in idempotent batches.
 *
 * source: mcp_server/core/claim_resolver.py
 */

// ── Output types ──────────────────────────────────────────────────────────

export interface EntityLinkPlan {
  readonly claim_id: number;
  readonly entity_ids: readonly number[];
}

export interface SupersedesPlan {
  readonly new_claim_id: number;
  readonly superseded_claim_id: number;
  readonly rationale: string;
}

export interface ConflictPlan {
  readonly claim_a_id: number;
  readonly claim_b_id: number;
  readonly overlap_entities: readonly number[];
  readonly reason: string;
}

export interface ResolveStats {
  readonly claims_processed: number;
  readonly entity_links_planned: number;
  readonly supersedes_planned: number;
  readonly conflicts_planned: number;
}

// ── Claim dict shape (from DB) ────────────────────────────────────────────

export interface ClaimDict {
  readonly id?: number | null;
  readonly memory_id?: number | null;
  readonly text?: string | null;
  readonly claim_type?: string | null;
  readonly entity_ids?: readonly number[] | null;
  readonly extracted_at?: string | null;
  readonly supersedes?: number | null;
  [key: string]: unknown;
}

// ── Entity linking ────────────────────────────────────────────────────────

/**
 * For each claim, gather entity ids from memory_entities and inline mentions.
 */
export function planEntityLinks(
  claims: readonly ClaimDict[],
  entitiesByMemory: Readonly<Record<number, readonly number[]>>,
  entityNameToId?: Readonly<Record<string, number>> | null,
): EntityLinkPlan[] {
  const nameMap: Map<string, number> = new Map();
  if (entityNameToId) {
    for (const [k, v] of Object.entries(entityNameToId)) {
      nameMap.set(k.toLowerCase(), v);
    }
  }

  return claims.map((c) => {
    const ids = new Set<number>(entitiesByMemory[c.memory_id ?? -1] ?? []);

    if (nameMap.size > 0) {
      const text = (c.text ?? "").toLowerCase();
      for (const [name, eid] of nameMap) {
        if (name.length < 3) continue;
        const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
        if (re.test(text)) ids.add(eid);
      }
    }

    return {
      claim_id: c.id!,
      entity_ids: [...ids].sort((a, b) => a - b),
    };
  });
}

// ── Supersedes detection ──────────────────────────────────────────────────

const SUPERSEDES_PATTERN =
  /\b(supersed(?:es|ed by)|replaces?|replaced by|deprecated by|in (?:favour|favor) of|switched (?:to|from)|migrated (?:to|from))\b/i;

function claimSupersedesSignal(text: string): boolean {
  return SUPERSEDES_PATTERN.test(text ?? "");
}

const SUPERSEDES_TARGET_TYPES: Readonly<Record<string, ReadonlySet<string>>> = {
  decision: new Set(["decision"]),
  method: new Set(["method", "decision"]),
  convention: new Set(["convention", "decision"]),
};

/**
 * Find supersession edges.
 *
 * A claim is a supersedes-candidate when its text matches the
 * supersedes pattern. We look for prior claims that share at least one
 * entity_id, have an earlier extracted_at, and have a compatible
 * claim_type. Picks the most-recently-superseded matching prior claim.
 */
export function planSupersedes(
  claims: readonly ClaimDict[],
  priorClaimsByEntity: Readonly<Record<number, readonly ClaimDict[]>>,
): SupersedesPlan[] {
  const plans: SupersedesPlan[] = [];

  for (const c of claims) {
    if (!claimSupersedesSignal(c.text ?? "")) continue;
    if (c.supersedes) continue;

    const targetTypes = SUPERSEDES_TARGET_TYPES[c.claim_type ?? ""];
    if (!targetTypes) continue;

    const cEntities = new Set<number>(c.entity_ids ?? []);
    if (!cEntities.size) continue;

    const cExtracted = c.extracted_at ?? null;
    const candidates: ClaimDict[] = [];

    for (const eid of cEntities) {
      for (const prior of priorClaimsByEntity[eid] ?? []) {
        if (prior.id === c.id) continue;
        if (!targetTypes.has(prior.claim_type ?? "")) continue;
        if (cExtracted && prior.extracted_at) {
          if (prior.extracted_at >= cExtracted) continue;
        }
        candidates.push(prior);
      }
    }

    if (!candidates.length) continue;

    const best = candidates.reduce((a, b) =>
      (a.extracted_at ?? "") > (b.extracted_at ?? "") ? a : b,
    );

    plans.push({
      new_claim_id: c.id!,
      superseded_claim_id: best.id!,
      rationale:
        `Supersedes pattern in claim ${c.id!} ` +
        `(type=${c.claim_type ?? "unknown"}); prior claim ` +
        `${best.id!} shares entities and predates.`,
    });
  }

  return plans;
}

// ── Conflict detection ────────────────────────────────────────────────────

const CONFLICT_PAIRS: Readonly<Record<string, string>> = {
  "decision:limitation": "decision contradicted by reported limitation",
  "decision:decision": "two decisions about the same entities",
  "method:limitation": "method paired with reported limitation",
  "convention:limitation": "convention contradicted by limitation",
};

function conflictReason(typeA: string, typeB: string): string | null {
  const key1 = `${typeA}:${typeB}`;
  const key2 = `${typeB}:${typeA}`;
  return CONFLICT_PAIRS[key1] ?? CONFLICT_PAIRS[key2] ?? null;
}

/**
 * Surface candidate conflicting claim pairs.
 *
 * Pair (A, B) is a conflict candidate when:
 *   - claim_types match CONFLICT_PAIRS
 *   - they share ≥ minEntityOverlap entities
 *   - they are not already in a supersedes relationship
 */
export function planConflicts(
  claims: readonly ClaimDict[],
  priorClaimsByEntity: Readonly<Record<number, readonly ClaimDict[]>>,
  minEntityOverlap: number = 1,
): ConflictPlan[] {
  const plans: ConflictPlan[] = [];
  const seenPairs = new Set<string>();

  for (const c of claims) {
    const cId = c.id;
    const cType = c.claim_type;
    const cEntities = new Set<number>(c.entity_ids ?? []);
    if (!cId || !cType || !cEntities.size) continue;
    if (c.supersedes) continue;

    for (const eid of cEntities) {
      for (const prior of priorClaimsByEntity[eid] ?? []) {
        const pId = prior.id;
        if (!pId || pId === cId) continue;

        const pairKey = `${Math.min(cId, pId)}:${Math.max(cId, pId)}`;
        if (seenPairs.has(pairKey)) continue;
        if (prior.supersedes === cId || c.supersedes === pId) continue;

        const reason = conflictReason(cType, prior.claim_type ?? "");
        if (!reason) continue;

        const pEntities = new Set<number>(prior.entity_ids ?? []);
        const overlap = [...cEntities].filter((e) => pEntities.has(e)).sort((a, b) => a - b);
        if (overlap.length < minEntityOverlap) continue;

        const aId = Math.min(cId, pId);
        const bId = Math.max(cId, pId);
        plans.push({ claim_a_id: aId, claim_b_id: bId, overlap_entities: overlap, reason });
        seenPairs.add(pairKey);
      }
    }
  }

  return plans;
}

// ── Public resolver entry point ───────────────────────────────────────────

export interface ResolveArgs {
  readonly entitiesByMemory: Readonly<Record<number, readonly number[]>>;
  readonly priorClaimsByEntity: Readonly<Record<number, readonly ClaimDict[]>>;
  readonly entityNameToId?: Readonly<Record<string, number>> | null;
}

/**
 * Compute all three resolution plans for a batch of claims.
 *
 * Order matters: entity links first (so supersedes/conflicts can use the
 * freshly-attached ids), then supersedes (so conflict detection can
 * suppress superseded pairs).
 */
export function resolve(
  claims: readonly ClaimDict[],
  args: ResolveArgs,
): [EntityLinkPlan[], SupersedesPlan[], ConflictPlan[], ResolveStats] {
  const linkPlans = planEntityLinks(claims, args.entitiesByMemory, args.entityNameToId);

  // Inject planned entity ids back into claim dicts
  const planByClaim = new Map<number, readonly number[]>(
    linkPlans.map((p) => [p.claim_id, p.entity_ids]),
  );
  const enriched: ClaimDict[] = claims.map((c) => ({
    ...c,
    entity_ids: planByClaim.get(c.id ?? -1) ?? c.entity_ids ?? [],
  }));

  const supPlans = planSupersedes(enriched, args.priorClaimsByEntity);

  const supersededIds = new Set(supPlans.map((p) => p.superseded_claim_id));
  const supersederIds = new Set(supPlans.map((p) => p.new_claim_id));
  const conflictInput = enriched.filter(
    (c) => !supersededIds.has(c.id!) && !supersederIds.has(c.id!),
  );

  const confPlans = planConflicts(conflictInput, args.priorClaimsByEntity);

  const stats: ResolveStats = {
    claims_processed: claims.length,
    entity_links_planned: linkPlans.filter((p) => p.entity_ids.length > 0).length,
    supersedes_planned: supPlans.length,
    conflicts_planned: confPlans.length,
  };

  return [linkPlans, supPlans, confPlans, stats];
}
