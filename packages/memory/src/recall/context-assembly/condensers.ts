/* eslint-disable @typescript-eslint/no-magic-numbers -- source: exact port of Python source; all numeric literals copied verbatim from cited Python file */
/**
 * Domain-aware condensers per Cortex memory type.
 *
 * Each condenser reduces a piece of content to fit a token budget, using
 * domain knowledge of what matters for that content type. Generic
 * truncation loses the most important information first (it keeps the
 * first N tokens regardless of significance); domain-aware condensers
 * preserve high-signal content and drop filler.
 *
 * Adapted from Clément Deust's Swift condensers in ContextDecomposer.swift
 * (condenseContracts, condenseEngineGraph, condenseFileTree,
 * condenseImpactReport), plus Cortex-specific memory types.
 *
 * source: Cortex mcp_server/core/context_assembly/condensers.py
 */

import { estimateTokens, truncateToBudget } from "./budget.js";

// ── User message condenser ──────────────────────────────────────────────
// Strategy: keep the first sentence (establishes intent), any questions
// (explicit interrogatives), and the last sentence (final state of
// thought), dropping middle filler.

/** Keep first sentence + questions + last sentence, within budget. */
export function condenseUserMessage(text: string, tokenBudget: number): string {
  if (estimateTokens(text) <= tokenBudget) return text;
  const sentences = splitSentences(text);
  if (sentences.length <= 2) return truncateToBudget(text, tokenBudget);

  const firstSent = sentences[0] ?? "";
  const lastSent = sentences[sentences.length - 1] ?? "";
  const kept: string[] = [firstSent];
  for (const s of sentences.slice(1, -1)) {
    if (s.includes("?")) kept.push(s);
  }
  kept.push(lastSent);
  const result = kept.join(" ").trim();
  if (estimateTokens(result) <= tokenBudget) return result;
  return truncateToBudget(result, tokenBudget);
}

// ── Assistant message condenser ─────────────────────────────────────────
// Strategy: keep code blocks verbatim (they're high-density facts that
// don't survive summarization), summarize prose by keeping topic
// sentences.

/** Preserve code blocks verbatim, compress prose between them. */
export function condenseAssistantMessage(text: string, tokenBudget: number): string {
  if (estimateTokens(text) <= tokenBudget) return text;

  const parts = splitByCodeBlocks(text);
  const codeParts = parts.filter(([isCode]) => isCode).map(([, p]) => p);
  const proseParts = parts.filter(([isCode]) => !isCode).map(([, p]) => p);

  const codeTokens = codeParts.reduce((sum, p) => sum + estimateTokens(p), 0);
  if (codeTokens >= tokenBudget) {
    // Even the code exceeds budget — keep first N code blocks
    const kept: string[] = [];
    let used = 0;
    for (const p of codeParts) {
      const t = estimateTokens(p);
      if (used + t > tokenBudget) break;
      kept.push(p);
      used += t;
    }
    return kept.join("\n\n");
  }

  const proseBudget = tokenBudget - codeTokens;
  if (proseParts.length > 0 && proseBudget > 0) {
    const perProse = Math.max(20, Math.floor(proseBudget / proseParts.length));
    const compressedProse = proseParts.map((p) => firstSentence(p).slice(0, perProse * 3));
    // Reassemble in original order
    const out: string[] = [];
    let pi = 0;
    let ci = 0;
    for (const [isCode] of parts) {
      if (isCode) {
        if (ci < codeParts.length) {
          const chunk = codeParts[ci];
          if (chunk !== undefined) out.push(chunk);
          ci++;
        }
      } else {
        if (pi < compressedProse.length) {
          const chunk = compressedProse[pi];
          if (chunk !== undefined) out.push(chunk);
          pi++;
        }
      }
    }
    return out.filter((s) => s.trim()).join("\n\n");
  }
  // No prose budget — just concatenate code
  return codeParts.join("\n\n");
}

// ── Entity-triple condenser ─────────────────────────────────────────────
// Strategy: keep (subject, predicate, object) triples verbatim, drop
// anything else. Triples are already maximally compressed.

/** Keep only lines matching triple patterns, in budget order. */
export function condenseEntityTriples(text: string, tokenBudget: number): string {
  if (estimateTokens(text) <= tokenBudget) return text;
  const tripleRe = /^\s*([^→\->:]+?)\s*(?:→|->|:)\s*([^→\->:]+?)\s*(?:→|->|:)\s*(.+?)\s*$/;
  const keptLines: string[] = [];
  let used = 0;
  for (const line of text.split("\n")) {
    if (tripleRe.test(line)) {
      const t = estimateTokens(line);
      if (used + t > tokenBudget) break;
      keptLines.push(line);
      used += t;
    }
  }
  if (keptLines.length > 0) return keptLines.join("\n");
  return truncateToBudget(text, tokenBudget);
}

