/** A file of the diff against the first parent, with the line numbers it has in the working tree. */
export interface ChangedFile {
  readonly path: string;
  readonly deleted: boolean;
  /** Added or modified lines, numbered in the working tree version. Empty for a deleted file. */
  readonly lines: readonly number[];
}

const HEADER = /^diff --git a\/(.+) b\/\1$/;
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/** A file the first parent does not have (untracked, or every file of a root commit): all its lines are changed. */
export function wholeFile(path: string, text: string): ChangedFile {
  return { path, deleted: false, lines: text.split('\n').map((_, index) => index + 1) };
}

/**
 * Parses `git diff --unified=0 --no-renames` (so old and new paths are equal). Content lines of a hunk always start
 * with ' ', '+', '-' or '\', so a header or a hunk line can only be what it looks like.
 */
export function parseUnifiedDiff(text: string): ChangedFile[] {
  const files: { path: string; deleted: boolean; lines: number[] }[] = [];
  let current = { path: '', deleted: false, lines: [] as number[] };
  for (const line of text.split('\n')) {
    const header = HEADER.exec(line);
    const hunk = HUNK.exec(line);
    if (header !== null) {
      current = { path: header[1] as string, deleted: false, lines: [] };
      files.push(current);
    } else if (line.startsWith('deleted file mode')) {
      current.deleted = true;
    } else if (hunk !== null) {
      const start = Number(hunk[1]);
      const count = Number(hunk[2] ?? 1);
      for (let offset = 0; offset < count; offset++) current.lines.push(start + offset);
    }
  }
  return files;
}
