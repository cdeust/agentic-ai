/**
 * Shared error types for wiki handlers.
 *
 * Kept in a separate module to avoid circular imports between
 * wiki-handlers.ts and wiki-pending-handlers.ts.
 */

/**
 * Thrown when a handler's dependency (pg_store_wiki, LLM client, etc.)
 * is not yet wired.  Carries the specific missing dependency name so the
 * caller can distinguish "real error" from "not implemented yet".
 *
 * Precondition:  handlerName, pythonSource, and reason are non-empty strings.
 * Postcondition: this.name === "PortPendingError"; this.message contains all
 *                three arguments.
 */
export class PortPendingError extends Error {
  constructor(handlerName: string, pythonSource: string, reason: string) {
    super(
      `port-pending: ${handlerName} requires ${reason}. ` +
      `Python source: ${pythonSource}`,
    );
    this.name = "PortPendingError";
  }
}
