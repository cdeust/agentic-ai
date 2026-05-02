/**
 * Knowledge graph entity extraction — typed entity/relationship detection.
 *
 * Extracts entities (functions, dependencies, errors, decisions,
 * technologies) and typed relationships from memory content using
 * regex-based heuristics. No LLM needed.
 *
 * Pure business logic — no I/O.
 *
 * Wave-2 (commit bc0ae4f): extended _resolveQueryEntityIds to include a
 * two-stage resolution: Stage 1 = CamelCase / path / backtick patterns;
 * Stage 2 = natural-language token fallback via stopword-aware tokenizer.
 * This file ports Stage 1 (extract_entities) and provides the token
 * extraction helper used by Stage 2 in the recall pipeline.
 *
 * Port of: cortex@bc0ae4f mcp_server/core/knowledge_graph.py
 */

// ── Extraction patterns ──────────────────────────────────────────────────

// source: cortex@bc0ae4f mcp_server/core/knowledge_graph.py:60-74

/** Minimum entity name length for CamelCase extraction.
 *  source: cortex@bc0ae4f mcp_server/core/knowledge_graph.py:131 (len(name) > 2) */
const MIN_CAMEL_LEN = 2; // used as: name.length > MIN_CAMEL_LEN (i.e. > 2 → length >= 3)

/** Minimum import name length to include.
 *  source: cortex@bc0ae4f mcp_server/core/knowledge_graph.py:85 (len(name) > 1) */
const MIN_IMPORT_NAME_LEN = 1; // used as: name.length > MIN_IMPORT_NAME_LEN

/** Minimum token length for NL keyword extractor (Stage 2 Wave-2 bc0ae4f).
 *  source: cortex@bc0ae4f mcp_server/core/recall_pipeline.py:355 (len(token) >= 4) */
const MIN_NL_TOKEN_LEN = 4;

const IMPORT_FULL_RE = /(?:^|\n)\s*import\s+([\w.]+)/gm;
const FROM_IMPORT_RE = /(?:^|\n)\s*from\s+([\w.]+)\s+import\s+([\w, ]+)/gm;
const DEF_RE = /\bdef\s+(\w+)\s*\(/g;
const CLASS_RE = /\bclass\s+(\w+)/g;
const ERROR_FIX_RE =
  /(?:fix(?:ed)?|resolv(?:ed|e|ing)|solved?)\s+(?:the\s+)?(\w*(?:Error|Exception|error|bug|issue))/gi;
const DECIDED_RE =
  /decided\s+to\s+use\s+(\w+(?:\s+\w+){0,2})\s+instead\s+of\s+(\w+(?:\s+\w+){0,2})/gi;
const FILE_PATH_RE = /(?:\.{0,2}\/)?(?:[\w@.-]+\/)+[\w@.-]+\.\w+/g;
const CAMELCASE_RE = /\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g;

// ── Types ───────────────────────────────────────────────────────────────────

export interface ExtractedEntity {
  name: string;
  type: string;
  relationship_context: string;
}

// ── Extraction helpers ─────────────────────────────────────────────────────

function extractImportEntities(
  content: string,
): Array<[string, string, string]> {
  const results: Array<[string, string, string]> = [];
  let m: RegExpExecArray | null;
  const fromRe = new RegExp(FROM_IMPORT_RE.source, FROM_IMPORT_RE.flags);
  while ((m = fromRe.exec(content)) !== null) {
    const module = m[1] ?? "";
    const names = (m[2] ?? "").split(",").map((n) => n.trim());
    results.push([module, "dependency", ""]);
    for (const name of names) {
      if (name && name.length > MIN_IMPORT_NAME_LEN)
        results.push([name, "function", "imports"]);
    }
  }
  const fullRe = new RegExp(IMPORT_FULL_RE.source, IMPORT_FULL_RE.flags);
  while ((m = fullRe.exec(content)) !== null) {
    results.push([m[1] ?? "", "dependency", ""]);
  }
  return results;
}

function extractDefinitionEntities(content: string): {
  entities: Array<[string, string, string]>;
  definedFuncs: Set<string>;
} {
  const entities: Array<[string, string, string]> = [];
  const definedFuncs = new Set<string>();
  const defRe = new RegExp(DEF_RE.source, DEF_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = defRe.exec(content)) !== null) {
    const fname = m[1] ?? "";
    // source: cortex@bc0ae4f knowledge_graph.py:102 (skip short private names)
    if (fname.startsWith("_") && fname.length < MIN_CAMEL_LEN + 1) continue;
    definedFuncs.add(fname);
    entities.push([fname, "function", ""]);
  }
  const classRe = new RegExp(CLASS_RE.source, CLASS_RE.flags);
  while ((m = classRe.exec(content)) !== null) {
    entities.push([m[1] ?? "", "technology", ""]);
  }
  return { entities, definedFuncs };
}

