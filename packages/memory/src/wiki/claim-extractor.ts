/**
 * Phase 2.1 — Claim extraction from raw memory content.
 *
 * Deterministic, pattern-based extractor that turns a memory's content
 * into a list of typed ClaimEvents (Hopper IR layer 1).
 *
 * Pure logic — no I/O, no LLM calls. The LLM-augmented refinement step
 * lives in a separate handler that wraps this with prompt-driven
 * enrichment when needed.
 *
 * The extractor splits content into candidate sentences, classifies each
 * by pattern matching against eight ClaimType buckets, and pulls out
 * evidence references (file paths, URLs, citations, commit SHAs).
 *
 * Sentences that match no pattern are dropped — silent rejection is the
 * default, mirroring the wiki classifier's positive-signal philosophy.
 *
 * source: mcp_server/core/claim_extractor.py
 */

import type { ClaimEvent, ClaimType, EvidenceRef } from "./types.js";

// ── Sentence splitter ─────────────────────────────────────────────────────

const FENCE_RE = /```[\s\S]*?```/gm;
const SENTENCE_END = /(?<=[.!?])\s+(?=[A-Z\[(\#\*\d])/g;

function stripCodeFences(text: string): string {
  return text.replace(FENCE_RE, "");
}

function splitSentences(content: string): string[] {
  const cleaned = stripCodeFences(content);
  const paragraphs = cleaned.split(/\n\s*\n/);
  const sentences: string[] = [];

  for (const rawPara of paragraphs) {
    const para = rawPara.trim();
    if (!para) continue;

    if (
      para.startsWith("#") ||
      /^\s*[-*+]\s/.test(para) ||
      /^\s*\d+[.)]\s/.test(para) ||
      para.length < 120
    ) {
      sentences.push(para.replace(/^#+/, "").replace(/^[-*+\s]+/, "").trim());
      continue;
    }

    for (const s of para.split(SENTENCE_END)) {
      const trimmed = s.trim();
      if (trimmed) sentences.push(trimmed);
    }
  }

  return sentences.filter((s) => s.length >= 12 && s.length <= 1500);
}

// ── Claim-type pattern matchers ───────────────────────────────────────────

type PatternEntry = readonly [RegExp, ClaimType, number];

const CLAIM_PATTERNS: readonly PatternEntry[] = [
  [
    /\b(decided to|decision[: ]|the decision is|chose .+ because|chose .+ over|will use|we will|adopted|rejected .+ (because|due to)|selected .+ over|switched (to|from))\b/i,
    "decision",
    0.85,
  ],
  [
    /\b(uses?|implemented (via|using|with|by)|driven by|built (on|with)|relies on|backed by|powered by|leverages|invokes|computes via|approach[: ]|method[: ])\b/i,
    "method",
    0.7,
  ],
  [
    /\b(achieved|achieves|measured|benchmark(?:ed|s)?|score(?:d|s)?|got|reached|improved (to|by|from)|regressed (to|by|from)|recall|MRR|R@\d+|nDCG|F1|accuracy|latency|throughput|p\d{2})\b|\b\d+(?:\.\d+)?\s*%|\b0\.\d+\b/i,
    "result",
    0.75,
  ],
  [
    /\b(does not (handle|support|work)|doesn[''']t (handle|support|work)|fails (when|on|if)|broke (when|on|if)|breaks (when|on|if)|limitation\b|known issue|cannot|can[''']t|unable to|edge case|caveat\b|TODO|FIXME|XXX)/i,
    "limitation",
    0.8,
  ],
  [
    /\b(noticed that|noticed|found that|discovered|observed|surprising(?:ly)?|turns out|it appears|it seems|interesting(?:ly)?|the (issue|problem|bug) (was|is))\b/i,
    "observation",
    0.65,
  ],
  [/\?\s*$/, "question", 0.6],
  [/^\s*(https?:\/\/|doi:|arxiv:|@?\w+\d{4}|\[.+\]\(https?:\/\/)/i, "reference", 0.9],
] as const;

function classifySentence(sentence: string): [ClaimType, number] | null {
  for (const [pat, claimType, conf] of CLAIM_PATTERNS) {
    if (pat.test(sentence)) return [claimType, conf];
  }
  return null;
}

// ── Evidence reference extraction ────────────────────────────────────────

const URL_RE = /https?:\/\/[^\s)\]]+/g;
const DOI_RE = /\bdoi:\s*([^\s,]+)/gi;
const ARXIV_RE = /\barxiv:\s*([\w./-]+)/gi;
const PAPER_RE = /\b([A-Z][a-z]+(?:\s+(?:et al\.?|&)\s+[A-Z][a-z]+)?)\s+(\d{4})\b/g;
const FILE_RE = /\b([\w./-]+\.(?:py|js|ts|md|json|yaml|yml|sql|go|rs|rb|java|cpp|c|h|hpp|sh|toml))\b/g;
const SHA_RE = /\b([0-9a-f]{7,40})\b/g;
const BENCH_RE = /\b(LongMemEval|LoCoMo|BEAM|MemoryAgentBench|EverMemBench)\b/gi;

function extractEvidence(content: string): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  const seen = new Set<string>();

  function add(kind: EvidenceRef["kind"], target: string, context?: string | null): void {
    const cleaned = target.trim().replace(/[.,;:]$/, "");
    const key = `${kind}:${cleaned}`;
    if (!cleaned || seen.has(key)) return;
    seen.add(key);
    refs.push({ kind, target: cleaned, context: context ?? null });
  }

  let m: RegExpExecArray | null;
  const urlRe = new RegExp(URL_RE.source, "g");
  while ((m = urlRe.exec(content)) !== null) add("url", m[0]!);

  const doiRe = new RegExp(DOI_RE.source, "gi");
  while ((m = doiRe.exec(content)) !== null) add("paper", "doi:" + m[1]);

  const arxivRe = new RegExp(ARXIV_RE.source, "gi");
  while ((m = arxivRe.exec(content)) !== null) add("paper", "arxiv:" + m[1]);

  const paperRe = new RegExp(PAPER_RE.source, "g");
  while ((m = paperRe.exec(content)) !== null) add("paper", `${m[1]} ${m[2]}`);

  const fileRe = new RegExp(FILE_RE.source, "g");
  while ((m = fileRe.exec(content)) !== null) add("file", m[1]!);

  const shaRe = new RegExp(SHA_RE.source, "g");
  while ((m = shaRe.exec(content)) !== null) add("commit", m[1]!);

  const benchRe = new RegExp(BENCH_RE.source, "gi");
  while ((m = benchRe.exec(content)) !== null) add("benchmark", m[1]!);

  return refs;
}

// ── Public types ──────────────────────────────────────────────────────────

export interface ExtractionStats {
  readonly sentences_total: number;
  readonly sentences_classified: number;
  readonly sentences_dropped: number;
  readonly evidence_refs_total: number;
}

export interface ExtractClaimsArgs {
  readonly memory_id?: number | null;
  readonly session_id?: string;
  readonly entity_ids?: readonly number[];
}

/**
 * Extract typed ClaimEvents from raw memory content.
 *
 * Process:
 *   1. Strip fenced code blocks.
 *   2. Split into candidate sentences.
 *   3. Classify each sentence by pattern; drop unclassified.
 *   4. Pull document-level evidence refs.
 *   5. Attach evidence refs to every claim from this content.
 *
 * Returns [claims, stats]. Never raises on bad input.
 */
export function extractClaims(
  content: string,
  args: ExtractClaimsArgs = {},
): [ClaimEvent[], ExtractionStats] {
  if (!content || !content.trim()) {
    return [[], { sentences_total: 0, sentences_classified: 0, sentences_dropped: 0, evidence_refs_total: 0 }];
  }

  const sentences = splitSentences(content);
  const evidence = extractEvidence(content);
  const claims: ClaimEvent[] = [];

  for (const sent of sentences) {
    const cls = classifySentence(sent);
    if (cls === null) continue;
    let [claimType, confidence] = cls;

    const sentRefs = extractEvidence(sent);
    if (sentRefs.length > 0) {
      confidence = Math.min(1.0, confidence + 0.1);
    }
    const refs = sentRefs.length > 0 ? sentRefs : evidence;

    claims.push({
      memory_id: args.memory_id ?? null,
      session_id: args.session_id ?? "",
      text: sent.slice(0, 1900),
      claim_type: claimType,
      entity_ids: [...(args.entity_ids ?? [])],
      evidence_refs: refs,
      confidence,
    });
  }

  return [
    claims,
    {
      sentences_total: sentences.length,
      sentences_classified: claims.length,
      sentences_dropped: sentences.length - claims.length,
      evidence_refs_total: evidence.length,
    },
  ];
}
