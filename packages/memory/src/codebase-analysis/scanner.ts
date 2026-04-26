/**
 * Data ingestion from ~/.claude/ — discovers memories and conversations.
 *
 * Ported from mcp_server/infrastructure/scanner.py
 *
 * - Memories: walk projects/[name]/memory/[file].md, parse YAML frontmatter
 * - Conversations: walk projects/[name]/[session].jsonl, read head+tail
 * - Head/tail: first 32KB + last 8KB for efficiency on large JSONL files
 */

import { existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildConversationRecord,
  extractMessageStats,
  extractMetadataFields,
} from "./scanner-parse.js";

const HEAD_BYTES = 32768;
const TAIL_BYTES = 8192;

// ── JSONL helpers ─────────────────────────────────────────────────────────

function _parseJsonlLines(lines: string[]): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      // skip invalid JSON lines
    }
  }
  return records;
}

export function readHeadTail(filePath: string): Record<string, unknown>[] {
  /**
   * Read head and tail of a JSONL file for efficient metadata extraction.
   */
  if (!existsSync(filePath)) return [];
  try {
    const stat = statSync(filePath);
    const fileSize = stat.size;
    const fd = openSync(filePath, "r");

    const headSize = Math.min(HEAD_BYTES, fileSize);
    const headBuf = Buffer.alloc(headSize);
    readSync(fd, headBuf, 0, headSize, 0);
    const headStr = headBuf.toString("utf8");
    const headLines = headStr.split("\n");
    if (headSize < fileSize) headLines.pop(); // last line may be truncated

    let records = _parseJsonlLines(headLines);

    if (fileSize > HEAD_BYTES + TAIL_BYTES) {
      const tailBuf = Buffer.alloc(TAIL_BYTES);
      readSync(fd, tailBuf, 0, TAIL_BYTES, fileSize - TAIL_BYTES);
      const tailStr = tailBuf.toString("utf8");
      const tailLines = tailStr.split("\n");
      tailLines.shift(); // first line may be truncated
      records = records.concat(_parseJsonlLines(tailLines));
    }

    // Node doesn't auto-close fds from openSync; close manually.
    // Using dynamic import to avoid top-level import of closeSync
    // (already available in the sync API we're using).
    try {
      const { closeSync } = require("node:fs") as typeof import("node:fs");
      closeSync(fd);
    } catch {
      // best-effort
    }

    return records;
  } catch {
    return [];
  }
}

export function* iterToolUses(
  filePath: string,
): Generator<{ name: string; input: Record<string, unknown>; line: number }> {
  /**
   * Stream every assistant tool_use block from a JSONL session.
   *
   * Unlike readHeadTail, this scans the WHOLE file line-by-line,
   * so it captures tool invocations that occur in the middle of a long
   * session (the vast majority of Task/Bash/Edit usage).
   *
   * Yields dicts with keys {"name", "input", "line"}. Invalid JSON
   * lines are skipped silently — matching the existing parser contract.
   */
  if (!existsSync(filePath)) return;
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return;
  }
  const lines = content.split("\n");
  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const s = (lines[lineNo] ?? "").trim();
    if (!s) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(s) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (rec["type"] !== "assistant") continue;
    const msgContent = ((rec["message"] ?? {}) as Record<string, unknown>)["content"];
    if (!Array.isArray(msgContent)) continue;
    for (const block of msgContent) {
      if (
        typeof block !== "object" ||
        block === null ||
        (block as Record<string, unknown>)["type"] !== "tool_use"
      )
        continue;
      const b = block as Record<string, unknown>;
      yield {
        name: (b["name"] as string) ?? "",
        input: (b["input"] as Record<string, unknown>) ?? {},
        line: lineNo + 1,
      };
    }
  }
}

// ── Memory discovery ──────────────────────────────────────────────────────

function _formatTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace("+00:00", "Z");
}

function _parseMemoryFile(
  filePath: string,
  projectName: string,
  fileName: string,
): Record<string, unknown> | null {
  let content: string;
  try {
    content = require("node:fs").readFileSync(filePath, "utf8") as string;
  } catch {
    return null;
  }
  if (!content) return null;

  const { meta, body } = _parseYamlFrontmatter(content);

  let modifiedAt: string | null = null;
  let createdAt: string | null = null;
  try {
    const st = statSync(filePath);
    modifiedAt = _formatTimestamp(st.mtimeMs);
    createdAt = _formatTimestamp(st.birthtimeMs ?? st.ctimeMs);
  } catch {
    // best-effort
  }

  return {
    file: fileName,
    path: filePath,
    project: projectName,
    name: (meta["name"] as string) ?? fileName.replace(".md", ""),
    description: (meta["description"] as string) ?? "",
    type: (meta["type"] as string) ?? "unknown",
    body,
    modifiedAt,
    createdAt,
  };
}

