/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * Text scoring signals: BM25, n-gram phrase matching, keyword overlap.
 *
 * Port of: cortex@ed33435 mcp_server/core/scoring.py
 *
 * BM25 parameters match ai-architect's PostgreSQL ts_rank (k1=1.5, b=0.75).
 * N-gram weights match ai-architect config (trigram=0.4, bigram=0.35, content=0.25).
 *
 * Pure business logic -- no I/O.
 */

// ── Stopwords ─────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/scoring.py:14-52

const _STOPWORDS = new Set<string>([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "to",
  "of",
  "and",
  "or",
  "in",
  "on",
  "at",
  "for",
  "with",
  "by",
  "from",
  "it",
  "this",
  "that",
  "do",
  "did",
  "does",
  "what",
  "when",
  "where",
  "why",
  "how",
  "who",
  "which",
  "can",
  "could",
  "would",
  "should",
  "will",
  "about",
  "tell",
  "me",
  "my",
  "i",
  "you",
  "your",
  "we",
]);

// ── Tokenizers ────────────────────────────────────────────────────────────

/**
 * Whitespace + punctuation tokenizer with stopword filtering.
 * Port of: cortex@ed33435 mcp_server/core/scoring.py:55-57
 */
export function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/\w+/g) ?? [];
  return words.filter((w) => !_STOPWORDS.has(w));
}

/**
 * Tokenizer without stopword filtering (for BM25 term frequency).
 * Port of: cortex@ed33435 mcp_server/core/scoring.py:60-62
 */
export function tokenizeRaw(text: string): string[] {
  return text.toLowerCase().match(/\w+/g) ?? [];
}

// ── BM25 internals ────────────────────────────────────────────────────────

interface Bm25Stats {
  docTokens: string[][];
  docLengths: number[];
  avgDl: number;
  df: Map<string, number>;
  n: number;
}

/**
 * Pre-compute BM25 corpus statistics.
 * Port of: cortex@ed33435 mcp_server/core/scoring.py:65-76
 */
