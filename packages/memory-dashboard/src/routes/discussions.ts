/**
 * routes/discussions.ts — GET /api/discussions + GET /api/discussion/:id
 *
 * TS port of:
 *   cortex@ed33435 mcp_server/server/http_standalone_graph.py:1046-1139
 *   (build_discussions_response, build_discussion_detail, _get_cached_conversations)
 *   cortex@ed33435 mcp_server/server/http_standalone_endpoints.py:159-173
 *
 * Serves paginated session listings and single-session transcripts.
 *
 * Layer: handlers — reads JSONL session files from CLAUDE_DIR/projects/.
 *
 * precondition:  CLAUDE_DIR env var is set OR defaults to ~/.claude.
 * postcondition: /api/discussions returns paginated session metadata;
 *   /api/discussion/:id returns full message transcript.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { FastifyInstance } from "fastify";

// ── Named constants ───────────────────────────────────────────────────────────
const FIRST_LINE_BUF = 512;  // source: measured: JSONL first-line timestamps fit in 512 bytes for all observed Cortex session files
const MSG_CONTENT_CAP = 2000; // source: cortex@ed33435 mcp_server/infrastructure/conversation_reader.py — 2000-char content cap per message for API safety
const DEFAULT_BATCH_SIZE = 500; // source: cortex@ed33435 mcp_server/server/http_standalone_graph.py:129 — default batch_size=500
const HTTP_404 = 404; // source: RFC 7231 §6.5.4 — Not Found
const HTTP_500 = 500; // source: RFC 7231 §6.6 — Internal Server Error

// source: cortex@ed33435 mcp_server/infrastructure/config.py (CLAUDE_DIR)
function getClaudeDir(): string {
  return process.env["CLAUDE_DIR"] ?? path.join(os.homedir(), ".claude");
}

// source: cortex@ed33435 mcp_server/server/http_standalone_state.py:23
const CONVERSATIONS_CACHE_TTL_MS = 60_000;

// ── Module-level conversations cache ─────────────────────────────────────────

interface ConversationMeta {
  sessionId: string;
  project: string;
  startedAt: string;
  endedAt?: string;
  duration?: number;
  turnCount?: number;
}

let _cachedConversations: ConversationMeta[] | null = null;
let _cacheTs = 0;

// ── Discovery ─────────────────────────────────────────────────────────────────

/**
 * Scan ~/.claude/projects/ for all *.jsonl conversation files.
 * Returns lightweight metadata (no message bodies).
 *
 * source: cortex@ed33435 mcp_server/infrastructure/scanner.py (discover_conversations)
 *
 * precondition:  CLAUDE_DIR/projects/ may or may not exist.
 * postcondition: returns array of ConversationMeta; empty if dir absent.
 */
function discoverConversations(): ConversationMeta[] {
  const projectsDir = path.join(getClaudeDir(), "projects");
  const results: ConversationMeta[] = [];
  try {
    const projects = fs.readdirSync(projectsDir, { withFileTypes: true });
    for (const p of projects) {
      if (!p.isDirectory()) continue;
      const pDir = path.join(projectsDir, p.name);
      try {
        const files = fs.readdirSync(pDir, { withFileTypes: true });
        for (const f of files) {
          if (!f.isFile() || !f.name.endsWith(".jsonl")) continue;
          const sessionId = f.name.replace(/\.jsonl$/, "");
          const meta: ConversationMeta = { sessionId, project: p.name, startedAt: "" };
          // Read just the first line for timestamp.
          try {
            const fPath = path.join(pDir, f.name);
            const fd = fs.openSync(fPath, "r");
            const buf = Buffer.alloc(FIRST_LINE_BUF); // source: measured: JSONL first-line timestamps fit in 512 bytes for all observed Cortex session files
            const read = fs.readSync(fd, buf, 0, FIRST_LINE_BUF, 0); // source: same — read exactly 512 bytes from offset 0
            fs.closeSync(fd);
            const line = buf.slice(0, read).toString("utf8").split("\n")[0] ?? "";
            const parsed = JSON.parse(line) as Record<string, unknown>;
            meta.startedAt = String(parsed["timestamp"] ?? parsed["created_at"] ?? "");
          } catch { /* best-effort */ }
          results.push(meta);
        }
      } catch { /* skip unreadable project dir */ }
    }
  } catch { /* projects dir absent */ }
  return results;
}

function getCachedConversations(): ConversationMeta[] {
  const now = Date.now();
  if (_cachedConversations === null || now - _cacheTs > CONVERSATIONS_CACHE_TTL_MS) {
    _cachedConversations = discoverConversations();
    _cacheTs = now;
  }
  return _cachedConversations;
}

// ── Transcript reader ─────────────────────────────────────────────────────────

interface Message {
  role: string;
  content: string;
  timestamp?: string;
}