function _parseYamlFrontmatter(content: string): {
  meta: Record<string, unknown>;
  body: string;
} {
  if (!content.startsWith("---")) return { meta: {}, body: content };
  const end = content.indexOf("\n---", 3);
  if (end < 0) return { meta: {}, body: content };
  const frontmatter = content.slice(3, end).trim();
  const body = content.slice(end + 4).trim();
  const meta: Record<string, unknown> = {};
  for (const line of frontmatter.split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    meta[key] = val;
  }
  return { meta, body };
}

export function discoverAllMemories(claudeDir: string): Record<string, unknown>[] {
  /**
   * Discover all memory files across Claude project directories.
   */
  const projectsDir = join(claudeDir, "projects");
  const memories: Record<string, unknown>[] = [];

  let projectEntries: string[];
  try {
    projectEntries = readdirSync(projectsDir);
  } catch {
    return [];
  }

  for (const pdirName of projectEntries) {
    const pdirPath = join(projectsDir, pdirName);
    try {
      if (!statSync(pdirPath).isDirectory()) continue;
    } catch {
      continue;
    }

    const memoryDir = join(pdirPath, "memory");
    let files: string[];
    try {
      files = readdirSync(memoryDir);
    } catch {
      continue;
    }

    for (const fileName of files) {
      if (!fileName.endsWith(".md") || fileName === "MEMORY.md") continue;
      try {
        const result = _parseMemoryFile(join(memoryDir, fileName), pdirName, fileName);
        if (result) memories.push(result);
      } catch (e) {
        process.stderr.write(
          `[methodology-agent] Failed to read ${join(memoryDir, fileName)}: ${e}\n`,
        );
      }
    }
  }

  return memories;
}

// ── Conversation discovery ────────────────────────────────────────────────

function _parseConversationFile(
  filePath: string,
  projectName: string,
  fallbackId: string,
): Record<string, unknown> | null {
  const rawRecords = readHeadTail(filePath);
  if (rawRecords.length === 0) return null;

  const meta = extractMetadataFields(rawRecords);
  const stats = extractMessageStats(rawRecords);

  if (stats.userCount + stats.assistantCount === 0) return null;

  return buildConversationRecord(
    meta,
    stats,
    filePath,
    projectName,
    fallbackId,
  );
}

export function discoverConversations(
  claudeDir: string,
): Record<string, unknown>[] {
  /**
   * Discover all conversation JSONL files across Claude project directories.
   */
  const projectsDir = join(claudeDir, "projects");
  const conversations: Record<string, unknown>[] = [];

  let projectEntries: string[];
  try {
    projectEntries = readdirSync(projectsDir);
  } catch {
    return [];
  }

  for (const pdirName of projectEntries) {
    const pdirPath = join(projectsDir, pdirName);
    try {
      if (!statSync(pdirPath).isDirectory()) continue;
    } catch {
      continue;
    }

    let projEntries: string[];
    try {
      projEntries = readdirSync(pdirPath);
    } catch {
      continue;
    }

    for (const entryName of projEntries) {
      if (!entryName.endsWith(".jsonl")) continue;
      if (entryName.includes("subagent")) continue;
      const filePath = join(pdirPath, entryName);
      if (filePath.includes("subagents")) continue;

      try {
        const record = _parseConversationFile(
          filePath,
          pdirName,
          entryName.replace(".jsonl", ""),
        );
        if (record) conversations.push(record);
      } catch (e) {
        process.stderr.write(
          `[methodology-agent] Failed to read conversation ${filePath}: ${e}\n`,
        );
      }
    }
  }

  return conversations;
}

export function groupByProject(
  conversations: Record<string, unknown>[],
): Record<string, Record<string, unknown>[]> {
  const groups: Record<string, Record<string, unknown>[]> = {};
  for (const conv of conversations) {
    const proj = (conv["project"] as string) ?? "";
    if (!groups[proj]) groups[proj] = [];
    groups[proj]!.push(conv);
  }
  return groups;
}
