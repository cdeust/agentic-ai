/**
 * Memory decomposition: structure-aware chunking with entity enrichment.
 *
 * Inspired by the ai-architect artifact chunking strategy: split at natural
 * structural boundaries (speaker turns for conversations, headings for
 * markdown), not arbitrary character limits. Each chunk carries extracted
 * entities for graph-based retrieval.
 *
 * Chunking strategies:
 *   1. Conversation content: group by speaker turn pairs (2-3 exchanges)
 *   2. Markdown content: split at ## heading boundaries
 *   3. Short content (< threshold): pass through unchanged
 *
 * Port of: mcp_server/core/memory_decomposer.py
 * Pure business logic — no I/O.
 */

// ── Entity extraction patterns (conversational content) ─────────────────────

const PERSON_RE = /\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]+)*)\b/g;

const QUOTED_RE = /"([^"]{3,60})"|[“]([^”]{3,60})[”]/g;

const PREFERENCE_RE =
  /\b(prefer|favorite|fan of|passionate about)\b|\bi (?:love|enjoy|hate|dislike|like to|like using)\b|\bmy (?:preference|choice|style)\b/i;

const ACTIVITY_RE =
  /\b(went to|visited|attended|started|began|joined|signed up|enrolled|bought|purchased|got|received|adopted|moved to|traveled to|came back from)\b/i;

const DECISION_RE =
  /\b(decided|chose|plan to|going to|will|want to|thinking about|considering|from now on|always|never)\b/i;

/**
 * Directive language markers (Searle 1969 speech act theory: directives).
 * Tight patterns: only match explicit user directives, not general conversation.
 * "always use X", "never do Y", "make sure to Z" — not "I should go".
 */
const INSTRUCTION_RE =
  /(?:^|\.\s+)(?:always|never|make sure|from now on|every time|each time|whenever you|don't ever|do not ever|stick to|use only|format as)\b|\b(?:required|mandatory|forbidden|prohibited|guideline|convention|constraint)\b/im;

/** Stopwords for person name filtering */
const COMMON_WORDS = new Set<string>([
  "Date", "The", "This", "That", "These", "Those", "What", "When", "Where", "Which",
  "Who", "How", "Why", "Yes", "Hey", "Hello", "Sure", "Really", "Beautiful", "Awesome",
  "Amazing", "Wow", "Nice", "Cool", "Right", "Actually", "Honestly", "Absolutely",
  "Definitely", "Sounds", "Congrats", "Congratulations", "Sorry", "Speaker", "Thanks",
  "Thank", "Good", "Great", "Well", "Also", "But", "And", "For", "Not", "Can", "Did",
  "Does", "Has", "Have", "Had", "Was", "Were", "Are", "Been", "Being", "May", "June",
  "July", "August", "March", "April", "January", "February", "September", "October",
  "November", "December", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
  "Saturday", "Sunday",
]);

// ── Structural boundary detection ────────────────────────────────────────────

const SPEAKER_LINE_RE = /^\[([^\]]+)\]:\s*/m;
const HEADING_RE = /^##\s+/m;
const DATE_PREFIX_RE = /^(\[Date:[^\]]*\])\s*\n?/;

// ── Entity extraction ─────────────────────────────────────────────────────────

export interface ConversationalEntities {
  persons: string[];
  quoted_terms: string[];
  has_preference: boolean;
  has_instruction: boolean;
  has_activity: boolean;
  has_decision: boolean;
}

/**
 * Extract named entities from conversational content.
 *
 * Precondition: content is a string.
 * Postcondition: persons contains at most 20 entries; quoted_terms at most 10.
 */
export function extractConversationalEntities(content: string): ConversationalEntities {
  const persons: string[] = [];
  const seen = new Set<string>();
  // Reset lastIndex for global regex
  PERSON_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PERSON_RE.exec(content)) !== null) {
    const name = m[1];
    if (name && !COMMON_WORDS.has(name) && name.length > 2 && !seen.has(name)) {
      seen.add(name);
      persons.push(name);
    }
  }

  const quoted: string[] = [];
  QUOTED_RE.lastIndex = 0;
  while ((m = QUOTED_RE.exec(content)) !== null) {
    const term = (m[1] ?? m[2] ?? "").trim();
    if (term) quoted.push(term);
  }

  return {
    persons: persons.slice(0, 20),
    quoted_terms: quoted.slice(0, 10),
    has_preference: PREFERENCE_RE.test(content),
    has_instruction: INSTRUCTION_RE.test(content),
    has_activity: ACTIVITY_RE.test(content),
    has_decision: DECISION_RE.test(content),
  };
}

/**
 * Build a compact entity summary string for embedding enrichment.
 *
 * Postcondition: result is a pipe-delimited string (may be empty string).
 */
