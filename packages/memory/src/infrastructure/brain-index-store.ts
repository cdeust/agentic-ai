/**
 * Persistence layer for the brain index (cross-reference graph).
 *
 * - loadBrainIndex always returns a valid structure (never null)
 *
 * Layer: INFRASTRUCTURE — file I/O only, no core imports.
 * source: Cortex mcp_server/infrastructure/brain_index_store.py
 */

import { BRAIN_INDEX_PATH } from "./config.js";
import { readJson } from "./file-io.js";

/** Shape of the brain index document. */
export interface BrainIndex {
  version: number;
  updatedAt: string | null;
  memories: Record<string, unknown>;
  conversations: Record<string, unknown>;
  threads: Record<string, unknown>;
}

/**
 * Load the brain index from disk.
 *
 * precondition:  none (BRAIN_INDEX_PATH may not exist).
 * postcondition: returns a valid BrainIndex with empty collections if the
 *   file is missing or invalid; returns the parsed index otherwise.
 *
 * source: Cortex mcp_server/infrastructure/brain_index_store.py:load_brain_index
 */
export function loadBrainIndex(): BrainIndex {
  const raw = readJson(BRAIN_INDEX_PATH);
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as BrainIndex;
  }
  return {
    version: 1,
    updatedAt: null,
    memories: {},
    conversations: {},
    threads: {},
  };
}
