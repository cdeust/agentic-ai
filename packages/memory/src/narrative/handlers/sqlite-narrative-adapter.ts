/**
 * SQLite narrative adapter stub.
 * Port pending: mcp_server/handlers/narrative_handlers.py
 * Source SHA: cortex@ed33435
 */

import type { MemoryPort } from "./narrative.js";
import type { MemoryRecord } from "../types.js";

/**
 * Stub adapter — full implementation pending (Eng-2 portage).
 * source: mcp_server/handlers/narrative_handlers.py
 */
export class SqliteNarrativeAdapter implements MemoryPort {


  getMemoriesForDirectory(_dir: string, _minHeat: number): MemoryRecord[] { return []; }
  getMemoriesForDomain(_domain: string, _minHeat: number, _limit: number): MemoryRecord[] { return []; }
  getHotMemories(_minHeat: number, _limit: number): MemoryRecord[] { return []; }
}
