/**
 * Shared error types for wiki handlers.
 *
 * Kept in a separate module to avoid circular imports between
 * wiki-handlers.ts and wiki-pending-handlers.ts.
 */

/**
 * Thrown when a wiki handler cannot execute because a required runtime
 * dependency is unavailable (DB connection failed, LLM client not wired,
 * Pandoc not installed, etc.).  Carries the handler name, python source
 * citation, and reason so the caller can surface a diagnostic.
 *
 * Precondition:  handlerName, pythonSource, and reason are non-empty strings.
 * Postcondition: this.name === "WikiUnavailableError"; this.message contains
 *                all three arguments.
 *
 * source: mcp_server/handlers/wiki_*.py — error contract is implicit in every
 *         handler that guards on a missing dependency.
 */
/**
 * Thrown when a wiki handler is not yet fully ported from Python.
 * Used as a placeholder that surfaces a clear diagnostic rather than a
 * silent no-op. Remove when the handler is fully implemented.
 *
 * source: explore-features.ts — originally defined there; re-exported here
 * so wiki-refine-handler.ts can import from a stable module.
 */
export { PortPendingError } from "../../graph/handlers/explore-features.js";

export class WikiUnavailableError extends Error {
  constructor(handlerName: string, pythonSource: string, reason: string) {
    super(
      `wiki-unavailable: ${handlerName} — ${reason}. ` +
      `Python source: ${pythonSource}`,
    );
    this.name = "WikiUnavailableError";
  }
}
