/**
 * @agentic/codebase — internal/envelope.ts
 *
 * Unwrap the MCP tool-call envelope that the Rust binary uses:
 *   { "content": [{ "type": "text", "text": "<JSON payload>" }] }
 *
 * The adapter MUST unwrap before Zod-validating; callers see the inner payload.
 *
 * source: docs/PHASE_3_PLAN.md §1.6 — Tool-call envelope description
 * source: packages/parity-runner/src/runners/codebase.ts — reference invocation pattern
 *
 * Layer: infrastructure / internal (shared within @agentic/codebase only)
 * Allowed imports: @agentic/core (errors only), stdlib
 */

import { CodebaseSubprocessError } from "@agentic/core";

/**
 * The raw shape of a Rust binary tools/call success response.
 *
 * source: docs/PHASE_3_PLAN.md §1.6 — Response shape (success)
 */
interface RawToolResult {
  readonly content: ReadonlyArray<{
    readonly type: string;
    readonly text: string;
  }>;
  readonly isError?: boolean;
}

/**
 * Unwrap the MCP text-envelope and return the parsed inner payload.
 *
 * precondition: raw is a non-null object returned by the Rust binary for tools/call
 * postcondition: returns the JSON-parsed inner payload; never returns undefined/null
 *
 * @throws CodebaseSubprocessError when the envelope is malformed or the inner
 *         JSON cannot be parsed
 * @throws CodebaseSubprocessError with "unknown tool" prefix when isError === true
 */
export function unwrapEnvelope(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== "object") {
    throw new CodebaseSubprocessError(
      `Expected envelope object, got: ${typeof raw}`,
    );
  }

  const result = raw as RawToolResult;

  if (result.isError === true) {
    const text =
      result.content?.[0]?.text ?? "Unknown tool error from Rust binary";
    throw new CodebaseSubprocessError(`Rust binary reported error: ${text}`);
  }

  const content = result.content;
  if (!Array.isArray(content) || content.length === 0) {
    throw new CodebaseSubprocessError(
      `Envelope missing content array: ${JSON.stringify(raw)}`,
    );
  }

  const firstItem = content[0];
  if (firstItem === undefined || firstItem.type !== "text") {
    throw new CodebaseSubprocessError(
      `Envelope first content item is not type=text: ${JSON.stringify(firstItem)}`,
    );
  }

  const text = firstItem.text;
  if (typeof text !== "string") {
    throw new CodebaseSubprocessError(
      `Envelope text field is not a string: ${typeof text}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    throw new CodebaseSubprocessError(
      `Failed to parse inner envelope JSON: ${String(err)}`,
    );
  }

  if (parsed === null || typeof parsed !== "object") {
    throw new CodebaseSubprocessError(
      `Inner envelope payload is not an object: ${typeof parsed}`,
    );
  }

  return parsed as Record<string, unknown>;
}
