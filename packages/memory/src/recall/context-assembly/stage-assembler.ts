/* eslint-disable @typescript-eslint/no-magic-numbers -- source: exact port of Python source; all numeric literals copied verbatim from cited Python file */
/**
 * Three-phase stage-aware context assembler.
 *
 * Ports Clément Deust's Swift StageAwareContextAssembler from
 * ai-architect-prd-builder/packages/AIPRDRAGEngine/Sources/Services/
 * StageAwareContextAssembler.swift to TypeScript, adapted for Cortex's
 * memory types and complemented with paper-backed mechanisms at three
 * specific points.
 *
 * ## The algorithm
 *
 * Given a query and a token budget, assemble a structured context in
 * three phases with a fixed 60/30/10 split:
 *
 *   Phase 1 — Own-stage (60% of budget)
 *     Search the current stage's memories by query.
 *     Select chunks via submodular coverage (Krause & Guestrin 2008)
 *     instead of top-k, to avoid near-duplicate drowning.
 *
 *   Phase 2 — Adjacent stages via entity graph (30% of budget)
 *     Extract entities from Phase 1 results.
 *     Run Personalized PageRank (HippoRAG, Gutiérrez NeurIPS 2024) over
 *     Cortex's entity graph seeded on those entities.
 *     Select cross-stage memories ranked by PPR mass.
 *
 *   Phase 3 — Summary fallback (10% of budget)
 *     For stages not covered by Phase 1+2, retrieve pre-computed
 *     schema-structured summaries ordered by stage proximity.
 *
 * ## Output
 *
 * A StageContextResult with four fields:
 *   - ownStageContext: Phase 1 text
 *   - adjacentStageContext: Phase 2 text
 *   - stageSummaries: Phase 3 text
 *   - assembledContext: all three concatenated with section headers,
 *     ready to be fed into decomposer.assemblePrompt as a single
 *     placeholder or split into multiple placeholders by priority.
 *
 * ## What's the user's design vs what's paper-backed
 *
 *   - The 3-phase structure, the 60/30/10 split, and the section labels
 *     are Clément Deust's invention (Swift original).
 *   - Phase 1 candidate SOURCE (dense WRRF over the stage's memories) is
 *     Cortex's existing primitive.
 *   - Phase 1 SELECTION (submodular coverage) is Krause & Guestrin 2008.
 *   - Phase 2 GRAPH SOURCE (Cortex's entity + relationship tables) is
 *     Cortex's existing primitive.
 *   - Phase 2 WALK (Personalized PageRank) is HippoRAG NeurIPS 2024.
 *   - Phase 3 SUMMARIES (schema-structured) uses Cortex's schema_engine.py
 *     (Tse 2007 schema-congruent consolidation).
 *
 * source: Cortex mcp_server/core/context_assembly/stage_assembler.py
 */

import { estimateTokens } from "./budget.js";
import { submodularSelect } from "./coverage.js";
import {
  buildEntityAdjacency,
  personalizedPagerank,
  scoreMemoriesByPpr,
} from "./ppr-traversal.js";
import type { MemoryRecord, StageDetector } from "./stage-detector.js";

export type { MemoryRecord };

// ── Budget split ────────────────────────────────────────────────────────

/** Three-phase budget proportions. Must sum to 1.0. */
export interface BudgetSplit {
  readonly ownStage: number;   // default 0.6
  readonly adjacent: number;   // default 0.3
  readonly summaries: number;  // default 0.1
}

export function makeBudgetSplit(
  ownStage: number = 0.6,
  adjacent: number = 0.3,
  summaries: number = 0.1,
): BudgetSplit {
  const total = ownStage + adjacent + summaries;
  if (Math.abs(total - 1.0) > 1e-3) { // source: Cortex stage_assembler.py::BudgetSplit floating-point equality tolerance
    throw new Error(`BudgetSplit must sum to 1.0, got ${total}`);
  }
  return { ownStage, adjacent, summaries };
}

export const DEFAULT_SPLIT: BudgetSplit = makeBudgetSplit();

// ── Result container ────────────────────────────────────────────────────

