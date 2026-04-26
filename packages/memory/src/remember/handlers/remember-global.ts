/**
 * handlers/remember-global.ts — Global memory variant of remember.
 *
 * Ports: handlers/remember_global.py (not in inventory but exists in source)
 *
 * A thin wrapper over remember() that forces is_global=true.
 * Global memories are visible across all projects/domains.
 *
 * Correctness contract:
 *   pre:  same as remember().
 *   post: same as remember(), with is_global=true in the stored row.
 *
 * source: handlers/remember.py (is_global path)
 */

import { remember } from "./remember.js";
import type { MemoryStore } from "../storage/memory-store.js";
import type { RememberResponse } from "../types.js";

export interface RememberGlobalRequest {
  content: string;
  tags?: string[];
  source?: string;
  agent_topic?: string;
  force?: boolean;
  created_at?: string;
  initial_heat?: number;
}

/**
 * rememberGlobal — store a memory visible across all domains.
 *
 * source: handlers/remember.py (is_global=True path)
 */
export function rememberGlobal(
  args: RememberGlobalRequest,
  store: MemoryStore,
): RememberResponse {
  return remember(
    {
      content: args.content,
      tags: args.tags ?? [],
      source: args.source ?? "user",
      agent_topic: args.agent_topic ?? "",
      force: args.force ?? false,
      is_global: true, // invariant: always true for global variant
      created_at: args.created_at,
      initial_heat: args.initial_heat,
    },
    store,
  );
}