function buildBm25Stats(documents: string[]): Bm25Stats {
  const docTokens = documents.map((d) => tokenizeRaw(d));
  const docLengths = docTokens.map((t) => t.length);
  const avgDl =
    docLengths.length > 0
      ? docLengths.reduce((a, b) => a + b, 0) / docLengths.length
      : 1.0;
  const df = new Map<string, number>();
  for (const tokens of docTokens) {
    for (const term of new Set(tokens)) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  return { docTokens, docLengths, avgDl, df, n: documents.length };
}

/**
 * Score a single document against query terms.
 * Port of: cortex@ed33435 mcp_server/core/scoring.py:79-91
 *
 * precondition: qTerms is non-empty; tokens, dl, avgDl, df are from the
 *   same corpus; n >= 1; k1 > 0; 0 <= b <= 1
 * postcondition: returns a non-negative float; 0 when no query terms match
 */
function bm25DocScore(
  qTerms: string[],
  tokens: string[],
  dl: number,
  avgDl: number,
  df: Map<string, number>,
  n: number,
  k1: float,
  b: float,
): number {
  const tfMap = new Map<string, number>();
  for (const t of tokens) {
    tfMap.set(t, (tfMap.get(t) ?? 0) + 1);
  }
  let score = 0.0;
  for (const term of qTerms) {
    const tf = tfMap.get(term);
    if (tf === undefined) continue;
    const dfTerm = df.get(term) ?? 0;
    const idf = Math.log((n - dfTerm + 0.5) / (dfTerm + 0.5) + 1.0);
    score += (idf * (tf * (k1 + 1))) / (tf + k1 * (1 - b + (b * dl) / avgDl));
  }
  return score;
}

// TypeScript does not have Python's type alias syntax; use number directly.
type float = number;

/**
 * BM25 scores normalized to [0, 1]. Okapi BM25 with IDF smoothing.
 *
 * Port of: cortex@ed33435 mcp_server/core/scoring.py:94-106
 *
 * precondition: documents is a non-empty list of strings
 * postcondition: returns list of same length as documents; each value in [0,1]
 *
 * Constants — source: cortex@ed33435 mcp_server/core/scoring.py:94
 *   k1 = 1.5 (matches ai-architect PostgreSQL ts_rank)
 *   b  = 0.75 (matches ai-architect PostgreSQL ts_rank)
 */
export function computeBm25Scores(
  query: string,
  documents: string[],
  k1 = 1.5, // source: cortex@ed33435 mcp_server/core/scoring.py:95 — matches pg ts_rank
  b = 0.75, // source: cortex@ed33435 mcp_server/core/scoring.py:96 — matches pg ts_rank
): number[] {
  const qTerms = tokenizeRaw(query);
  if (qTerms.length === 0 || documents.length === 0) {
    return Array(documents.length).fill(0.0);
  }
  const { docTokens, docLengths, avgDl, df, n } = buildBm25Stats(documents);
  const scores = docTokens.map((tokens, i) =>
    bm25DocScore(qTerms, tokens, docLengths[i] ?? 0, avgDl, df, n, k1, b),
  );
  const mx = scores.length > 0 ? Math.max(...scores) : 1.0;
  return scores.map((s) => (mx > 0 ? s / mx : 0.0));
}

// ── N-gram helpers ────────────────────────────────────────────────────────

/**
 * Extract character n-grams from token sequence.
 * Port of: cortex@ed33435 mcp_server/core/scoring.py:109-113
 */
function extractNgrams(tokens: string[], n: number): Set<string> {
  if (tokens.length < n) return new Set();
  const out = new Set<string>();
  for (let i = 0; i <= tokens.length - n; i++) {
    out.add(tokens.slice(i, i + n).join("\x00"));
  }
  return out;
}

// ── Public signal functions ───────────────────────────────────────────────

/**
 * Simple keyword overlap ratio.
 * Port of: cortex@ed33435 mcp_server/core/scoring.py:116-120
 *
 * postcondition: result in [0, 1]; 0 when query is empty
 */
export function computeKeywordOverlap(query: string, document: string): number {
  const qTerms = new Set(tokenizeRaw(query));
  const dTerms = new Set(tokenizeRaw(document));
  if (qTerms.size === 0) return 0.0;
  let overlap = 0;
  for (const t of qTerms) {
    if (dTerms.has(t)) overlap++;
  }
  return overlap / qTerms.size;
}

/**
 * Combined trigram + bigram + content-word overlap score.
 *
 * Port of: cortex@ed33435 mcp_server/core/scoring.py:123-141
 *
 * precondition: query and document are strings (may be empty)
 * postcondition: result in [0, 1]; 0 when either tokenizes to empty
 *
 * Constants — source: cortex@ed33435 mcp_server/core/scoring.py:128
 *   trigram weight = 0.4   (matches ai-architect config)
 *   bigram  weight = 0.35  (matches ai-architect config)
 *   content weight = 0.25  (matches ai-architect config)
 */
export function computeNgramScore(query: string, document: string): number {
  const qTok = tokenizeRaw(query);
  const dTok = tokenizeRaw(document);
  if (qTok.length === 0 || dTok.length === 0) return 0.0;

  const qTri = extractNgrams(qTok, 3);
  const dTri = extractNgrams(dTok, 3);
  let triIntersect = 0;
  for (const g of qTri) {
    if (dTri.has(g)) triIntersect++;
  }
  const tri = qTri.size > 0 ? triIntersect / Math.max(qTri.size, 1) : 0.0;

  const qBi = extractNgrams(qTok, 2);
  const dBi = extractNgrams(dTok, 2);
  let biIntersect = 0;
  for (const g of qBi) {
    if (dBi.has(g)) biIntersect++;
  }
  const bi = qBi.size > 0 ? biIntersect / Math.max(qBi.size, 1) : 0.0;

  const qCw = new Set(qTok.filter((t) => !_STOPWORDS.has(t) && t.length > 2));
  const dCw = new Set(dTok.filter((t) => !_STOPWORDS.has(t)));
  let cwIntersect = 0;
  for (const t of qCw) {
    if (dCw.has(t)) cwIntersect++;
  }
  const cw = qCw.size > 0 ? cwIntersect / Math.max(qCw.size, 1) : 0.0;

  // source: cortex@ed33435 mcp_server/core/scoring.py:138-141
  return 0.4 * tri + 0.35 * bi + 0.25 * cw;
}
