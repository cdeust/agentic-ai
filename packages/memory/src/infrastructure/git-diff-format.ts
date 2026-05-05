/**
 * Diff-result formatting helpers for git-diff.
 *
 * Pure functions that turn raw git output (or raw file contents) into the
 * { file, diff_type, lines, truncated } shape that the UI renders. No
 * I/O, no subprocess; lives in infrastructure solely because
 * git-diff (its sole caller) lives there.
 *
 * Layer: INFRASTRUCTURE (pure formatting — no I/O).
 * source: Cortex mcp_server/infrastructure/git_diff_format.py
 */

/** A single diff line with its classification. */
export interface DiffLine {
  text: string;
  type: "hunk" | "add" | "del" | "ctx";
}

/** Standard diff result shape. */
export interface DiffResult {
  file: string;
  diff_type: string;
  lines: DiffLine[];
  truncated: boolean;
}

/**
 * Turn unified-diff text into typed line records.
 *
 * diff/index/+++/--- headers are dropped; @@ hunks
 * keep their type as "hunk"; +/-/context lines are typed as
 * "add"/"del"/"ctx" respectively.
 *
 * precondition:  raw is a string (may be empty).
 * postcondition: returns list of DiffLine objects; no header lines
 *   (diff, index, +++, ---) appear in the output.
 *
 * source: Cortex mcp_server/infrastructure/git_diff_format.py:parse_diff_lines
 */
export function parseDiffLines(raw: string): DiffLine[] {
  if (!raw) return [];
  const result: DiffLine[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("diff ") || line.startsWith("index ")) continue;
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("@@")) {
      result.push({ text: line, type: "hunk" });
    } else if (line.startsWith("+")) {
      result.push({ text: line, type: "add" });
    } else if (line.startsWith("-")) {
      result.push({ text: line, type: "del" });
    } else {
      result.push({ text: line, type: "ctx" });
    }
  }
  return result;
}

/**
 * Standard diff response from raw git diff output.
 *
 * precondition:  filepath and diffType are non-empty strings; maxLines > 0.
 * postcondition: returns DiffResult with lines.length <= maxLines;
 *   truncated is true iff the raw output exceeded maxLines.
 *
 * source: Cortex mcp_server/infrastructure/git_diff_format.py:build_result
 */
export function buildResult(
  filepath: string,
  diffType: string,
  raw: string,
  maxLines: number,
): DiffResult {
  const lines = parseDiffLines(raw);
  return {
    file: filepath,
    diff_type: diffType,
    lines: lines.slice(0, maxLines),
    truncated: lines.length > maxLines,
  };
}

/**
 * Render raw file content as an all-add diff (new-file view).
 *
 * precondition:  filepath and content are strings; maxLines > 0.
 * postcondition: returns DiffResult where every line has type "add".
 *
 * source: Cortex mcp_server/infrastructure/git_diff_format.py:content_as_new
 */
export function contentAsNew(
  filepath: string,
  content: string,
  maxLines: number,
  diffType: string = "new_file",
): DiffResult {
  const rawLines = content.split("\n");
  const lines: DiffLine[] = rawLines.map((ln) => ({
    text: "+" + ln,
    type: "add" as const,
  }));
  return {
    file: filepath,
    diff_type: diffType,
    lines: lines.slice(0, maxLines),
    truncated: lines.length > maxLines,
  };
}

/**
 * Render raw file content as an all-delete diff.
 *
 * precondition:  filepath and content are strings; maxLines > 0.
 * postcondition: returns DiffResult where every line has type "del".
 *
 * source: Cortex mcp_server/infrastructure/git_diff_format.py:content_as_delete
 */
export function contentAsDelete(
  filepath: string,
  content: string,
  maxLines: number,
): DiffResult {
  const rawLines = content.split("\n");
  const lines: DiffLine[] = rawLines.map((ln) => ({
    text: "-" + ln,
    type: "del" as const,
  }));
  return {
    file: filepath,
    diff_type: "deleted",
    lines: lines.slice(0, maxLines),
    truncated: lines.length > maxLines,
  };
}

/**
 * Render raw file content as an unchanged / context-only view.
 *
 * precondition:  filepath and content are strings; maxLines > 0.
 * postcondition: returns DiffResult where every line has type "ctx".
 *
 * source: Cortex mcp_server/infrastructure/git_diff_format.py:content_as_context
 */
export function contentAsContext(
  filepath: string,
  content: string,
  maxLines: number,
): DiffResult {
  const rawLines = content.split("\n");
  const lines: DiffLine[] = rawLines.map((ln) => ({
    text: " " + ln,
    type: "ctx" as const,
  }));
  return {
    file: filepath,
    diff_type: "unchanged",
    lines: lines.slice(0, maxLines),
    truncated: lines.length > maxLines,
  };
}
