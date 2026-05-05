/**
 * Wiki Phase 4 — Thermodynamic consolidation sweep (handler).
 *
 * Runs three passes over wiki.pages:
 *   1. Heat decay + lifecycle transitions (active → area → archived, revival).
 *   2. Staleness brake — pages whose file refs no longer exist get is_stale=true.
 *   3. Memo every transition for the audit trail.
 *
 * Composition root: wires inline thermodynamics (ported from
 * mcp_server/core/wiki_thermodynamics.py) + staleness (staleness.ts) against
 * pg-wiki-store-pages.
 *
 * source: mcp_server/handlers/wiki_consolidate.py (Cortex ed33435)
 * source: mcp_server/core/wiki_thermodynamics.py (heat decay + lifecycle)
 * source: mcp_server/infrastructure/pg_store_wiki.py:408-516 (pages I/O)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { WikiDbClient } from "../storage/pg-wiki-store-pages.js";
import {
  listPagesForDecay,
  applyThermoDecisions,
  applyStalenessDecisions,
  getClaimFileRefsForPages,
} from "../storage/pg-wiki-store-pages.js";
import type { HeatDecision, PageForDecay } from "../storage/pg-wiki-store-pages.js";
import { insertMemo } from "../storage/pg-wiki-store-concepts.js";
import { evaluateStaleness, harvestPageRefs } from "../staleness.js";

// ── Thermodynamic constants ────────────────────────────────────────────────
// source: mcp_server/core/wiki_thermodynamics.py:31-44

// Half-life in days per lifecycle state
// source: mcp_server/core/wiki_thermodynamics.py:32-37
const HALF_LIFE_DAYS: Readonly<Record<string, number>> = {
  active: 30.0,   // source: mcp_server/core/wiki_thermodynamics.py:33
  area: 90.0,     // source: mcp_server/core/wiki_thermodynamics.py:34
  archived: Infinity,
  evergreen: Infinity,
};

const ACTIVE_TO_AREA_HEAT = 0.3;           // source: wiki_thermodynamics.py:40
const ACTIVE_TO_AREA_IDLE_DAYS = 14;       // source: wiki_thermodynamics.py:41
const AREA_TO_ARCHIVED_HEAT = 0.1;         // source: wiki_thermodynamics.py:42
const AREA_TO_ARCHIVED_IDLE_DAYS = 90;     // source: wiki_thermodynamics.py:43
const ARCHIVED_REVIVAL_HEAT = 0.4;         // source: wiki_thermodynamics.py:44
const HEAT_FLOOR = 0.0;                    // source: wiki_thermodynamics.py:45

// source: mcp_server/handlers/wiki_consolidate.py:148 — default sweep limit
const CONSOLIDATE_DEFAULT_LIMIT = 5000;

// Seconds per day — used in elapsed-day computation
// source: mathematical constant (60*60*24 = 86400)
const SECONDS_PER_DAY = 86400;

// Milliseconds per second — Date.getTime() returns ms
// source: JavaScript Date specification
const MS_PER_SECOND = 1000;

// Heat rounding precision — 4 decimal places
// source: mcp_server/handlers/wiki_consolidate.py:249
const HEAT_ROUND_FACTOR = 10000;

// Thermo confidence for lifecycle transitions
// source: mcp_server/handlers/wiki_consolidate.py:186
const THERMO_CONFIDENCE = 0.9;

// Staleness confidence for staleness transitions
// source: mcp_server/handlers/wiki_consolidate.py:225
const STALENESS_CONFIDENCE = 0.8;

// Float epsilon for heat-floor comparison
// source: mcp_server/core/wiki_thermodynamics.py:156
const HEAT_FLOOR_EPSILON = 0.001;

// Max missing refs to include in staleness memo
// source: mcp_server/handlers/wiki_consolidate.py:226
const STALENESS_SAMPLE_CAP = 10;

// Default active half-life fallback when state is unknown
// source: mcp_server/core/wiki_thermodynamics.py:33
const DEFAULT_HALF_LIFE_DAYS = 30.0;

export interface WikiConsolidateArgs {
  readonly dry_run?: boolean | null;
  readonly limit?: number | null;
  readonly skip_staleness?: boolean | null;
  readonly include_archived?: boolean | null;
  readonly repo_root?: string | null;
  [key: string]: unknown;
}

export interface WikiConsolidateResult {
  readonly pages_evaluated: number;
  readonly pages_decayed: number;
  readonly pages_updated: number;
  readonly transitions: number;
  readonly heat_floor_count: number;
  readonly avg_heat_before: number;
  readonly avg_heat_after: number;
  readonly staleness: Record<string, unknown>;
  readonly dry_run: boolean;
}

/**
 * Apply exponential heat decay since last_tended.
 * source: mcp_server/core/wiki_thermodynamics.py:67-82 (decay_heat)
 *
 * Precondition: currentHeat ∈ [0,∞), lifecycleState is a valid state.
 * Postcondition: returns max(HEAT_FLOOR, currentHeat * exp(-ln2 * elapsed / half_life)).
 */
