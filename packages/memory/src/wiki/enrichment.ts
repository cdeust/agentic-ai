/**
 * Memory & query enrichment pipeline.
 *
 * Two enrichment strategies (no external APIs):
 *   1. Doc2Query  — generate synthetic search queries at index time.
 *   2. Concept expansion — expand a query with related terms at retrieval time.
 *
 * Heuristics:
 *   - ConceptNet-style synonym/hypernym mappings (concept-vocabulary.ts)
 *   - COMET-style pattern templates ("X is used for ...", "X causes ...")
 *   - Doc2Query: extract question-answerable nouns, generate wh-questions
 *
 * Pure business logic — no I/O.
 *
 * source: mcp_server/core/enrichment.py
 */

import { CONCEPT_MAP, REVERSE_MAP } from "./concept-vocabulary.js";

// ── Doc2Query ─────────────────────────────────────────────────────────────

const QUESTION_TEMPLATES = [
  "What is {noun}?",
  "How does {noun} work?",
  "Why was {noun} changed?",
  "What caused the {noun}?",
  "How to fix {noun}?",
  "When was {noun} introduced?",
  "What does {noun} do?",
  "How to use {noun}?",
] as const;

const CODE_TOKEN_RE = /`([^`]+)`|(?:^|\s)([\w._]+(?:\.py|\.js|\.go|\.rs)?)\b/g;
const ERROR_NAME_RE = /\b(\w+(?:Error|Exception|Warning|Failure))\b/g;
const DECISION_RE = /(?:decided|chose|switched|selected|migrated)\s+(?:to\s+)?(\w+(?:\s+\w+){0,2})/gi;
const STOP = new Set(["that", "this", "with", "from", "they", "their", "have", "will", "been", "were"]);

function extractKeyNouns(content: string, maxNouns: number = 8): string[] {
  const candidates = new Map<string, number>();

  const codeRe = new RegExp(CODE_TOKEN_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = codeRe.exec(content)) !== null) {
    const token = (m[1] ?? m[2] ?? "").trim();
    if (token && token.length > 2) {
      candidates.set(token, (candidates.get(token) ?? 0) + 3);
    }
  }

  const errorRe = new RegExp(ERROR_NAME_RE.source, "g");
  while ((m = errorRe.exec(content)) !== null) {
    candidates.set(m[1]!, (candidates.get(m[1]!) ?? 0) + 2);
  }

  const decisionRe = new RegExp(DECISION_RE.source, "gi");
  while ((m = decisionRe.exec(content)) !== null) {
    const tok = m[1]!.trim();
    candidates.set(tok, (candidates.get(tok) ?? 0) + 2);
  }

  for (const w of content.split(/\s+/)) {
    const clean = w.replace(/[.,!?;:()[\]{}"'`-]/g, "").toLowerCase();
    if (clean.length > 4 && /^[a-z]+$/.test(clean)) {
      candidates.set(clean, (candidates.get(clean) ?? 0) + 1);
    }
  }

  const top = [...candidates.entries()]
    .filter(([n]) => !STOP.has(n.toLowerCase()))
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxNouns * 2)
    .map(([n]) => n);

  return top.slice(0, maxNouns);
}

/**
 * Generate synthetic search queries from document content.
 */
export function generateSyntheticQueries(content: string, maxQueries: number = 5): string[] {
  const nouns = extractKeyNouns(content, 6);
  if (!nouns.length) return [];
  const queries: string[] = [];
  for (const noun of nouns.slice(0, maxQueries)) {
    const template = QUESTION_TEMPLATES[queries.length % QUESTION_TEMPLATES.length]!;
    queries.push(template.replace("{noun}", noun));
  }
  return queries.slice(0, maxQueries);
}

/**
 * Append synthetic queries to content as search augmentation.
 */
export function buildEnrichedContent(content: string): string {
  const queries = generateSyntheticQueries(content);
  if (!queries.length) return content;
  return content + "\n\n<!-- doc2query -->\n" + queries.join("\n");
}

// ── Concept expansion ─────────────────────────────────────────────────────

/**
 * Expand a query with related terms from the concept vocabulary.
 */
export function expandQuery(query: string, maxExpansions: number = 5): string[] {
  const words = query.toLowerCase().split(/\s+/);
  const expansions = new Map<string, number>();

  for (const word of words) {
    const clean = word.replace(/[.,!?;:()[\]{}"'`]/g, "");
    const conceptTerms = CONCEPT_MAP[clean];
    if (conceptTerms) {
      for (const rel of conceptTerms) {
        expansions.set(rel, (expansions.get(rel) ?? 0) + 2);
      }
    }
    const reverseTerms = REVERSE_MAP[clean];
    if (reverseTerms) {
      for (const rel of reverseTerms) {
        expansions.set(rel, (expansions.get(rel) ?? 0) + 1);
      }
    }
  }

  const queryLower = query.toLowerCase();
  return [...expansions.entries()]
    .filter(([t]) => !queryLower.includes(t.toLowerCase()))
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxExpansions)
    .map(([t]) => t);
}

/**
 * Build an expanded query string with related terms appended.
 */
export function buildExpandedQuery(query: string): string {
  const expansions = expandQuery(query, 3);
  if (!expansions.length) return query;
  return query + " " + expansions.join(" ");
}

// ── COMET-style commonsense patterns ──────────────────────────────────────

const COMET_TEMPLATES = [
  ["{X} is used to {Y}", "purpose"],
  ["{X} causes {Y}", "causation"],
  ["{X} requires {Y}", "dependency"],
  ["{X} enables {Y}", "enablement"],
] as const;

/**
 * Generate COMET-style commonsense inference frames.
 */
export function generateCometFrames(subject: string, objectHint: string = ""): string[] {
  const obj = objectHint || "downstream systems";
  return COMET_TEMPLATES.map(([t]) =>
    t.replace("{X}", subject).replace("{Y}", obj),
  );
}
