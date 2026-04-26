/**
 * Handler: navigate-memory — SR-based memory space traversal.
 *
 * Treats the memory store as a navigable space where memories are linked
 * by temporal co-access (Successor Representation). Starting from a given
 * memory, explores the neighborhood: what memories tend to be accessed
 * alongside or after this one?
 *
 * This is the TS port of mcp_server/handlers/navigate_memory.py.
 * Read-only over the persisted graph. Mutates only replay counters.
 *
 * source: navigate_memory.py handler in mcp_server/handlers/.
 * source: Dayan (1993) "Improving Generalization for Temporal Difference
 *   Learning" — SR graph cited in the Python schema description.
 * source: Stachenfeld et al. (2017) "The Hippocampus as a Predictive Map".
 */

import { NavigationRequestSchema } from "../types.js";
import type { NavigationResponse } from "../types.js";
import type { GraphPort } from "../port.js";
import { navigate } from "../navigation.js";

// ── Handler input schema (JSON-RPC args shape) ────────────────────────────

export { NavigationRequestSchema as schema };

// ── Handler ────────────────────────────────────────────────────────────────

/**
 * Navigate memory space from a starting memory using SR co-access.
 *
 * Mirrors the async handler function signature from navigate_memory.py.
 *
 * @param args  - Raw handler arguments (validated by schema).
 * @param port  - Persistence port (injected; read-only).
 * @returns NavigationResponse.
 */
export async function handler(
  args: Record<string, unknown> | undefined,
  port: GraphPort,
): Promise<NavigationResponse> {
  if (!args || args["memory_id"] === undefined) {
    return { startMemoryId: 0, neighbors: [], total: 0, srGraphSize: 0 };
  }

  // Validate and coerce input
  const parsed = NavigationRequestSchema.safeParse({
    memoryId: args["memory_id"],
    maxDepth: args["max_depth"],
    include2dMap: args["include_2d_map"],
    windowHours: args["window_hours"],
  });

  if (!parsed.success) {
    return {
      startMemoryId: 0,
      neighbors: [],
      total: 0,
      srGraphSize: 0,
      reason: "invalid_input",
    };
  }

  const { memoryId, maxDepth, include2dMap, windowHours } = parsed.data;

  const startMem = await port.getMemory(memoryId);
  if (!startMem) {
    return {
      startMemoryId: memoryId,
      neighbors: [],
      total: 0,
      srGraphSize: 0,
      reason: "memory_not_found",
    };
  }

  const allMems = await port.getRecentlyAccessedMemories(200, 1);

  const response = navigate(startMem, allMems, {
    maxDepth,
    include2dMap,
    windowHours,
  });

  // Track replay for start memory and traversed neighbors (best-effort)
  const replayIds = [memoryId, ...response.neighbors.map((n) => n.memoryId)];
  await Promise.allSettled(
    replayIds.flatMap((mid) => [
      port.updateMemoryAccess(mid),
      port.incrementReplayCount(mid),
    ]),
  );

  return response;
}