/**
 * Read all JSONL lines from a session file and return formatted messages.
 *
 * source: cortex@ed33435 mcp_server/infrastructure/conversation_reader.py
 *   (read_full_conversation, format_conversation_messages)
 *
 * precondition:  sessionFilePath points to a readable .jsonl file.
 * postcondition: returns array of { role, content, timestamp }.
 * FAILS_ON: file not found — returns empty array.
 */
function readSessionMessages(sessionFilePath: string): Message[] {
  try {
    const content = fs.readFileSync(sessionFilePath, "utf8");
    const messages: Message[] = [];
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        const role = String(obj["role"] ?? obj["type"] ?? "unknown");
        const rawContent = obj["content"];
        const text =
          typeof rawContent === "string"
            ? rawContent
            : typeof rawContent === "object"
            ? JSON.stringify(rawContent)
            : String(rawContent ?? "");
        messages.push({ role, content: text.slice(0, MSG_CONTENT_CAP), timestamp: String(obj["timestamp"] ?? "") }); // source: cortex@ed33435 mcp_server/infrastructure/conversation_reader.py — 2000-char content cap per message for API safety
      } catch { /* skip malformed line */ }
    }
    return messages;
  } catch {
    return [];
  }
}

function findSessionFile(sessionId: string): string | null {
  const projectsDir = path.join(getClaudeDir(), "projects");
  try {
    const projects = fs.readdirSync(projectsDir, { withFileTypes: true });
    for (const p of projects) {
      if (!p.isDirectory()) continue;
      const candidate = path.join(projectsDir, p.name, `${sessionId}.jsonl`);
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch { /* best-effort */ }
  return null;
}

// ── Route registration ────────────────────────────────────────────────────────

/**
 * Register /api/discussions and /api/discussion/:id routes.
 *
 * precondition:  fastify instance is not yet started.
 * postcondition: two route families are registered.
 */
export async function registerDiscussionRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/discussions[?project=<name>&batch=<n>&batch_size=<n>]
   * source: cortex@ed33435 mcp_server/server/http_standalone_graph.py:1058-1090
   */
  fastify.get<{ Querystring: { project?: string; batch?: string; batch_size?: string } }>(
    "/api/discussions",
    async (req, reply) => {
      try {
        let conversations = getCachedConversations();
        const { project, batch: batchStr, batch_size: bsStr } = req.query;
        if (project) conversations = conversations.filter((c) => c.project === project);
        conversations = [...conversations].sort((a, b) => (b.startedAt > a.startedAt ? 1 : -1));
        const total = conversations.length;
        const batchSize = Math.max(1, parseInt(bsStr ?? String(DEFAULT_BATCH_SIZE), 10)); // source: cortex@ed33435 mcp_server/server/http_standalone_graph.py:129 — default batch_size=500
        const batch = parseInt(batchStr ?? "0", 10);
        const totalBatches = Math.max(1, Math.ceil(total / batchSize));
        const page = conversations.slice(batch * batchSize, (batch + 1) * batchSize);
        return reply.send({
          nodes: page,
          edges: [],
          meta: { total, batch, batch_size: batchSize, total_batches: totalBatches },
        });
      } catch (err) {
        return reply.status(HTTP_500).send({ error: err instanceof Error ? err.constructor.name : "UnknownError" }); // source: RFC 7231 §6.6 — 500 Internal Server Error; error class name only to avoid leaking internals (CWE-209)
      }
    },
  );

  /**
   * GET /api/discussion/:sessionId — single-session transcript.
   * source: cortex@ed33435 mcp_server/server/http_standalone_graph.py:1110-1139
   */
  fastify.get<{ Params: { sessionId: string } }>("/api/discussion/:sessionId", async (req, reply) => {
    try {
      const { sessionId } = req.params;
      const conversations = getCachedConversations();
      const conv = conversations.find((c) => c.sessionId === sessionId);
      if (!conv) return reply.status(HTTP_404).send({ error: "Discussion not found", sessionId }); // source: RFC 7231 §6.5.4 — 404 Not Found
      const filePath = findSessionFile(sessionId);
      if (!filePath) return reply.status(HTTP_404).send({ error: "Session file not found", sessionId }); // source: RFC 7231 §6.5.4 — 404 Not Found
      const messages = readSessionMessages(filePath);
      return reply.send({
        sessionId,
        project: conv.project,
        messages,
        startedAt: conv.startedAt,
        endedAt: conv.endedAt,
        duration: conv.duration,
        turnCount: conv.turnCount,
      });
    } catch (err) {
      return reply.status(HTTP_500).send({ error: err instanceof Error ? err.constructor.name : "UnknownError" }); // source: RFC 7231 §6.6 — 500 Internal Server Error; error class name only to avoid leaking internals (CWE-209)
    }
  });
}
