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
 * P2a fix (2026-05-04): ported the missing functions and constants from
 * cortex@ed33435 mcp_server/core/knowledge_graph.py:
 *   - VALID_REL_TYPES frozenset (13 relationship types)
 *   - ENTITY_TYPES frozenset (16 entity types)
 *   - findEntityPositions (private helper for detectCoOccurrences)
 *   - minPairDistance (private helper for detectCoOccurrences)
 *   - detectCoOccurrences (public — co-occurrence edges in knowledge graph)
 *   - groupEntitiesByContext (private helper for inferRelationships)
 *   - inferRelationships (public — typed edges from extracted entities)
 * Without these the knowledge graph had no co-occurrence or inferred edges.
 *
 * Port of: cortex@ed33435 mcp_server/core/knowledge_graph.py
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

// ── P2a additions (cortex@ed33435 knowledge_graph.py) ─────────────────────

/**
 * Valid relationship types in the knowledge graph.
 * source: cortex@ed33435 mcp_server/core/knowledge_graph.py:18-34
 */
export const VALID_REL_TYPES: ReadonlySet<string> = new Set([
  "co_occurrence",
  "imports",
  "calls",
  "debugged_with",
  "decided_to_use",
  "caused_by",
  "resolved_by",
  "preceded_by",
  "derived_from",
  "defines",
  "extends",
  "implements",
  "contains",
]);

/**
 * Recognized entity types in the knowledge graph.
 * source: cortex@ed33435 mcp_server/core/knowledge_graph.py:37-56
 */
export const ENTITY_TYPES: ReadonlySet<string> = new Set([
  "function",
  "dependency",
  "error",
  "decision",
  "technology",
  "file",
  "variable",
  "class",
  "interface",
  "type",
  "enum",
  "trait",
  "protocol",
  "constant",
  "module",
  "struct",
]);

/**
 * Find all character positions for each entity name in content.
 *
 * pre:  entityNames is a list of strings; contentLower is the lowercased content.
 * post: returns [(name, [positions, ...]), ...] for names that appear at
 *   least once; names with zero occurrences are omitted.
 *
 * source: cortex@ed33435 mcp_server/core/knowledge_graph.py:169-184
 *         (_find_entity_positions)
 */
function findEntityPositions(
  entityNames: string[],
  contentLower: string,
): Array<[string, number[]]> {
  const positions = new Map<string, number[]>();
  for (const name of entityNames) {
    const nameLower = name.toLowerCase();
    const posList: number[] = [];
    let start = 0;
    // invariant: start advances past each found occurrence
    // termination: indexOf returns -1 when no further match exists
    while (true) {
      const idx = contentLower.indexOf(nameLower, start);
      if (idx === -1) break;
      posList.push(idx);
      start = idx + 1;
    }
    if (posList.length > 0) {
      positions.set(name, posList);
    }
  }
  return Array.from(positions.entries());
}

/**
 * Compute minimum distance between two sets of character positions.
 *
 * pre:  posA and posB are non-empty integer arrays.
 * post: returned value is the minimum absolute difference across all pairs.
 *
 * source: cortex@ed33435 mcp_server/core/knowledge_graph.py:187-195
 *         (_min_pair_distance)
 */
function minPairDistance(posA: number[], posB: number[]): number {
  let minDist = Infinity;
  // invariant: minDist is the minimum distance found so far
  // termination: both loops are bounded by posA.length and posB.length
  for (const pa of posA) {
    for (const pb of posB) {
      const dist = Math.abs(pa - pb);
      if (dist < minDist) {
        minDist = dist;
      }
    }
  }
  return minDist;
}

const CO_OCCURRENCE_WINDOW_CHARS = 500; // source: cortex@ed33435 mcp_server/core/knowledge_graph.py:198 (default window_chars=500)

// Rounding factor for 4 decimal places (round(x, 4) → x * 10^4 / 10^4).
// source: cortex@ed33435 mcp_server/core/knowledge_graph.py:216 (round(proximity, 4))
const ROUND_4DP = 10000; // source: cortex@ed33435 knowledge_graph.py:216

/**
 * Detect co-occurring entities within a character window.
 *
 * Returns (entity_a, entity_b, proximity_score) triples.
 * Proximity score is 1 - (distance / window_chars), inversely proportional
 * to character distance.
 *
 * pre:  entityNames is a list of entity name strings; content is the raw text.
 * post: returned triples have proximity score in (0, 1]; only pairs within
 *   windowChars characters are returned; proximity is rounded to 4dp.
 *
 * source: cortex@ed33435 mcp_server/core/knowledge_graph.py:198-218
 *         (detect_co_occurrences)
 */