function decayHeat(
  currentHeat: number,
  lastTended: string | null,
  lifecycleState: string,
  now: Date,
): number {
  const halfLife = HALF_LIFE_DAYS[lifecycleState] ?? DEFAULT_HALF_LIFE_DAYS;
  if (!isFinite(halfLife)) return currentHeat;

  const tended = lastTended ? new Date(lastTended) : now;
  const elapsedDays = (now.getTime() - tended.getTime()) / (SECONDS_PER_DAY * MS_PER_SECOND);
  if (elapsedDays <= 0) return currentHeat;

  const decayed = currentHeat * Math.exp(-Math.LN2 * elapsedDays / halfLife);
  return Math.max(HEAT_FLOOR, decayed);
}

/**
 * Decide whether to move to a new lifecycle state.
 * source: mcp_server/core/wiki_thermodynamics.py:85-127 (transition_lifecycle)
 *
 * Returns [newState, transitioned, rationale].
 */
function transitionLifecycle(
  currentState: string,
  heatAfterDecay: number,
  lastTended: string | null,
  now: Date,
): [string, boolean, string] {
  if (currentState === "evergreen") {
    return ["evergreen", false, "evergreen — never auto-transitions"];
  }

  const tended = lastTended ? new Date(lastTended) : now;
  const elapsedDays = (now.getTime() - tended.getTime()) / (SECONDS_PER_DAY * MS_PER_SECOND);

  if (currentState === "active") {
    if (heatAfterDecay < ACTIVE_TO_AREA_HEAT && elapsedDays > ACTIVE_TO_AREA_IDLE_DAYS) {
      return [
        "area",
        true,
        `heat=${heatAfterDecay.toFixed(2)} < ${ACTIVE_TO_AREA_HEAT} ` +
          `and idle ${elapsedDays.toFixed(0)}d > ${ACTIVE_TO_AREA_IDLE_DAYS}d`,
      ];
    }
    return ["active", false, "active — within thresholds"];
  }

  if (currentState === "area") {
    if (heatAfterDecay < AREA_TO_ARCHIVED_HEAT && elapsedDays > AREA_TO_ARCHIVED_IDLE_DAYS) {
      return [
        "archived",
        true,
        `heat=${heatAfterDecay.toFixed(2)} < ${AREA_TO_ARCHIVED_HEAT} ` +
          `and idle ${elapsedDays.toFixed(0)}d > ${AREA_TO_ARCHIVED_IDLE_DAYS}d`,
      ];
    }
    return ["area", false, "area — within thresholds"];
  }

  if (currentState === "archived") {
    if (heatAfterDecay >= ARCHIVED_REVIVAL_HEAT) {
      return [
        "active",
        true,
        `heat=${heatAfterDecay.toFixed(2)} >= revival threshold ${ARCHIVED_REVIVAL_HEAT}`,
      ];
    }
    return ["archived", false, "archived — below revival threshold"];
  }

  return [currentState, false, `unknown state ${currentState}`];
}