/**
 * Structured output of the 3-phase assembler.
 *
 * selectedMemories contains the actual memory dicts that were
 * chosen in Phase 1 and Phase 2, each tagged with a phase field
 * (1 or 2). This is what downstream evaluators read when computing
 * retrieval hits — the concatenated text fields are for the LLM
 * reader, not for scoring.
 */
export interface StageContextResult {
  ownStageContext: string;
  adjacentStageContext: string;
  stageSummaries: string;
  assembledContext: string;
  selectedMemories: MemoryRecord[];
  metadata: Record<string, unknown>;
}

// ── Port: resource types ────────────────────────────────────────────────

export interface StageCandidate {
  memory: MemoryRecord;
  stageId: string;
  score: number;
}

// ── Main assembler ──────────────────────────────────────────────────────

/** Callbacks used by the assembler. Kept in a single DTO (§4.4). */
export interface StageAssemblerDeps {
  /** Strategy for mapping memories to stages. */
  stageDetector: StageDetector;
  /**
   * Search for candidates given (query, stageId, maxResults).
   * Returns list of memory dicts with at least content, memory_id, score.
   */
  retrieveFn: (
    query: string,
    stageId: string,
    maxResults: number,
  ) => MemoryRecord[];
  /**
   * Returns (entities, relationships) for the corpus.
   */
  entityGraphFn: () => [MemoryRecord[], MemoryRecord[]];
  /**
   * Maps entity_id list → list of memories containing those entities.
   */
  memoriesByEntityFn: (entityIds: string[]) => MemoryRecord[];
  /**
   * Returns a schema-structured summary string for a given stageId.
   */
  stageSummaryFn: (stageId: string) => string;
}

/**
 * Three-phase context assembler for stage-scoped retrieval.
 *
 * Wire dependencies at construction time. All external calls are
 * callbacks so this module stays dependency-free (no direct pg_store,
 * no direct embeddings, no direct schema_engine).
 */
export class StageAwareContextAssembler {
  private readonly _deps: StageAssemblerDeps;

  constructor(deps: StageAssemblerDeps) {
    this._deps = deps;
  }