export function buildEntitySummary(entities: ConversationalEntities): string {
  const parts: string[] = [];
  if (entities.persons.length > 0) {
    parts.push("People: " + entities.persons.slice(0, 5).join(", "));
  }
  if (entities.quoted_terms.length > 0) {
    parts.push("Topics: " + entities.quoted_terms.slice(0, 3).join(", "));
  }
  const tags: string[] = [];
  if (entities.has_preference) tags.push("preference");
  if (entities.has_instruction) tags.push("instruction");
  if (entities.has_activity) tags.push("activity");
  if (entities.has_decision) tags.push("decision");
  if (tags.length > 0) {
    parts.push("Type: " + tags.join(", "));
  }
  return parts.join(" | ");
}

// ── Structure-aware decomposition ─────────────────────────────────────────────

export interface MemoryChunk {
  content: string;
  entities: ConversationalEntities;
}

/**
 * Split conversation at speaker turn boundaries.
 *
 * Groups N consecutive turns into each chunk. Every chunk gets the
 * date prefix for temporal context.
 *
 * Precondition: content is a non-empty string; turnsPerChunk >= 1; minChunkChars >= 0.
 * Postcondition: returns empty array if fewer than turnsPerChunk turns detected.
 * Invariant: each returned chunk length >= minChunkChars.
 */
function chunkByTurns(
  content: string,
  datePrefix: string,
  turnsPerChunk: number,
  minChunkChars: number,
): string[] {
  const turns: string[] = [];
  let current = "";
  for (const line of content.split("\n")) {
    if (SPEAKER_LINE_RE.test(line) && current.trim()) {
      turns.push(current.trim());
      current = line + "\n";
    } else {
      current += line + "\n";
    }
  }
  if (current.trim()) turns.push(current.trim());

  if (turns.length <= turnsPerChunk) return [];

  const chunks: string[] = [];
  for (let i = 0; i < turns.length; i += turnsPerChunk) {
    const group = turns.slice(i, i + turnsPerChunk);
    const chunkText = datePrefix + group.join("\n");
    if (chunkText.length >= minChunkChars) {
      chunks.push(chunkText);
    }
  }
  return chunks;
}

/**
 * Split markdown at ## heading boundaries.
 *
 * Precondition: content is a non-empty string.
 * Postcondition: each returned chunk length >= minChunkChars.
 */
function chunkByHeadings(
  content: string,
  datePrefix: string,
  minChunkChars: number,
): string[] {
  const sections = content.split(/(?=^## )/m);
  const chunks: string[] = [];
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    const chunkText = datePrefix ? datePrefix + trimmed : trimmed;
    if (chunkText.length >= minChunkChars) {
      chunks.push(chunkText);
    }
  }
  return chunks;
}

/**
 * Decompose memory content at natural structural boundaries.
 *
 * Strategy selection:
 *   - Conversation content (has [Speaker]: lines): group by turn pairs
 *   - Markdown content (has ## headings): split at heading boundaries
 *   - Other/short content: return as single chunk
 *
 * Each chunk gets entity extraction for retrieval enrichment.
 *
 * @param content - Memory content to decompose.
 * @param turnsPerChunk - Number of speaker turns per conversation chunk.
 * @param minChunkChars - Minimum chars for a chunk to be kept.
 * @returns List of {content, entities} objects.
 *
 * Precondition: content is a string.
 * Postcondition: result is a non-empty array (at least one chunk for non-empty content).
 *   Each chunk's content.length >= minChunkChars (except single-chunk fallback).
 */
export function decomposeMemory(
  content: string,
  turnsPerChunk: number = 4,
  minChunkChars: number = 100,
): MemoryChunk[] {
  content = content.trim();
  if (!content) return [];

  // Extract date prefix — will be prepended to every chunk
  let datePrefix = "";
  const dateMatch = DATE_PREFIX_RE.exec(content);
  if (dateMatch) {
    datePrefix = dateMatch[1] + "\n";
    content = content.slice(dateMatch[0].length);
  }

  const hasSpeakers = SPEAKER_LINE_RE.test(content);
  const hasHeadings = HEADING_RE.test(content);

  let chunks: string[];
  if (hasSpeakers) {
    chunks = chunkByTurns(content, datePrefix, turnsPerChunk, minChunkChars);
  } else if (hasHeadings) {
    chunks = chunkByHeadings(content, datePrefix, minChunkChars);
  } else {
    const full = datePrefix ? datePrefix + content : content;
    return [{ content: full, entities: extractConversationalEntities(full) }];
  }

  if (chunks.length === 0) {
    const full = datePrefix ? datePrefix + content : content;
    return [{ content: full, entities: extractConversationalEntities(full) }];
  }

  return chunks.map((c) => ({ content: c, entities: extractConversationalEntities(c) }));
}
