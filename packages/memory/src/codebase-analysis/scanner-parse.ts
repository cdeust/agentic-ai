/**
 * Conversation record parsing helpers for the scanner module.
 *
 * Ported from mcp_server/infrastructure/scanner_parse.py
 *
 * Extracts metadata, message statistics, and assembles conversation records
 * from raw JSONL records. Separated from scanner.ts to stay under 300 lines.
 */

import { statSync } from "node:fs";

// ── Types ─────────────────────────────────────────────────────────────────

export interface ConversationMeta {
  sessionId: string | null;
  slug: string | null;
  cwd: string | null;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
}

export interface MessageStats {
  userCount: number;
  assistantCount: number;
  toolsUsed: Set<string>;
  firstMessage: string | null;
  allText: string | null;
}

export interface ConversationRecord {
  sessionId: string;
  slug: string | null;
  project: string;
  cwd: string | null;
  firstMessage: string | null;
  allText: string | null;
  keywords: string[];
  startedAt: string | null;
  endedAt: string | null;
  messageCount: number;
  userCount: number;
  assistantCount: number;
  turnCount: number;
  toolsUsed: string[];
  duration: number | null;
  fileSize: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────

export function extractUserText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is Record<string, unknown> => typeof b === "object" && b !== null)
      .filter((b) => b["type"] === "text")
      .map((b) => (b["text"] as string) ?? "")
      .join(" ");
  }
  return "";
}

export function extractMetadataFields(
  rawRecords: Record<string, unknown>[],
): ConversationMeta {
  let sessionId: string | null = null;
  let slug: string | null = null;
  let cwd: string | null = null;
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;

  for (const rec of rawRecords) {
    if (rec["sessionId"] && !sessionId) sessionId = rec["sessionId"] as string;
    if (rec["slug"] && !slug) slug = rec["slug"] as string;
    if (rec["cwd"] && !cwd) cwd = rec["cwd"] as string;

    const ts = rec["timestamp"] as string | undefined;
    if (ts) {
      if (!firstTimestamp || ts < firstTimestamp) firstTimestamp = ts;
      if (!lastTimestamp || ts > lastTimestamp) lastTimestamp = ts;
    }
  }

  return { sessionId, slug, cwd, firstTimestamp, lastTimestamp };
}

function _extractToolsFromContent(
  content: unknown,
  toolsUsed: Set<string>,
): void {
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as Record<string, unknown>)["type"] === "tool_use" &&
      (block as Record<string, unknown>)["name"]
    ) {
      toolsUsed.add((block as Record<string, unknown>)["name"] as string);
    }
  }
}

export function extractMessageStats(
  rawRecords: Record<string, unknown>[],
): MessageStats {
  let userCount = 0;
  let assistantCount = 0;
  const toolsUsed = new Set<string>();
  let firstMessage: string | null = null;
  const allTextParts: string[] = [];
  let allTextLen = 0;

  for (const rec of rawRecords) {
    if (rec["type"] === "user") {
      userCount++;
      const msg = (rec["message"] ?? {}) as Record<string, unknown>;
      const content = msg["content"];
      if (content && !rec["isMeta"] && !rec["toolUseResult"]) {
        const text = extractUserText(content);
        if (text && !text.startsWith("[Request interrupted")) {
          if (!firstMessage) firstMessage = text;
          if (allTextLen < 4000) {
            const chunk = text.slice(0, 4000 - allTextLen);
            allTextParts.push(chunk);
            allTextLen += chunk.length;
          }
        }
      }
    }
    if (rec["type"] === "assistant") {
      assistantCount++;
      _extractToolsFromContent(
        ((rec["message"] ?? {}) as Record<string, unknown>)["content"],
        toolsUsed,
      );
    }
  }

  return {
    userCount,
    assistantCount,
    toolsUsed,
    firstMessage,
    allText: allTextParts.join(" ") || null,
  };
}

export function computeDuration(
  firstTs: string | null,
  lastTs: string | null,
): number | null {
  if (!firstTs || !lastTs) return null;
  try {
    const t1 = new Date(firstTs).getTime();
    const t2 = new Date(lastTs).getTime();
    return t2 - t1; // milliseconds
  } catch {
    return null;
  }
}

function _extractKeywords(text: string): string[] {
  // Minimal keyword extraction: words >= 4 chars, lowercased, deduped
  const seen = new Set<string>();
  const words: string[] = [];
  for (const word of text.toLowerCase().split(/\W+/)) {
    if (word.length >= 4 && !seen.has(word)) {
      seen.add(word);
      words.push(word);
    }
  }
  return words.slice(0, 20);
}

export function buildConversationRecord(
  meta: ConversationMeta,
  stats: MessageStats,
  filePath: string,
  projectName: string,
  fallbackId: string,
): ConversationRecord {
  const sessionId = meta.sessionId ?? fallbackId;
  const allText = stats.allText;

  let fileSize: number | null = null;
  try {
    fileSize = statSync(filePath).size;
  } catch {
    fileSize = null;
  }

  return {
    sessionId,
    slug: meta.slug,
    project: projectName,
    cwd: meta.cwd,
    firstMessage: stats.firstMessage,
    allText,
    keywords: _extractKeywords(allText ?? ""),
    startedAt: meta.firstTimestamp,
    endedAt: meta.lastTimestamp,
    messageCount: stats.userCount + stats.assistantCount,
    userCount: stats.userCount,
    assistantCount: stats.assistantCount,
    turnCount: stats.assistantCount,
    toolsUsed: [...stats.toolsUsed],
    duration: computeDuration(meta.firstTimestamp, meta.lastTimestamp),
    fileSize,
  };
}