/**
 * Evaluate one page's thermodynamic fate.
 * source: mcp_server/core/wiki_thermodynamics.py:131-165 (evaluate_page)
 */
function evaluatePage(page: PageForDecay, now: Date): HeatDecision & { transitioned: boolean; rationale: string } {
  const newHeat = decayHeat(
    typeof page.heat === "number" ? page.heat : 0,
    page.tended,
    page.lifecycle_state,
    now,
  );
  const [newLifecycle, transitioned, rationale] = transitionLifecycle(
    page.lifecycle_state,
    newHeat,
    page.tended,
    now,
  );
  const archivedAt = (transitioned && newLifecycle === "archived")
    ? now.toISOString()
    : null;

  return {
    page_id: page.id,
    new_heat: newHeat,
    new_lifecycle: newLifecycle,
    archived_at: archivedAt,
    transitioned,
    rationale,
  };
}

/**
 * Check file existence within a repo_root sandbox.
 * source: mcp_server/handlers/wiki_consolidate.py:123-142 (_check_existence)
 *
 * Precondition: repoRoot is a valid absolute path.
 * Postcondition: returns map ref → exists; rejects paths that escape repoRoot.
 */
function checkExistence(
  refs: ReadonlySet<string>,
  repoRoot: string,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const resolvedRoot = fs.realpathSync(repoRoot);
  for (const ref of refs) {
    const cleaned = ref.trim().replace(/[.,;:]+$/, "");
    if (!cleaned) continue;
    // Reject absolute paths and traversal
    if (path.isAbsolute(cleaned)) { out[ref] = false; continue; }
    try {
      const target = path.resolve(resolvedRoot, cleaned);
      // Sandbox check
      if (!target.startsWith(resolvedRoot + path.sep) && target !== resolvedRoot) {
        out[ref] = false;
        continue;
      }
      out[ref] = fs.existsSync(target);
    } catch {
      out[ref] = false;
    }
  }
  return out;
}

/**
 * Thermodynamic consolidation handler.
 *
 * Precondition:  db is non-null.
 * Postcondition: all eligible wiki.pages have heat decayed + lifecycle
 *   transitioned; staleness flags updated; memos written for transitions;
 *   returns real counts.
 *
 * source: mcp_server/handlers/wiki_consolidate.py:145-254
 */