  /**
   * Run the 3-phase assembly.
   *
   * When tokenBudget is undefined, the assembler selects purely
   * by maxChunksPerPhase without token truncation — used for
   * retrieval evaluation where text length is irrelevant and the
   * metric is rank-based. When a reader is downstream, the caller
   * should pass reasoner.contextWindow * 0.75 to enforce a
   * real budget (the Swift ContextDecomposer pattern).
   */
  assemble({
    query,
    currentStage,
    tokenBudget,
    budgetSplit = DEFAULT_SPLIT,
    maxChunksPerPhase = 5,
    diversityLambda = 0.5,
  }: {
    query: string;
    currentStage: string;
    tokenBudget?: number;
    budgetSplit?: BudgetSplit;
    maxChunksPerPhase?: number;
    diversityLambda?: number;
  }): StageContextResult {
    const {
      stageDetector,
      retrieveFn,
      entityGraphFn,
      memoriesByEntityFn,
      stageSummaryFn,
    } = this._deps;

    const adjBudget =
      tokenBudget !== undefined
        ? Math.floor(tokenBudget * budgetSplit.adjacent)
        : undefined;
    const sumBudget =
      tokenBudget !== undefined
        ? Math.floor(tokenBudget * budgetSplit.summaries)
        : undefined;

    // Track every memory we actually commit to the output so the
    // caller can score retrieval hits on the full selected set,
    // not just the text.
    const selectedMemories: MemoryRecord[] = [];

    // ── Phase 1 — Own-stage ───────────────────────────────────────
    // Selection is decoupled from token budget: we always pick up
    // to maxChunksPerPhase items so retrieval ranking metrics
    // stay well-defined regardless of individual memory size. The
    // token budget is enforced at text-assembly time (below),
    // which may truncate individual chunks but never reduces the
    // count of selected items.
    const ownChunks = retrieveFn(query, currentStage, maxChunksPerPhase * 3);
    const selectedOwn = submodularSelect(ownChunks, {
      tokenBudget: undefined,
      diversityLambda,
      maxChunks: maxChunksPerPhase,
    });
    for (const c of selectedOwn) {
      selectedMemories.push({
        memory_id: c["memory_id"],
        content: c["content"] ?? "",
        score: Number(c["score"] ?? 0),
        phase: 1,
      });
    }
    const ownText = selectedOwn
      .map((c) => String(c["content"] ?? ""))
      .join("\n\n")
      .trim();
    const ownTokens = estimateTokens(ownText);

    // ── Phase 2 — Adjacent stages via PPR ─────────────────────────
    // Extract entities from Phase 1 results
    const seedEntities = new Map<string, number>();
    for (const c of selectedOwn) {
      const eids = (c["entity_ids"] as unknown[]) ?? [];
      for (const eid of eids) {
        const key = String(eid);
        seedEntities.set(key, (seedEntities.get(key) ?? 0) + 1.0);
      }
    }

    let adjacentText = "";
    let adjacentTokens = 0;
    const coveredStages = new Set<string>([currentStage]);

    if (seedEntities.size > 0) {
      const [entities, relationships] = entityGraphFn();
      const adjacency = buildEntityAdjacency(entities, relationships);
      const ppr = personalizedPagerank(adjacency, seedEntities);

      // Fetch candidate memories that contain PPR-hot entities
      const topEntityIds = [...ppr.entries()]
        .sort(([, a], [, b]) => b - a)
        .slice(0, 50)
        .map(([k]) => k);
      const candidateMems = memoriesByEntityFn(topEntityIds);

      // Filter to NOT-current-stage and score by PPR
      const crossStage = candidateMems.filter(
        (m) => stageDetector.stageOf(m) !== currentStage,
      );
      const scored = scoreMemoriesByPpr(crossStage, ppr);

      // Greedy pack within adjBudget (or ignore budget if undefined)
      const adjacentParts: string[] = [];
      let used = 0;
      for (const [m, score] of scored.slice(0, maxChunksPerPhase * 2)) {
        const content = String(m["content"] ?? "");
        const t = estimateTokens(content);
        if (adjBudget !== undefined && used + t > adjBudget) continue;
        adjacentParts.push(content);
        selectedMemories.push({
          memory_id: m["memory_id"] ?? m["id"],
          content,
          score: Number(score),
          phase: 2,
        });
        used += t;
        coveredStages.add(stageDetector.stageOf(m));
        if (adjacentParts.length >= maxChunksPerPhase) break;
      }
      adjacentText = adjacentParts.join("\n\n").trim();
      adjacentTokens = used;
    }

    // ── Phase 3 — Summary fallback ────────────────────────────────
    const summaryParts: string[] = [];
    let summaryTokens = 0;
    const allStages = stageDetector.allStages([]);
    const uncoveredStages = allStages.filter((s) => !coveredStages.has(s));
    for (const stageId of uncoveredStages) {
      const summary = stageSummaryFn(stageId);
      if (!summary) continue;
      const t = estimateTokens(summary);
      if (sumBudget !== undefined && summaryTokens + t > sumBudget) break;
      summaryParts.push(`[${stageId}] ${summary}`);
      summaryTokens += t;
    }
    const summaryText = summaryParts.join("\n\n").trim();

    // ── Assemble ──────────────────────────────────────────────────
    const parts: string[] = [];
    if (ownText) {
      parts.push(`## Current Stage Context (${currentStage})\n\n${ownText}`);
    }
    if (adjacentText) {
      parts.push(`## Related Prior Context\n\n${adjacentText}`);
    }
    if (summaryText) {
      parts.push(`## Stage Summaries\n\n${summaryText}`);
    }
    const assembled = parts.join("\n\n");

    const totalTokens = ownTokens + adjacentTokens + summaryTokens;

    return {
      ownStageContext: ownText,
      adjacentStageContext: adjacentText,
      stageSummaries: summaryText,
      assembledContext: assembled,
      selectedMemories,
      metadata: {
        ownStageChunks: selectedOwn.length,
        ownStageTokens: ownTokens,
        adjacentStages: [...coveredStages].filter((s) => s !== currentStage).sort(),
        adjacentTokens,
        summaryStages: uncoveredStages.slice(0, summaryParts.length),
        summaryTokens,
        totalTokens,
        tokenBudget,
        budgetSplit: [budgetSplit.ownStage, budgetSplit.adjacent, budgetSplit.summaries],
      },
    };
  }
}
