/**
 * Streaming JSONL scanner for Claude Code session files.
 *
 * Implements the ADR-0045 R2 head+tail read strategy: first HEAD_BYTES +
 * last TAIL_BYTES of any JSONL file are read, never the whole file. This
 * bounds memory at ~40 KB regardless of file size and prevents OOM on
 * multi-GB JSONL histories.
 *
 * Port of: mcp_server/infrastructure/scanner.py::read_head_tail
 *
 * source: ADR-0045 R2 — no ingestion path reads a whole file/store into memory.
 *         HEAD_BYTES=32768, TAIL_BYTES=8192 — mcp_server/infrastructure/scanner.py
 */

import {
  existsSync,
  openSync,
  readSync,
  fstatSync,
  closeSync,
  readdirSync,
  statSync,
} from "node:fs";

import type { JsonlRecord } from "./types.js";

// source: HEAD_BYTES=32768, TAIL_BYTES=8192 — scanner.py
const HEAD_BYTES = 32768;
const TAIL_BYTES = 8192;

// ── JSONL parsing ─────────────────────────────────────────────────────────

/**
 * Parse JSONL lines, skipping blanks and invalid JSON.
 *
 * Port of: mcp_server/infrastructure/scanner.py::_parse_jsonl_lines
 */
function parseJsonlLines(lines: string[]): JsonlRecord[] {
  const records: JsonlRecord[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as JsonlRecord);
    } catch {
      // skip malformed lines — matches Python contract
    }
  }
  return records;
}

// ── Head+tail read ────────────────────────────────────────────────────────

/**
 * Read head and tail of a JSONL file for efficient metadata extraction.
 *
 * Reads first HEAD_BYTES + last TAIL_BYTES, never the full file. Returns
 * parsed JSONL records. Returns [] on any error (matches Python contract).
 *
 * Port of: mcp_server/infrastructure/scanner.py::read_head_tail
 *
 * source: ADR-0045 R2 — no ingestion path reads a whole file/store into memory.
 * source: HEAD_BYTES=32768, TAIL_BYTES=8192 — scanner.py
 */
export function readHeadTail(filePath: string): JsonlRecord[] {
  if (!existsSync(filePath)) return [];

  let fd: number | null = null;
  try {
    fd = openSync(filePath, "r");
    const stats = fstatSync(fd);
    const fileSize = stats.size;

    // Read head
    const headSize = Math.min(HEAD_BYTES, fileSize);
    const headBuf = Buffer.allocUnsafe(headSize);
    readSync(fd, headBuf, 0, headSize, 0);
    const headStr = headBuf.toString("utf8");

    const headLines = headStr.split("\n");
    // If we didn't read the whole file, the last head line may be truncated
    if (headSize < fileSize) {
      headLines.pop();
    }
    const records = parseJsonlLines(headLines);

    // Read tail only if file exceeds combined head+tail window
    if (fileSize > HEAD_BYTES + TAIL_BYTES) {
      const tailBuf = Buffer.allocUnsafe(TAIL_BYTES);
      readSync(fd, tailBuf, 0, TAIL_BYTES, fileSize - TAIL_BYTES);
      const tailStr = tailBuf.toString("utf8");
      const tailLines = tailStr.split("\n");
      // The first tail line is likely truncated — skip it
      tailLines.shift();
      records.push(...parseJsonlLines(tailLines));
    }

    return records;
  } catch {
    return [];
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // ignore close errors
      }
    }
  }
}

// ── JSONL file discovery ──────────────────────────────────────────────────

export interface JsonlFileEntry {
  filePath: string;
  projectName: string;
}

/**
 * Check whether a file path contains a subagent marker.
 *
 * Port of: mcp_server/handlers/import_sessions.py::_discover_jsonl_files
 * The Python source filters on "subagent" in filename OR "subagents" in path.
 */
function isSubagentPath(filePath: string, fileName: string): boolean {
  return fileName.includes("subagent") || filePath.includes("subagents");
}

/**
 * Find all JSONL conversation files under a projects directory,
 * optionally filtered by project slug.
 *
 * Port of: mcp_server/handlers/import_sessions.py::_discover_jsonl_files
 *
 * source: mcp_server/handlers/import_sessions.py::_discover_jsonl_files
 */
export function discoverJsonlFiles(
  projectsDir: string,
  projectFilter: string,
): JsonlFileEntry[] {
  if (!existsSync(projectsDir)) return [];

  const results: JsonlFileEntry[] = [];

  let projectDirs: string[];
  try {
    projectDirs = readdirSync(projectsDir).sort();
  } catch {
    return [];
  }

  for (const pname of projectDirs) {
    if (projectFilter && pname !== projectFilter) continue;

    const pdirPath = `${projectsDir}/${pname}`;
    let pdirStat: ReturnType<typeof statSync>;
    try {
      pdirStat = statSync(pdirPath);
    } catch {
      continue;
    }
    if (!pdirStat.isDirectory()) continue;

    let files: string[];
    try {
      files = readdirSync(pdirPath).sort();
    } catch {
      continue;
    }

    for (const fname of files) {
      if (!fname.endsWith(".jsonl")) continue;
      const fpath = `${pdirPath}/${fname}`;
      if (isSubagentPath(fpath, fname)) continue;

      let fstat: ReturnType<typeof statSync>;
      try {
        fstat = statSync(fpath);
      } catch {
        continue;
      }
      if (!fstat.isFile()) continue;

      results.push({ filePath: fpath, projectName: pname });
    }
  }

  return results;
}
