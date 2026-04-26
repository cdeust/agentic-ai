/**
 * Okapi BM25 text scoring with IDF smoothing.
 *
 * Port of: mcp_server/core/scoring.py
 *
 * BM25 parameters match ai-architect's PostgreSQL ts_rank (k1=1.5, b=0.75).
 *
 * Pure business logic — no I/O. All inputs are plain strings / arrays.
 */

// ── Stop-words ────────────────────────────────────────────────────────────
// Port of: mcp_server/core/scoring.py _STOPWORDS

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "to", "of",
  "and", "or", "in", "on", "at", "for", "with", "by", "from", "it",
  "this", "that", "do", "did", "does", "what", "when", "where", "why",
  "how", "who", "which", "can", "could", "would", "should", "will",
  "about", "tell", "me", "my", "i", "you", "your", "we",
]);

// ── Tokenizers ────────────────────────────────────────────────────────────

/**
 * Tokenize text into lowercase word tokens with stopword filtering.
 * Port of: mcp_server/core/scoring.py::tokenize
 */
export function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/\w+/g) ?? [];
  return words.filter((w) => !STOPWORDS.has(w));
}

/**
 * Tokenize text into lowercase word tokens WITHOUT stopword filtering.
 * Used for BM25 term-frequency counting.
 * Port of: mcp_server/core/scoring.py::tokenize_raw
 */
export function tokenizeRaw(text: string): string[] {
  return text.toLowerCase().match(/\w+/g) ?? [];
}

// ── BM25 corpus statistics ─────────────────────────────────────────────────

interface Bm25Stats {
  docTokens: string[][];
  docLengths: number[];
  avgDl: number;
  df: Map<string, number>;
  n: number;
}

/**
 * Pre-compute BM25 corpus statistics for a list of documents.
 * Port of: mcp_server/core/scoring.py::_build_bm25_stats
 */
function buildBm25Stats(documents: string[]): Bm25Stats {
  const docTokens = documents.map(tokenizeRaw);
  const docLengths = docTokens.map((t) => t.length);
  const totalLen = docLengths.reduce((s, l) => s + l, 0);
  const avgDl = docLengths.length > 0 ? totalLen / docLengths.length : 1.0;
  const df = new Map<string, number>();
  for (const tokens of docTokens) {
    for (const term of new Set(tokens)) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  return { docTokens, docLengths, avgDl, df, n: documents.length };
}

// ── Single-document BM25 scoring ──────────────────────────────────────────

/**
 * BM25 score for a single document given pre-computed corpus stats.
 * Port of: mcp_server/core/scoring.py::_bm25_doc_score
 */
function bm25DocScore(
  qTerms: string[],
  tokens: string[],
  dl: number,
  avgDl: number,
  df: Map<string, number>,
  n: number,
  k1: number,
  b: number,
): number {
  const tfMap = new Map<string, number>();
  for (const t of tokens) {
    tfMap.set(t, (tfMap.get(t) ?? 0) + 1);
  }
  let score = 0;
  for (const term of qTerms) {
    const tf = tfMap.get(term);
    if (tf === undefined) continue;
    const termDf = df.get(term) ?? 0;
    // IDF smoothing: log((N - df + 0.5) / (df + 0.5) + 1)
    const idf = Math.log((n - termDf + 0.5) / (termDf + 0.5) + 1);
    score += (idf * (tf * (k1 + 1))) / (tf + k1 * (1 - b + (b * dl) / avgDl));
  }
  return score;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * BM25 scores normalized to [0, 1] for a query against a list of documents.
 *
 * Returns an array aligned with the input documents array.
 * Returns all-zeros for empty query or empty document list.
 *
 * k1=1.5, b=0.75 match ai-architect's PostgreSQL ts_rank defaults.
 *
 * Port of: mcp_server/core/scoring.py::compute_bm25_scores
 */
export function computeBm25Scores(
  query: string,
  documents: string[],
  k1 = 1.5,
  b = 0.75,
): number[] {
  const qTerms = tokenizeRaw(query);
  if (qTerms.length === 0 || documents.length === 0) {
    return new Array(documents.length).fill(0) as number[];
  }
  const stats = buildBm25Stats(documents);
  const scores = stats.docTokens.map((tokens, i) =>
    bm25DocScore(
      qTerms,
      tokens,
      stats.docLengths[i] ?? 0,
      stats.avgDl,
      stats.df,
      stats.n,
      k1,
      b,
    ),
  );
  const mx = Math.max(...scores);
  return scores.map((s) => (mx > 0 ? s / mx : 0));
}

// ── N-gram scoring ─────────────────────────────────────────────────────────

function extractNgrams(tokens: string[], n: number): Set<string> {
  if (tokens.length < n) return new Set();
  const result = new Set<string>();
  for (let i = 0; i <= tokens.length - n; i++) {
    result.add(tokens.slice(i, i + n).join("\x00"));
  }
  return result;
}

function setIntersectionSize(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const v of a) {
    if (b.has(v)) count++;
  }
  return count;
}

/**
 * Combined trigram + bigram + content-word overlap score in [0, 1].
 *
 * Weights: trigram=0.4, bigram=0.35, content_word=0.25
 * (matches ai-architect config)
 *
 * Port of: mcp_server/core/scoring.py::compute_ngram_score
 */
export function computeNgramScore(query: string, document: string): number {
  const qTok = tokenizeRaw(query);
  const dTok = tokenizeRaw(document);
  if (qTok.length === 0 || dTok.length === 0) return 0;

  const qTri = extractNgrams(qTok, 3);
  const dTri = extractNgrams(dTok, 3);
  const tri =
    qTri.size > 0
      ? setIntersectionSize(qTri, dTri) / Math.max(qTri.size, 1)
      : 0;

  const qBi = extractNgrams(qTok, 2);
  const dBi = extractNgrams(dTok, 2);
  const bi =
    qBi.size > 0 ? setIntersectionSize(qBi, dBi) / Math.max(qBi.size, 1) : 0;

  const qCw = new Set(qTok.filter((t) => !STOPWORDS.has(t) && t.length > 2));
  const dCw = new Set(dTok.filter((t) => !STOPWORDS.has(t)));
  const cw =
    qCw.size > 0 ? setIntersectionSize(qCw, dCw) / Math.max(qCw.size, 1) : 0;

  return 0.4 * tri + 0.35 * bi + 0.25 * cw;
}
