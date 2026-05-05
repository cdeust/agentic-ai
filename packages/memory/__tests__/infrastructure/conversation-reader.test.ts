/**
 * Unit tests for infrastructure/conversation-reader.ts
 *
 * Invariants:
 *   - readFullConversation returns [] for missing file (never throws)
 *   - formatConversationMessages skips system, isMeta, toolUseResult, permissionMode records
 *   - tool_use blocks are extracted from assistant content
 *
 * source: Cortex mcp_server/infrastructure/conversation_reader.py
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  readFullConversation,
  formatConversationMessages,
  type RawRecord,
} from "../../src/infrastructure/conversation-reader.js";

describe("readFullConversation", () => {
  it("returns [] for missing file", () => {
    expect(readFullConversation("/no/such/file.jsonl")).toEqual([]);
  });

  it("parses valid JSONL lines", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "conv-test-"));
    const p = path.join(dir, "conv.jsonl");
    fs.writeFileSync(
      p,
      [
        JSON.stringify({ type: "user", message: { content: "hello" } }),
        JSON.stringify({ type: "assistant", message: { content: "world" } }),
      ].join("\n"),
    );
    const records = readFullConversation(p);
    expect(records).toHaveLength(2);
    expect(records[0]?.type).toBe("user");
    fs.rmSync(dir, { recursive: true });
  });

  it("skips malformed JSONL lines", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "conv-test-"));
    const p = path.join(dir, "conv.jsonl");
    fs.writeFileSync(
      p,
      [
        JSON.stringify({ type: "user" }),
        "NOT JSON",
        JSON.stringify({ type: "assistant" }),
      ].join("\n"),
    );
    const records = readFullConversation(p);
    expect(records).toHaveLength(2);
    fs.rmSync(dir, { recursive: true });
  });
});

describe("formatConversationMessages", () => {
  it("filters system records", () => {
    const raw: RawRecord[] = [
      { type: "system", message: { content: "system prompt" } },
      { type: "user", message: { content: "hello" }, timestamp: "t1" },
    ];
    const msgs = formatConversationMessages(raw);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.role).toBe("user");
  });

  it("filters isMeta records", () => {
    const raw: RawRecord[] = [
      { type: "user", isMeta: true, message: { content: "meta" } },
      { type: "user", message: { content: "real" }, timestamp: "t2" },
    ];
    const msgs = formatConversationMessages(raw);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.text).toBe("real");
  });

  it("filters user records with toolUseResult", () => {
    const raw: RawRecord[] = [
      { type: "user", toolUseResult: true, message: { content: "tool result" } },
      { type: "user", message: { content: "real user" }, timestamp: "t3" },
    ];
    const msgs = formatConversationMessages(raw);
    expect(msgs).toHaveLength(1);
  });

  it("extracts text from string content", () => {
    const raw: RawRecord[] = [
      { type: "user", message: { content: "plain text" }, timestamp: "t4" },
    ];
    const msgs = formatConversationMessages(raw);
    expect(msgs[0]?.text).toBe("plain text");
  });

  it("extracts text from block-array content", () => {
    const raw: RawRecord[] = [
      {
        type: "user",
        message: {
          content: [
            { type: "text", text: "hello" },
            { type: "text", text: "world" },
          ],
        },
        timestamp: "t5",
      },
    ];
    const msgs = formatConversationMessages(raw);
    expect(msgs[0]?.text).toBe("hello world");
  });

  it("extracts tool_use blocks from assistant content", () => {
    const raw: RawRecord[] = [
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "recall", input: { q: "x" }, output: {} },
          ],
        },
        timestamp: "t6",
      },
    ];
    const msgs = formatConversationMessages(raw);
    expect(msgs[0]?.toolCalls).toHaveLength(1);
    expect(msgs[0]?.toolCalls[0]?.name).toBe("recall");
  });

  it("user messages have empty toolCalls", () => {
    const raw: RawRecord[] = [
      { type: "user", message: { content: "hi" }, timestamp: "t7" },
    ];
    const msgs = formatConversationMessages(raw);
    expect(msgs[0]?.toolCalls).toEqual([]);
  });
});
