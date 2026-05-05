/**
 * Shared error types for wiki handlers.
 *
 * Kept in a separate module to avoid circular imports between
 * wiki-handlers.ts and individual handler files.
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
export class WikiUnavailableError extends Error {
  constructor(handlerName: string, pythonSource: string, reason: string) {
    super(
      `wiki-unavailable: ${handlerName} — ${reason}. ` +
      `Python source: ${pythonSource}`,
    );
    this.name = "WikiUnavailableError";
  }
}
