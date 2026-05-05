/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * Domain-aware condensers per Cortex memory type.
 * source: Cortex mcp_server/core/context_assembly/condensers.py
 * source SHA: cortex@ed33435
 */

import { estimateTokens, truncateToBudget } from "./budget.js";

/** Keep first sentence + questions + last sentence, within budget.
 * source: Cortex condensers.py::condense_user_message (cortex@ed33435 line 33) */
export function condenseUserMessage(text: string, tokenBudget: number): string {
  if (estimateTokens(text) <= tokenBudget) return text;
  const sentences = _splitSentences(text);
  if (sentences.length <= 2) return truncateToBudget(text, tokenBudget);
  const kept: string[] = [sentences[0] ?? ""];
  for (const s of sentences.slice(1, -1)) { if (s.includes("?")) kept.push(s); }
  kept.push(sentences[sentences.length - 1] ?? "");
  const result = kept.join(" ").trim();
  if (estimateTokens(result) <= tokenBudget) return result;
  return truncateToBudget(result, tokenBudget);
}

/** Preserve code blocks verbatim, compress prose between them.
 * source: Cortex condensers.py::condense_assistant_message (cortex@ed33435 line 48) */
export function condenseAssistantMessage(text: string, tokenBudget: number): string {
  if (estimateTokens(text) <= tokenBudget) return text;
  const parts = _splitByCodeBlocks(text);
  const codeParts = parts.filter((p) => p.isCode).map((p) => p.chunk);
  const proseParts = parts.filter((p) => !p.isCode).map((p) => p.chunk);
  const codeTokens = codeParts.reduce((sum, p) => sum + estimateTokens(p), 0);
  if (codeTokens >= tokenBudget) {
    const kept: string[] = []; let used = 0;
    for (const p of codeParts) { const t = estimateTokens(p); if (used + t > tokenBudget) break; kept.push(p); used += t; }
    return kept.join("\n\n");
  }
  const proseBudget = tokenBudget - codeTokens;
  if (proseParts.length > 0 && proseBudget > 0) {
    const perProse = Math.max(20, Math.floor(proseBudget / proseParts.length));
    const compressedProse = proseParts.map((p) => _firstSentence(p).slice(0, perProse * 3));
    const out: string[] = []; let pi = 0, ci = 0;
    for (const { isCode } of parts) {
      if (isCode) { if (ci < codeParts.length) out.push(codeParts[ci++] ?? ""); }
      else { if (pi < compressedProse.length) out.push(compressedProse[pi++] ?? ""); }
    }
    return out.filter((s) => s.trim()).join("\n\n");
  }
  return codeParts.join("\n\n");
}

// source: cortex@ed33435 condensers.py — arrow-style triple RE; → = right arrow (→)
const TRIPLE_RE = /^\s*([^→\->:]+?)\s*(?:→|->|:)\s*([^→\->:]+?)\s*(?:→|->|:)\s*(.+?)\s*$/u;

/** Keep only lines matching triple patterns.
 * source: Cortex condensers.py::condense_entity_triples (cortex@ed33435 line 80) */
export function condenseEntityTriples(text: string, tokenBudget: number): string {
  if (estimateTokens(text) <= tokenBudget) return text;
  const keptLines: string[] = []; let used = 0;
  for (const line of text.split("\n")) {
    if (TRIPLE_RE.test(line)) { const t = estimateTokens(line); if (used + t > tokenBudget) break; keptLines.push(line); used += t; }
  }
  if (keptLines.length > 0) return keptLines.join("\n");
  return truncateToBudget(text, tokenBudget);
}

const DATE_RE = /\[Date:\s*([^\]]+)\]|(\d{4}-\d{2}-\d{2})|(\w+\s+\d{1,2},?\s+\d{4})/i;

/** Extract when/what/who into a fixed-slot format within budget.
 * source: Cortex condensers.py::condense_timeline_event (cortex@ed33435 line 100) */
export function condenseTimelineEvent(text: string, tokenBudget: number): string {
  if (estimateTokens(text) <= tokenBudget) return text;
  const m = DATE_RE.exec(text);
  const date = m ? (m[1] ?? m[2] ?? m[3] ?? "") : "";
  const first = _firstSentence(text);
  const compressed = date ? `[${date}] ${first}` : first;
  if (estimateTokens(compressed) <= tokenBudget) return compressed;
  return truncateToBudget(compressed, tokenBudget);
}

const SIGNATURE_PREFIXES = ["import ","from ","class ","def ","async def ","struct ","enum ","protocol ","func ","interface ","@","//","#"] as const;

/** Keep imports, class, function, and method signatures only.
 * source: Cortex condensers.py::condense_code_block (cortex@ed33435 line 118) */
export function condenseCodeBlock(text: string, tokenBudget: number): string {
  if (estimateTokens(text) <= tokenBudget) return text;
  const kept: string[] = []; let used = 0;
  for (const line of text.split("\n")) {
    const stripped = line.trim(); if (!stripped) continue;
    if (SIGNATURE_PREFIXES.some((p) => stripped.startsWith(p))) { const t = estimateTokens(line); if (used + t > tokenBudget) break; kept.push(line); used += t; }
  }
  if (kept.length > 0) return kept.join("\n");
  return truncateToBudget(text, tokenBudget);
}

/** Auto-dispatch to the right condenser based on content shape.
 * source: Cortex condensers.py::condense_memory_content (cortex@ed33435 line 143) */
export function condenseMemoryContent(content: string, tokenBudget: number, tags: string[] = []): string {
  if (estimateTokens(content) <= tokenBudget) return content;
  if (tags.includes("code") || tags.includes("file")) return condenseCodeBlock(content, tokenBudget);
  if (tags.includes("timeline") || tags.includes("event")) return condenseTimelineEvent(content, tokenBudget);
  if (_hasCodeBlocks(content)) return condenseAssistantMessage(content, tokenBudget);
  const arrowCount = (content.match(/→/g) ?? []).length + (content.match(/->/g) ?? []).length;
  if (arrowCount >= 2) return condenseEntityTriples(content, tokenBudget);
  const trimmed = content.trimStart();
  if (trimmed.startsWith("[user]:") || trimmed.startsWith("[assistant]:")) {
    if (content.includes("[assistant]:")) return condenseAssistantMessage(content, tokenBudget);
    return condenseUserMessage(content, tokenBudget);
  }
  return condenseUserMessage(content, tokenBudget);
}

function _splitSentences(text: string): string[] { return text.trim().split(/(?<=[.!?])\s+/).filter((p) => p.length > 0); }
function _firstSentence(text: string): string { const s = _splitSentences(text); return s.length > 0 ? (s[0] ?? text) : text; }
function _hasCodeBlocks(text: string): boolean { return text.includes("```") || (text.match(/    /g) ?? []).length >= 3; }
interface TextPart { isCode: boolean; chunk: string; }
function _splitByCodeBlocks(text: string): TextPart[] {
  const segments: TextPart[] = []; let inCode = false; const buf: string[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().startsWith("```")) {
      if (buf.length > 0) { segments.push({ isCode: inCode, chunk: buf.join("\n") }); buf.length = 0; }
      inCode = !inCode; buf.push(line);
    } else { buf.push(line); }
  }
  if (buf.length > 0) segments.push({ isCode: inCode, chunk: buf.join("\n") });
  return segments;
}