// ── Timeline-event condenser ────────────────────────────────────────────
// Strategy: extract (when, what, who) slots. Fixed schema compresses
// better than free-text summaries. Tse 2007 schema-congruent consolidation.

/** Extract when/what/who into a fixed-slot format within budget. */
export function condenseTimelineEvent(text: string, tokenBudget: number): string {
  if (estimateTokens(text) <= tokenBudget) return text;

  const dateMatch = text.match(
    /\[Date:\s*([^\]]+)\]|(\d{4}-\d{2}-\d{2})|(\w+\s+\d{1,2},?\s+\d{4})/,
  );
  const date = dateMatch
    ? (dateMatch[1] ?? dateMatch[2] ?? dateMatch[3] ?? "")
    : "";

  const first = firstSentence(text);
  const compressed = date ? `[${date}] ${first}` : first;
  if (estimateTokens(compressed) <= tokenBudget) return compressed;
  return truncateToBudget(compressed, tokenBudget);
}

// ── Code block condenser ────────────────────────────────────────────────
// Strategy: signatures only (function/class/imports), same spirit as the
// Swift condenseContracts.

/** Keep imports, class, function, protocol, and method signatures only. */
export function condenseCodeBlock(text: string, tokenBudget: number): string {
  if (estimateTokens(text) <= tokenBudget) return text;

  const signaturePrefixes = [
    "import ",
    "from ",
    "class ",
    "def ",
    "async def ",
    "struct ",
    "enum ",
    "protocol ",
    "func ",
    "interface ",
    "@",    // decorators
    "//",   // comments
    "#",    // comments
  ];

  const kept: string[] = [];
  let used = 0;
  for (const line of text.split("\n")) {
    const stripped = line.trim();
    if (!stripped) continue;
    if (signaturePrefixes.some((p) => stripped.startsWith(p))) {
      const t = estimateTokens(line);
      if (used + t > tokenBudget) break;
      kept.push(line);
      used += t;
    }
  }
  if (kept.length > 0) return kept.join("\n");
  return truncateToBudget(text, tokenBudget);
}

// ── Generic memory condenser ────────────────────────────────────────────
// Strategy: dispatch by content shape. When unsure, truncate.

/**
 * Auto-dispatch to the right condenser based on content shape.
 *
 * @param content - the memory's textual content.
 * @param tokenBudget - target token count for the output.
 * @param tags - optional tag hints (e.g. ["code", "decision"]) to bias
 *   dispatch. When provided, takes precedence over heuristic.
 */
export function condenseMemoryContent(
  content: string,
  tokenBudget: number,
  tags: string[] = [],
): string {
  if (estimateTokens(content) <= tokenBudget) return content;

  // Tag-driven dispatch first
  if (tags.includes("code") || tags.includes("file")) {
    return condenseCodeBlock(content, tokenBudget);
  }
  if (tags.includes("timeline") || tags.includes("event")) {
    return condenseTimelineEvent(content, tokenBudget);
  }

  // Heuristic dispatch by content shape
  if (hasCodeBlocks(content)) {
    return condenseAssistantMessage(content, tokenBudget);
  }
  const arrowCount = (content.match(/→/g) ?? []).length + (content.match(/->/g) ?? []).length;
  if (arrowCount >= 2) {
    return condenseEntityTriples(content, tokenBudget);
  }
  const stripped = content.trimStart();
  if (stripped.startsWith("[user]:") || stripped.startsWith("[assistant]:")) {
    if (content.includes("[assistant]:")) {
      return condenseAssistantMessage(content, tokenBudget);
    }
    return condenseUserMessage(content, tokenBudget);
  }

  // Default: treat as prose user message
  return condenseUserMessage(content, tokenBudget);
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Naive sentence splitter; good enough for condensers. */
function splitSentences(text: string): string[] {
  const parts = text.trim().split(/(?<=[.!?])\s+/);
  return parts.filter((p) => p);
}

function firstSentence(text: string): string {
  const sents = splitSentences(text);
  return sents.length > 0 ? (sents[0] ?? text) : text;
}

function hasCodeBlocks(text: string): boolean {
  return text.includes("```") || (text.match(/    /g) ?? []).length >= 3;
}

/** Split markdown-style text into [isCode, chunk] segments. */
function splitByCodeBlocks(text: string): Array<[boolean, string]> {
  const segments: Array<[boolean, string]> = [];
  let inCode = false;
  let buf: string[] = [];

  for (const line of text.split("\n")) {
    if (line.trim().startsWith("```")) {
      if (buf.length > 0) {
        segments.push([inCode, buf.join("\n")]);
        buf = [];
      }
      inCode = !inCode;
      buf.push(line);
    } else {
      buf.push(line);
    }
  }
  if (buf.length > 0) {
    segments.push([inCode, buf.join("\n")]);
  }
  return segments;
}
