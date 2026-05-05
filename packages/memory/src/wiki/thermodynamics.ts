/**
 * Phase 4 — Wiki page thermodynamics.
 *
 * Pages live in an ecology, not a library: they earn existence through
 * citation and access, lose it through idleness, staleness, and
 * redundancy. This module is the pure-logic layer that decides:
 *
 *   - how much heat a page decays per tick
 *   - when a page transitions between lifecycle_states
 *   - when a page gets archived
 *
 * Same physics as pg_store memory decay, with lifecycle-aware half-lives:
 *
 *   active     half-life 30d   — current cognitive territory
 *   area       half-life 90d   — ongoing reference, touched occasionally
 *   archived   no decay        — already at floor
 *   evergreen  no decay        — protected (cross-domain knowledge)
 *
 * Pure logic — no I/O. The handler reads pages, calls these helpers,
 * writes back the new (heat, lifecycle_state, is_stale, archived_at).
 *
 * source: mcp_server/core/wiki_thermodynamics.py (Cortex ed33435)
 */

// ── Tunable thresholds ────────────────────────────────────────────────────
// source: mcp_server/core/wiki_thermodynamics.py:31-44

export const HALF_LIFE_DAYS: Readonly<Record<string, number>> = {
  active: 30.0,
  area: 90.0,
  archived: Infinity, // no further decay
  evergreen: Infinity, // never decays
} as const;

// Lifecycle transition thresholds
// source: mcp_server/core/wiki_thermodynamics.py:38-44
export const ACTIVE_TO_AREA_HEAT = 0.3;
export const ACTIVE_TO_AREA_IDLE_DAYS = 14;
export const AREA_TO_ARCHIVED_HEAT = 0.1;
export const AREA_TO_ARCHIVED_IDLE_DAYS = 90;
export const ARCHIVED_REVIVAL_HEAT = 0.4;
export const HEAT_FLOOR = 0.0;

// ── Types ─────────────────────────────────────────────────────────────────

export interface HeatDecision {
  readonly page_id: number;
  readonly new_heat: number;
  readonly new_lifecycle: string;
  readonly transitioned: boolean;
  readonly archived_at: Date | null;
  readonly rationale: string;
}