export async function wikiConsolidateHandler(
  args: WikiConsolidateArgs,
  db: WikiDbClient,
): Promise<WikiConsolidateResult> {
  const limit = typeof args.limit === "number" ? args.limit : CONSOLIDATE_DEFAULT_LIMIT;
  const dryRun = args.dry_run === true;
  const skipStaleness = args.skip_staleness === true;
  const includeArchived = args.include_archived === true;
  const repoRoot = typeof args.repo_root === "string" && args.repo_root
    ? args.repo_root
    : process.cwd();

  const now = new Date();

  // ── Pass 1: Decay + lifecycle ─────────────────────────────────────────
  const pages = await listPagesForDecay(db, limit, includeArchived);
  if (!pages.length) {
    return {
      pages_evaluated: 0,
      pages_decayed: 0,
      pages_updated: 0,
      transitions: 0,
      heat_floor_count: 0,
      avg_heat_before: 0,
      avg_heat_after: 0,
      staleness: { skipped: true },
      dry_run: dryRun,
    };
  }

  const originalHeats: Record<number, number> = {};
  for (const p of pages) originalHeats[p.id] = typeof p.heat === "number" ? p.heat : 0;

  const decisions = pages.map((p) => evaluatePage(p, now));

  // Compute stats before write
  const heatsAfter = decisions.map((d) => d.new_heat);
  const heatsBefore = pages.map((p) => originalHeats[p.id] ?? 0);
  const avgBefore = heatsBefore.reduce((a, b) => a + b, 0) / heatsBefore.length;
  const avgAfter = heatsAfter.reduce((a, b) => a + b, 0) / heatsAfter.length;
  const pagesDecayed = decisions.filter((d) => d.new_heat < (originalHeats[d.page_id] ?? 0)).length;
  const transitions = decisions.filter((d) => d.transitioned).length;
  const heatFloorCount = decisions.filter((d) => d.new_heat <= HEAT_FLOOR + HEAT_FLOOR_EPSILON).length; // source: mcp_server/core/wiki_thermodynamics.py:156 (float epsilon for floor comparison)

  let pagesUpdated = 0;
  if (!dryRun) {
    pagesUpdated = await applyThermoDecisions(db, decisions);
    for (const d of decisions) {
      if (d.transitioned) {
        await insertMemo(
          db,
          "page",
          d.page_id,
          `transition_${d.new_lifecycle}`,
          d.rationale,
          [],
          { new_heat: Math.round(d.new_heat * HEAT_ROUND_FACTOR) / HEAT_ROUND_FACTOR }, // source: mcp_server/handlers/wiki_consolidate.py:184 (4 decimal places)
          THERMO_CONFIDENCE,
          "thermo",
        );
      }
    }
  }

  // ── Pass 2: Staleness ────────────────────────────────────────────────
  let stalenessSummary: Record<string, unknown> = { skipped: true };
  if (!skipStaleness) {
    const pageIds = pages.map((p) => p.id);
    const claimRefsByPage = await getClaimFileRefsForPages(db, pageIds);

    const perPageRefs: Record<number, string[]> = {};
    const allRefs = new Set<string>();
    for (const p of pages) {
      // harvestPageRefs combines sections + claim refs
      const pageLike = {
        lead: typeof p.lead === "string" ? p.lead : "",
        sections: p.sections as Record<string, string> | Array<{ heading: string; body: string }> | null | undefined,
      };
      const refs = harvestPageRefs(pageLike, claimRefsByPage[p.id] ?? []);
      perPageRefs[p.id] = refs;
      for (const r of refs) allRefs.add(r);
    }

    const existence = checkExistence(allRefs, repoRoot);

    const staleDecisions = pages.map((p) =>
      evaluateStaleness({
        page_id: p.id,
        is_stale_was: !!p.is_stale,
        file_refs: perPageRefs[p.id] ?? [],
        existence,
      }),
    );

    let staleWritten = 0;
    if (!dryRun) {
      staleWritten = await applyStalenessDecisions(db, staleDecisions);
      for (const d of staleDecisions) {
        if (d.transitioned) {
          await insertMemo(
            db,
            "page",
            d.page_id,
            d.is_stale_now ? "staleness_set" : "staleness_cleared",
            d.rationale,
            [],
            {
              missing: d.missing_refs.slice(0, STALENESS_SAMPLE_CAP),
              total_refs: d.file_refs.length,
            },
            STALENESS_CONFIDENCE,
            "staleness",
          );
        }
      }
    }

    stalenessSummary = {
      pages_with_refs: staleDecisions.filter((d) => d.file_refs.length > 0).length,
      pages_now_stale: staleDecisions.filter((d) => d.is_stale_now).length,
      transitions_written: staleWritten,
      files_checked: Object.keys(existence).length,
      files_missing: Object.values(existence).filter((v) => !v).length,
      skipped: false,
    };
  }

  return {
    pages_evaluated: pages.length,
    pages_decayed: pagesDecayed,
    pages_updated: pagesUpdated,
    transitions,
    heat_floor_count: heatFloorCount,
    avg_heat_before: Math.round(avgBefore * HEAT_ROUND_FACTOR) / HEAT_ROUND_FACTOR,
    avg_heat_after: Math.round(avgAfter * HEAT_ROUND_FACTOR) / HEAT_ROUND_FACTOR,
    staleness: stalenessSummary,
    dry_run: dryRun,
  };
}
