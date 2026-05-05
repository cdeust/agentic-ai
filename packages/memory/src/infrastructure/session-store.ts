/**
 * Persistence layer for the session log.
 *
 * - loadSessionLog always returns { sessions: [] } at minimum
 * - saveSessionLog persists the log
 *
 * Layer: INFRASTRUCTURE — file I/O only, no core imports.
 * source: Cortex mcp_server/infrastructure/session_store.py
 */

import { SESSION_LOG_PATH } from "./config.js";
import { readJson, writeJson } from "./file-io.js";

/**
 * Load the session log from disk.
 *
 * precondition:  none (SESSION_LOG_PATH may not exist).
 * postcondition: returns { sessions: [] } if the file is missing or invalid;
 *   returns the parsed log dict otherwise.
 *
 * source: Cortex mcp_server/infrastructure/session_store.py:load_session_log
 */
export function loadSessionLog(): { sessions: unknown[] } {
  const raw = readJson(SESSION_LOG_PATH);
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj["sessions"])) {
      return obj as { sessions: unknown[] };
    }
  }
  return { sessions: [] };
}

/**
 * Save the session log to disk.
 *
 * precondition:  log is a serializable object with a sessions array.
 * postcondition: SESSION_LOG_PATH contains the JSON-serialised log.
 *
 * source: Cortex mcp_server/infrastructure/session_store.py:save_session_log
 */
export function saveSessionLog(log: { sessions: unknown[] }): void {
  writeJson(SESSION_LOG_PATH, log);
}
