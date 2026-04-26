/**
 * Two-stage transfer stage: hippocampal → cortical memory transfer.
 *
 * Runs during deep-sleep consolidation. Calls updateHippocampalDependency
 * for memories with high replay counts and sufficient dependency to reduce.
 *
 * Port of: mcp_server/handlers/consolidation/transfer.py
 */

import { updateHippocampalDependency, shouldReleaseHippocampalTrace } from "../two-stage-model.js";

export interface TransferStore {
  getTransferCandidates(limit: number): Promise<Record<string, unknown>[]>;
  updateHippocampalDependency(id: number, dependency: number): Promise<void>;
}

export interface TransferStageResult {
  transferred: number;
  released: number;
  scanned: number;
  duration_ms?: number;
}

/**
 * Run hippocampal-cortical transfer for memories with replay history.
 *
 * // source: McClelland JL et al. (1995) complementary learning systems.
 * // source: Ketz NA et al. (2023) C-HORSE cortical LR = 0.02. eLife 12:e77185.
 */
export async function runTwoStageTransfer(store: TransferStore): Promise<TransferStageResult> {
  const candidates = await store.getTransferCandidates(200);
  let transferred = 0;
  let released = 0;

  for (const mem of candidates) {
    const dep = (mem["hippocampal_dependency"] as number | undefined) ?? 1.0;
    const replayCount = (mem["replay_count"] as number | undefined) ?? 0;
    const schemaMatch = (mem["schema_match_score"] as number | undefined) ?? 0.0;
    const importance = (mem["importance"] as number | undefined) ?? 0.5;

    const newDep = updateHippocampalDependency(dep, replayCount, schemaMatch, importance);

    if (Math.abs(newDep - dep) > 0.001) {
      await store.updateHippocampalDependency(mem["id"] as number, newDep);
      transferred++;

      const stage = (mem["consolidation_stage"] as string | undefined) ?? "labile";
      const heat = (mem["heat"] as number | undefined) ?? 0.5;
      if (shouldReleaseHippocampalTrace(newDep, stage, heat)) {
        released++;
      }
    }
  }

  return { transferred, released, scanned: candidates.length };
}