export interface ThermoStats {
  readonly pages_evaluated: number;
  readonly pages_decayed: number;
  readonly transitions: Readonly<Record<string, number>>;
  readonly heat_floor_count: number;
  readonly avg_heat_before: number;
  readonly avg_heat_after: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function safeDt(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}

// ── Core functions ────────────────────────────────────────────────────────

/**
 * Apply exponential decay since lastTended.
 *
 * Precondition: currentHeat in [0,1]; lifecycleState in HALF_LIFE_DAYS keys.
 * Postcondition: returns new heat in [HEAT_FLOOR, currentHeat].
 *   Formula: heat = current_heat * exp(-ln(2) * elapsed_days / half_life_days)
 *
 * source: mcp_server/core/wiki_thermodynamics.py:68-87
 */
export function decayHeat(opts: {
  readonly current_heat: number;
  readonly last_tended: unknown;
  readonly lifecycle_state: string;
  readonly now?: Date | null;
}): number {
  const { current_heat, last_tended, lifecycle_state, now } = opts;
  const halfLife = HALF_LIFE_DAYS[lifecycle_state] ?? 30.0;
  if (!isFinite(halfLife)) return current_heat;

  const nowDt = now ?? new Date();
  const tendedDt = safeDt(last_tended);
  const elapsedDays = (nowDt.getTime() - tendedDt.getTime()) / 86_400_000;
  if (elapsedDays <= 0) return current_heat;

  const decayed = current_heat * Math.exp(-Math.LN2 * elapsedDays / halfLife);
  return Math.max(HEAT_FLOOR, decayed);
}

/**
 * Decide whether to move to a new lifecycle state.
 *
 * Precondition: currentState is a valid lifecycle state string.
 * Postcondition: returns [newState, transitioned, rationale].
 *   Valid transitions: active→area, area→archived, archived→active.
 *   evergreen never transitions.
 *
 * source: mcp_server/core/wiki_thermodynamics.py:90-145
 */
export function transitionLifecycle(opts: {
  readonly current_state: string;
  readonly heat_after_decay: number;
  readonly last_tended: unknown;
  readonly now?: Date | null;
}): [string, boolean, string] {
  const { current_state, heat_after_decay, last_tended, now } = opts;

  if (current_state === "evergreen") {
    return ["evergreen", false, "evergreen — never auto-transitions"];
  }

  const nowDt = now ?? new Date();
  const elapsedDays = (nowDt.getTime() - safeDt(last_tended).getTime()) / 86_400_000;

  if (current_state === "active") {
    if (
      heat_after_decay < ACTIVE_TO_AREA_HEAT &&
      elapsedDays > ACTIVE_TO_AREA_IDLE_DAYS
    ) {
      return [
        "area",
        true,
        `heat=${heat_after_decay.toFixed(2)} < ${ACTIVE_TO_AREA_HEAT} ` +
          `and idle ${elapsedDays.toFixed(0)}d > ${ACTIVE_TO_AREA_IDLE_DAYS}d`,
      ];
    }
    return ["active", false, "active — within thresholds"];
  }

  if (current_state === "area") {
    if (
      heat_after_decay < AREA_TO_ARCHIVED_HEAT &&
      elapsedDays > AREA_TO_ARCHIVED_IDLE_DAYS
    ) {
      return [
        "archived",
        true,
        `heat=${heat_after_decay.toFixed(2)} < ${AREA_TO_ARCHIVED_HEAT} ` +
          `and idle ${elapsedDays.toFixed(0)}d > ${AREA_TO_ARCHIVED_IDLE_DAYS}d`,
      ];
    }
    return ["area", false, "area — within thresholds"];
  }

  if (current_state === "archived") {
    if (heat_after_decay >= ARCHIVED_REVIVAL_HEAT) {
      return [
        "active",
        true,
        `heat=${heat_after_decay.toFixed(2)} >= ${ARCHIVED_REVIVAL_HEAT} ` +
          `— revived from archive`,
      ];
    }
    return ["archived", false, "archived — heat below revival threshold"];
  }

  return [current_state, false, `unknown state: ${current_state}`];
}

/**
 * Run decay + transition for one page row.
 *
 * Precondition: page has at least { id, heat, lifecycle_state, tended }.
 * Postcondition: returns HeatDecision with the planned new state.
 *
 * source: mcp_server/core/wiki_thermodynamics.py:148-184
 */
export function evaluatePage(
  page: Record<string, unknown>,
  opts?: { now?: Date | null },
): HeatDecision {
  const now = opts?.now ?? new Date();
  const pid = Number(page["id"]);
  const currentHeat = typeof page["heat"] === "number" ? page["heat"] : 0.0;
  const currentState = typeof page["lifecycle_state"] === "string"
    ? page["lifecycle_state"]
    : "active";
  const lastTended = page["tended"] ?? now;

  const newHeat = decayHeat({
    current_heat: currentHeat,
    last_tended: lastTended,
    lifecycle_state: currentState,
    now,
  });

  const [newState, transitioned, rationale] = transitionLifecycle({
    current_state: currentState,
    heat_after_decay: newHeat,
    last_tended: lastTended,
    now,
  });

  const archivedAt = transitioned && newState === "archived" ? now : null;

  return {
    page_id: pid,
    new_heat: newHeat,
    new_lifecycle: newState,
    transitioned,
    archived_at: archivedAt,
    rationale,
  };
}

/**
 * Aggregate stats over a batch of HeatDecisions.
 *
 * Precondition: decisions is an array of HeatDecision; originalHeats maps page_id to prior heat.
 * Postcondition: returns ThermoStats with aggregate metrics.
 *
 * source: mcp_server/core/wiki_thermodynamics.py:200-233
 */
export function summarise(
  decisions: readonly HeatDecision[],
  originalHeats: Readonly<Record<number, number>>,
): ThermoStats {
  if (!decisions.length) {
    return {
      pages_evaluated: 0,
      pages_decayed: 0,
      transitions: {},
      heat_floor_count: 0,
      avg_heat_before: 0.0,
      avg_heat_after: 0.0,
    };
  }

  const transitions: Record<string, number> = {};
  let decayed = 0;
  let floor = 0;
  let sumBefore = 0.0;
  let sumAfter = 0.0;

  // invariant: all counts non-negative; termination: finite decisions array
  for (const d of decisions) {
    const before = originalHeats[d.page_id] ?? 0.0;
    sumBefore += before;
    sumAfter += d.new_heat;
    if (d.new_heat < before - 1e-6) decayed++;
    if (d.new_heat <= HEAT_FLOOR + 1e-6) floor++;
    if (d.transitioned) {
      const label = `->${d.new_lifecycle}`;
      transitions[label] = (transitions[label] ?? 0) + 1;
    }
  }

  return {
    pages_evaluated: decisions.length,
    pages_decayed: decayed,
    transitions,
    heat_floor_count: floor,
    avg_heat_before: sumBefore / decisions.length,
    avg_heat_after: sumAfter / decisions.length,
  };
}
