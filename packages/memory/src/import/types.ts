/**
 * Types for the import subsystem.
 *
 * Port of: mcp_server/handlers/import_sessions.py (schema block)
 *          mcp_server/core/session_extractor.py (item shapes)
 *
 * The import subsystem decodes one external format (Claude Code JSONL) into
 * Cortex's canonical MemoryItem shape and routes each item through the
 * remember write gate.
 *
 * source: mcp_server/handlers/import_sessions.py — schema + handler
 */

import { z } from "zod";

// ── Import request ─────────────────────────────────────────────────────────
// source: mcp_server/handlers/import_sessions.py inputSchema

export const ImportRequestSchema = z.object({
  project: z.string().optional().default(""),
  domain: z.string().optional().default(""),
  min_importance: z.number().min(0).max(1).default(0.4),
  max_sessions: z.number().int().min(0).default(0),
  dry_run: z.boolean().default(false),
});

export type ImportRequest = z.infer<typeof ImportRequestSchema>;

// ── Import response ────────────────────────────────────────────────────────
// source: mcp_server/handlers/import_sessions.py _build_result()

export const PreviewItemSchema = z.object({
  content: z.string(),
  tags: z.array(z.string()),
  importance: z.number(),
  project: z.string(),
  domain: z.string(),
});

export type PreviewItem = z.infer<typeof PreviewItemSchema>;

export const ImportResponseSchema = z.object({
  imported: z.number().int().min(0),
  gated: z.number().int().min(0),
  skipped: z.number().int().min(0),
  sessions_scanned: z.number().int().min(0),
  total_files: z.number().int().min(0),
  dry_run: z.boolean(),
  preview: z.array(PreviewItemSchema).optional(),
  preview_truncated: z.boolean().optional(),
  errors: z.array(z.string()).optional(),
  error: z.string().optional(),
});

export type ImportResponse = z.infer<typeof ImportResponseSchema>;

// ── Extracted session item ─────────────────────────────────────────────────
// source: mcp_server/core/session_extractor.py extract_memorable_items()

export interface ExtractedItem {
  content: string;
  tags: string[];
  importance: number;
  timestamp: string;
  session_id: string;
}

// ── Session summary ────────────────────────────────────────────────────────
// source: mcp_server/core/session_extractor.py extract_session_summary()

export interface SessionSummary {
  session_id: string;
  cwd: string;
  first_message: string;
  user_count: number;
  tools_used: string[];
  start_time: string;
  end_time: string;
}

// ── JSONL record shape ─────────────────────────────────────────────────────
// source: Claude Code session JSONL format (empirically observed)

export interface JsonlRecord {
  type?: string;
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  isMeta?: boolean;
  toolUseResult?: unknown;
  message?: {
    content?: string | MessageBlock[];
  };
}

export interface MessageBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
}

// ── Store write interface ──────────────────────────────────────────────────
// Minimal interface for the remember write gate dependency.
// Full implementation lives in port/cortex-remember (#2).

export interface RememberArgs {
  content: string;
  tags: string[];
  domain: string;
  source: string;
  force: boolean;
  created_at?: string;
  initial_heat?: number;
}

export interface RememberResult {
  stored: boolean;
}

export type RememberHandler = (
  args: RememberArgs,
) => Promise<RememberResult | null>;
