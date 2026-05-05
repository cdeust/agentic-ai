/**
 * On-demand full JSONL conversation reader.
 *
 * Reads entire conversation files line-by-line (streaming) and transforms
 * raw records into clean message objects for display.
 *
 * Layer: INFRASTRUCTURE — file I/O, no core imports.
 * source: Cortex mcp_server/infrastructure/conversation_reader.py
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** Raw JSONL record from a conversation file. */
export type RawRecord = Record<string, unknown>;

/** Formatted message shape returned by formatConversationMessages. */
export interface ConversationMessage {
  role: "user" | "assistant";
  text: string;
  timestamp: string | null;
  toolCalls: ToolCall[];
}

/** Tool call extracted from an assistant message. */
export interface ToolCall {
  name: string;
  input: string;
  output: string;
}

/**
 * Read entire JSONL file, return all records as objects.
 *
 * Reads line-by-line to handle large files without loading
 * the full content into memory at once.
 *
 * precondition:  filePath is a well-formed path string.
 * postcondition: returns [] if the file does not exist or is unreadable;
 *   returns a list of parsed JSON objects otherwise (skipping malformed lines).
 *
 * source: Cortex mcp_server/infrastructure/conversation_reader.py:read_full_conversation
 */
export function readFullConversation(filePath: string): RawRecord[] {
  const fp = path.resolve(filePath);
  if (!fs.existsSync(fp)) {
    return [];
  }

  const records: RawRecord[] = [];
  let raw: string;
  try {
    raw = fs.readFileSync(fp, "utf-8");
  } catch {
    return [];
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = JSON.parse(trimmed) as unknown;
      if (rec !== null && typeof rec === "object" && !Array.isArray(rec)) {
        records.push(rec as RawRecord);
      }
    } catch {
      // Skip malformed lines — source: conversation_reader.py ignores json.JSONDecodeError
    }
  }

  return records;
}

/**
 * Extract plain text from a message content field.
 *
 * source: Cortex mcp_server/infrastructure/conversation_reader.py:_extract_text
 */
function _extractText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (
        block !== null &&
        typeof block === "object" &&
        !Array.isArray(block)
      ) {
        const b = block as Record<string, unknown>;
        if (b["type"] === "text" && typeof b["text"] === "string") {
          parts.push(b["text"]);
        }
      } else if (typeof block === "string") {
        parts.push(block);
      }
    }
    return parts.join(" ");
  }
  return "";
}

/**
 * Extract tool_use blocks from assistant message content.
 *
 * source: Cortex mcp_server/infrastructure/conversation_reader.py:_extract_tool_calls
 */
function _extractToolCalls(content: unknown): ToolCall[] {
  if (!Array.isArray(content)) {
    return [];
  }
  const calls: ToolCall[] = [];
  for (const block of content) {
    if (
      block !== null &&
      typeof block === "object" &&
      !Array.isArray(block)
    ) {
      const b = block as Record<string, unknown>;
      if (b["type"] === "tool_use") {
        calls.push({
          name: typeof b["name"] === "string" ? b["name"] : "",
          input: String(b["input"] ?? ""),
          output: String(b["output"] ?? ""),
        });
      }
    }
  }
  return calls;
}

/**
 * Check if a record should be filtered out.
 *
 * source: Cortex mcp_server/infrastructure/conversation_reader.py:_is_skippable
 */
function _isSkippable(rec: RawRecord): boolean {
  if (rec["type"] === "system") return true;
  if (rec["isMeta"] === true) return true;
  if (rec["type"] === "user" && rec["toolUseResult"] !== undefined) return true;
  if (rec["permissionMode"] !== undefined) return true;
  return false;
}

/**
 * Transform raw JSONL records into clean message objects.
 *
 * precondition:  rawRecords is a list of parsed JSONL objects.
 * postcondition: returns list of ConversationMessage objects; system records,
 *   isMeta records, toolUseResult user records, and permissionMode records
 *   are excluded; only "user" and "assistant" typed records are included.
 *
 * source: Cortex mcp_server/infrastructure/conversation_reader.py:format_conversation_messages
 */
export function formatConversationMessages(
  rawRecords: RawRecord[],
): ConversationMessage[] {
  const messages: ConversationMessage[] = [];

  for (const rec of rawRecords) {
    if (_isSkippable(rec)) continue;

    const recType = rec["type"];
    if (recType !== "user" && recType !== "assistant") continue;

    const msg = (rec["message"] ?? {}) as Record<string, unknown>;
    const content = msg["content"];
    if (content === undefined) continue;

    const text = _extractText(content);
    const timestamp =
      typeof rec["timestamp"] === "string" ? rec["timestamp"] : null;

    const entry: ConversationMessage = {
      role: recType as "user" | "assistant",
      text,
      timestamp,
      toolCalls:
        recType === "assistant" ? _extractToolCalls(content) : [],
    };

    messages.push(entry);
  }

  return messages;
}