export function detectCoOccurrences(
  entityNames: string[],
  content: string,
  windowChars: number = CO_OCCURRENCE_WINDOW_CHARS,
): Array<[string, string, number]> {
  const namesWithPos = findEntityPositions(entityNames, content.toLowerCase());
  const results: Array<[string, string, number]> = [];

  // invariant: for each pair (i, j) with i < j, results has at most one entry
  // termination: outer loop over namesWithPos (finite), inner over rest (finite)
  for (let i = 0; i < namesWithPos.length; i++) {
    const entryA = namesWithPos[i];
    if (entryA === undefined) continue;
    const [nameA, posA] = entryA;
    for (let j = i + 1; j < namesWithPos.length; j++) {
      const entryB = namesWithPos[j];
      if (entryB === undefined) continue;
      const [nameB, posB] = entryB;
      const minDist = minPairDistance(posA, posB);
      if (minDist <= windowChars) {
        const proximity = Math.round((1.0 - minDist / windowChars) * ROUND_4DP) / ROUND_4DP; // source: cortex@ed33435 knowledge_graph.py:216 (round(proximity,4))
        results.push([nameA, nameB, proximity]);
      }
    }
  }

  return results;
}

/**
 * Group entities into importers, dependencies, resolved errors, and decisions.
 *
 * pre:  entities is a list of ExtractedEntity objects.
 * post: returns four lists; each entity appears in at most one list;
 *   an entity with relationship_context "imports" → importers; type
 *   "dependency" → dependencies; ctx "resolved_by" → resolved; ctx
 *   "decided_to_use" → decisions.
 *
 * source: cortex@ed33435 mcp_server/core/knowledge_graph.py:221-241
 *         (_group_entities_by_context)
 */
function groupEntitiesByContext(entities: ExtractedEntity[]): {
  importers: string[];
  dependencies: string[];
  resolved: string[];
  decisions: string[];
} {
  const importers: string[] = [];
  const dependencies: string[] = [];
  const resolved: string[] = [];
  const decisions: string[] = [];

  for (const e of entities) {
    const ctx = e.relationship_context;
    if (ctx === "imports") {
      importers.push(e.name);
    } else if (e.type === "dependency") {
      dependencies.push(e.name);
    } else if (ctx === "resolved_by") {
      resolved.push(e.name);
    } else if (ctx === "decided_to_use") {
      decisions.push(e.name);
    }
  }

  return { importers, dependencies, resolved, decisions };
}

/**
 * Typed relationship returned by inferRelationships.
 * source: cortex@ed33435 mcp_server/core/knowledge_graph.py:244-281
 */
export interface KnowledgeGraphRelationship {
  source: string;
  target: string;
  type: string;
}

/**
 * Infer typed relationships between extracted entities.
 *
 * Uses relationship_context from extraction to create edges:
 *   - Each (importer, dependency) pair → edge {source: dep, target: imp, type: "imports"}
 *   - Each resolved error → edge {source: err, target: "", type: "resolved_by"}
 *   - If >= 2 decisions → edge {source: d[0], target: d[1], type: "decided_to_use"}
 *
 * pre:  entities is a list of ExtractedEntity objects.
 * post: returned list contains only edges whose type is in VALID_REL_TYPES.
 *
 * source: cortex@ed33435 mcp_server/core/knowledge_graph.py:244-281
 *         (infer_relationships)
 */
export function inferRelationships(
  entities: ExtractedEntity[],
): KnowledgeGraphRelationship[] {
  const { importers, dependencies, resolved, decisions } =
    groupEntitiesByContext(entities);
  const relationships: KnowledgeGraphRelationship[] = [];

  // imports edges: dep → importer
  for (const imp of importers) {
    for (const dep of dependencies) {
      relationships.push({
        source: dep,
        target: imp,
        type: "imports",
      });
    }
  }

  // resolved_by edges: error → (no specific target)
  for (const err of resolved) {
    relationships.push({
      source: err,
      target: "",
      type: "resolved_by",
    });
  }

  // decided_to_use edge: first decision → second decision
  if (decisions.length >= 2) {
    const d0 = decisions[0];
    const d1 = decisions[1];
    if (d0 !== undefined && d1 !== undefined) {
      relationships.push({
        source: d0,
        target: d1,
        type: "decided_to_use",
      });
    }
  }

  return relationships;
}
