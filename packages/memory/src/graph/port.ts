/**
 * GraphPort — the interface boundary for graph navigation operations.
 *
 * Following Clean Architecture §2.3 (ports and adapters): core declares what
 * it needs; infrastructure implements it. Handlers compose them at
 * construction.
 *
 * This port is read-only over the persisted memory store. Writes go through
 * the RememberPort (packages/memory/src/remember/).
 *
 * source: READ_ONLY annotation in navigate_memory.py and explore_features.py.
 */

import type { NavigationResponse } from "./types.js";
import type { NavigationOptions, MemoryRecord } from "./navigation.js";

/**
 * Persistence-layer contract for graph navigation.
 * Implementations fetch memory records; the pure navigation logic lives in
 * navigation.ts and node-traversal.ts.
 */
export interface GraphPort {
  /**
   * Fetch recently-accessed memories for SR graph construction.
   *
   * @param limit          - Maximum records to return.
   * @param minAccessCount - Minimum access count filter.
   */
  getRecentlyAccessedMemories(
    limit: number,
    minAccessCount: number,
  ): Promise<MemoryRecord[]>;

  /**
   * Fetch a single memory by ID. Returns undefined if not found.
   */
  getMemory(memoryId: number): Promise<MemoryRecord | undefined>;

  /**
   * Record that a memory was accessed during navigation (replay tracking).
   * Best-effort — errors are swallowed by the handler.
   */
  updateMemoryAccess(memoryId: number): Promise<void>;

  /**
   * Increment the replay counter for a memory.
   * Best-effort — errors are swallowed by the handler.
   */
  incrementReplayCount(memoryId: number): Promise<void>;
}

/**
 * ProfilePort — minimal contract for reading cognitive profiles.
 * Used by explore-features handler to load profile JSON.
 */
export interface ProfilePort {
  loadProfiles(): Promise<Record<string, unknown>>;
}

/**
 * NavigationService — orchestrates graph navigation end-to-end.
 * Composed from GraphPort + pure navigation functions.
 */
export interface NavigationService {
  navigate(
    memoryId: number,
    options: NavigationOptions,
  ): Promise<NavigationResponse>;
}