function extractPatternEntities(
  content: string,
  definedFuncs: Set<string>,
): Array<[string, string, string]> {
  const results: Array<[string, string, string]> = [];
  let m: RegExpExecArray | null;
  const errRe = new RegExp(ERROR_FIX_RE.source, ERROR_FIX_RE.flags);
  while ((m = errRe.exec(content)) !== null) {
    results.push([m[1] ?? "", "error", "resolved_by"]);
  }
  const decidedRe = new RegExp(DECIDED_RE.source, DECIDED_RE.flags);
  while ((m = decidedRe.exec(content)) !== null) {
    results.push([(m[1] ?? "").trim(), "decision", "decided_to_use"]);
    results.push([(m[2] ?? "").trim(), "decision", "decided_to_use"]);
  }
  const fileRe = new RegExp(FILE_PATH_RE.source, FILE_PATH_RE.flags);
  while ((m = fileRe.exec(content)) !== null) {
    results.push([m[0] ?? "", "file", ""]);
  }
  const camelRe = new RegExp(CAMELCASE_RE.source, CAMELCASE_RE.flags);
  while ((m = camelRe.exec(content)) !== null) {
    const name = m[0] ?? "";
    if (!definedFuncs.has(name) && name.length > MIN_CAMEL_LEN) {
      results.push([name, "technology", ""]);
    }
  }
  return results;
}

function deduplicateEntities(
  tuples: Array<[string, string, string]>,
): ExtractedEntity[] {
  const seen = new Set<string>();
  const unique: ExtractedEntity[] = [];
  for (const [name, type, relationship_context] of tuples) {
    const key = `${name}\0${type}\0${relationship_context}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push({ name, type, relationship_context });
    }
  }
  return unique;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Extract typed entities from content.
 *
 * Returns list of {name, type, relationship_context} objects.
 * relationship_context is empty string unless the entity implies a
 * relationship.
 *
 * pre:  content is a string
 * post: returned list is deduplicated; order is insertion-stable
 *
 * source: cortex@bc0ae4f mcp_server/core/knowledge_graph.py:155-166
 */
export function extractEntities(content: string): ExtractedEntity[] {
  const importEntities = extractImportEntities(content);
  const { entities: defnEntities, definedFuncs } =
    extractDefinitionEntities(content);
  const patternEntities = extractPatternEntities(content, definedFuncs);
  return deduplicateEntities([
    ...importEntities,
    ...defnEntities,
    ...patternEntities,
  ]);
}

// ── Natural-language keyword extraction (Wave-2, bc0ae4f) ─────────────────

/**
 * Stopword set for the NL token extractor.
 * source: cortex@bc0ae4f mcp_server/shared/text.py (extract_keywords stopwords)
 */
const NL_STOP_WORDS = new Set([
  "the", "a", "an", "is", "it", "in", "on", "at", "of", "to", "and", "or",
  "but", "for", "not", "with", "by", "as", "be", "was", "are", "were", "has",
  "have", "had", "do", "does", "did", "this", "that", "these", "those",
  "from", "into", "about", "up", "what", "when", "where", "how", "why",
  "who", "which", "been", "will", "would", "could", "should", "can", "may",
  "might", "shall", "just", "than", "then", "also", "any", "all", "some",
]);

/**
 * Stopword-aware keyword extractor.
 *
 * Returns alphabetic tokens of length >= 4 that are not in the stop-word
 * list. Used by the Stage-2 NL token resolution path (Wave-2, bc0ae4f).
 *
 * pre:  text is a string
 * post: all returned tokens are lowercase; deduplicated
 *
 * source: cortex@bc0ae4f mcp_server/core/recall_pipeline.py:311-370
 *         (Stage 2 token fallback block)
 */
export function extractKeywords(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .split(/\W+/)
    .filter(
      (t) =>
        t.length >= MIN_NL_TOKEN_LEN &&
        /^[a-z]+$/.test(t) &&
        !NL_STOP_WORDS.has(t),
    );
  return [...new Set(tokens)];
}
