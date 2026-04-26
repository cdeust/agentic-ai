/**
 * Wiki content classifier — determines page kind or rejects noise.
 *
 * Pure business logic — no I/O. The sync path calls this to decide
 * whether a memory should become a wiki page, and what kind.
 *
 * Classification hierarchy (Alexander P2 + Eco):
 *   1. REJECT: tool invocations, system prompts, JSON, generic instructions
 *   2. ADR: contains a decision with rationale
 *   3. LESSON: describes a mistake and its resolution
 *   4. CONVENTION: establishes a rule or standard
 *   5. SPEC: describes a feature or system design
 *   6. NOTE: catch-all for meaningful content
 *
 * source: mcp_server/core/wiki_classifier.py
 */

import type { ClassifierRule } from "./schema-loader.js";
import { applyRules } from "./rule-engine.js";

// ── Rejection patterns ────────────────────────────────────────────────────

const REJECT_PREFIXES = [
  "# Tool:",
  "Tool:",
  "tool:",
  "# tool:",
  "System:",
  "system:",
  "<tool_result>",
  "<result>",
  "<command-message>",
  "<command-name>",
  "# <command-message>",
  "# <command-name>",
] as const;

const REJECT_TITLES = new Set([
  "tool-edit",
  "tool-bash",
  "tool-read",
  "tool-write",
  "tool-grep",
  "tool-glob",
  "tool-search",
]);

const REJECT_PATTERNS = [
  /^#*\s*Implement the following plan/i,
  /^#*\s*Execute the following/i,
  /^#*\s*You must respond with only/i,
  /^#*\s*Perform all verification/i,
  /^#*\s*Take the code and split/i,
  /^\s*\{[\s\S]*\}\s*$/,
  /^\s*\[[\s\S]*\]\s*$/,
  /<command-(message|name|args)>/i,
  /^#*\s*Spell:\s*\w+/i,
  /^#*\s*Shape test content/i,
] as const;

// ── Classification patterns ───────────────────────────────────────────────

const ADR_PATTERNS = [
  /\b(decided to|decision:|the decision is|chose .+ because|rejected .+ (due to|because)|we will use|selected .+ over)\b/i,
] as const;

const LESSON_PATTERNS = [
  /\b(the bug was|root cause|lesson learned|mistake was|never again|fix:|fixed by|the issue was|the problem was|turned out)\b/i,
] as const;

const CONVENTION_PATTERNS = [
  /\b(always use|never |the canonical|convention:|rule:|standard:|must follow|naming convention|coding standard)\b/i,
] as const;

const SPEC_TAGS = new Set(["spec", "design", "specification", "feature"]);

// ── Hard-negative gate (Eco + Ahrens) ────────────────────────────────────

const IMPERATIVE_TITLE_PATTERNS = [
  /^\s*#*\s*(let'?s|lets)\b/i,
  /^\s*#*\s*(use|fetch|take|give|look at|verify|audit|check|make|do|run|push|remove|rename|adapt|implement|execute|perform|replace|add|delete|update|modify|fix|install|setup|configure|create|build|write|test|sync|import|export|move|copy|ensure|try|go|start|stop|open|close|clean|restart|refactor|migrate|enable|disable|apply|reset|rebuild|regenerate|analyze)\b/i,
  /^\s*#*\s*you (must|should|need|will|can)\b/i,
  /^\s*#*\s*(how|what|why|when|where|can|should|is|does)\b[^.]*\?\s*$/,
] as const;

const FIRST_PERSON_PATTERNS = [
  /^\s*#*\s*(we|i)\s+(pushed|pulled|did|have|did|tried|ran|found|saw|noticed|got|made|created|added|removed|fixed|broke|updated|changed|deleted|merged|re?-?started|tested|benchmarked|think|need|want|should|re)/i,
] as const;

const STATUS_PATTERNS = [
  /^\s*#*\s*(successfully|done|failing|failed|broken|working|not working|finished|completed|in progress|wip|todo|pending)\b/i,
  /local[-_]command[-_](stdout|stderr|stdin|output)/i,
  /session[-_]test[-_]session/i,
  /in domain unknown/i,
] as const;

const DEIXIS_PATTERNS = [
  /^\s*#*\s*(just now|just did|previous|earlier|last session|new wip|the one we|like (we|i) (said|did)|yesterday|today|tomorrow|a while ago|recent(ly)?)\b/i,
] as const;

const PATH_OR_URL_TITLE_PATTERNS = [
  /^\s*#*\s*[/~]/,
  /^\s*#*\s*[A-Za-z]:[\\/]/,
  /^\s*#*\s*(https?|ftp|file|ssh|git):\/\//i,
  /^\s*#*\s*[\w.-]+\.(pdf|png|jpg|jpeg|svg|gif|zip|tar\.gz|docx?|xlsx?|csv|log|yaml|yml)\b/i,
] as const;

const AUDIT_TAGS = new Set([
  "_backfill",
  "imported",
  "session-summary",
  "tool-output",
  "code-review",
  "stage-1", "stage-2", "stage-3", "stage-4", "stage-5",
  "stage-6", "stage-7", "stage-8", "stage-9", "stage-10",
  "stage-11",
  "audit",
  "automated",
  "wip",
  "progress",
]);

const AUDIT_TITLE_PATTERNS = [
  /\bstage[ -]?\d+\b/i,
  /\b(code[ -]?review|audit[ -]?report|review[ -]?notes?)\b/i,
  /\bsession[ -]?(summary|log|report|\d+)\b/i,
] as const;

function failsHardNegatives(content: string, firstLine: string): boolean {
  for (const pat of IMPERATIVE_TITLE_PATTERNS) {
    if (pat.test(firstLine)) return true;
  }
  for (const pat of FIRST_PERSON_PATTERNS) {
    if (pat.test(firstLine)) return true;
  }
  const first500 = content.slice(0, 500);
  for (const pat of STATUS_PATTERNS) {
    if (pat.test(firstLine)) return true;
    if (pat.test(first500)) return true;
  }
  for (const pat of DEIXIS_PATTERNS) {
    if (pat.test(firstLine)) return true;
  }
  for (const pat of PATH_OR_URL_TITLE_PATTERNS) {
    if (pat.test(firstLine)) return true;
  }
  for (const pat of AUDIT_TITLE_PATTERNS) {
    if (pat.test(firstLine)) return true;
  }
  return false;
}

function failsAuditTagGate(tags: Set<string>): boolean {
  for (const tag of tags) {
    if (AUDIT_TAGS.has(tag)) return true;
  }
  return false;
}

// ── Positive quality signals ──────────────────────────────────────────────

const STRUCTURE_HEADING = /^#{1,4}\s+\S/m;
const STRUCTURE_LIST = /^\s*[-*+]\s+\S/m;
const STRUCTURE_CODE = /```\w*\n/m;
const CITATION = /\b(ADR-?\d+|paper|arxiv|doi:|https?:\/\/|\b[A-Z][a-z]+ (et al\.|&) \d{4}|\b[A-Z][a-z]+ \d{4}\b)/;
const DECLARATIVE = /\b(is|are|means|causes?|because|implies|requires?|enables?|prevents?|produces?|results? in|leads? to|defined? as|consists of)\b/ig;
const FILE_OR_ENTITY_REF = /\b[a-zA-Z_]\w*\.(py|js|ts|md|json|yaml|sql|go|rs|rb|java)\b|\b[a-z_]+\(\)|\bclass\s+[A-Z]\w+|\bdef\s+[a-z_]\w+/;

const KNOWLEDGE_TAGS = new Set([
  "decision", "adr", "architecture", "spec", "design", "lesson",
  "convention", "rule", "standard", "paper", "research", "reference",
]);

const POSITIVE_SCORE_THRESHOLD = 4;

function positiveScore(content: string, tags: Set<string>): number {
  let score = 0;
  const length = content.length;

  // 1. Structure
  const struct =
    (STRUCTURE_HEADING.test(content) ? 1 : 0) +
    (STRUCTURE_LIST.test(content) ? 1 : 0) +
    (STRUCTURE_CODE.test(content) ? 1 : 0);
  if (struct >= 1) score++;

  // 2. Declarative claims
  const declarativeMatches = content.match(DECLARATIVE) ?? [];
  if (declarativeMatches.length >= 2) score++;

  // 3. Citations / references
  if (CITATION.test(content)) score++;

  // 4. Substantive length
  if (length >= 200) score++;

  // 5. Knowledge tag
  for (const tag of tags) {
    if (KNOWLEDGE_TAGS.has(tag)) { score++; break; }
  }

  // 6. Atomic scope (200–3000 chars is the Zettelkasten sweet spot)
  // source: Ahrens, S. (2017). How to Take Smart Notes. CreateSpace. Chapter 8.
  if (length >= 200 && length <= 3000) score++;

  // 7. Domain vocabulary density — at least 3 distinct CamelCase/snake_case
  //    technical tokens
  const techTokens = new Set(content.match(/\b(?:[A-Z][a-z]+[A-Z]\w*|[a-z]+_[a-z_]+)\b/g) ?? []);
  if (techTokens.size >= 3) score++;

  // 8. File/entity references
  if (FILE_OR_ENTITY_REF.test(content)) score++;

  return score;
}

// ── Title prefix stripping ────────────────────────────────────────────────

const TITLE_STRIP_PREFIXES = [
  /^#+\s*/,
  /^(Tool|System|Rule|Decision|Convention|Lesson|Note):\s*/i,
  /^Implement the following plan:?\s*/i,
  /^Execute the following:?\s*/i,
  /^(Here is|Here's|The following)\s+/i,
] as const;

// ── User-rule integration ─────────────────────────────────────────────────

let userRulesCache: readonly ClassifierRule[] | null = null;

function loadUserRules(wikiRoot?: string): readonly ClassifierRule[] {
  if (userRulesCache !== null) return userRulesCache;
  if (!wikiRoot) {
    userRulesCache = [];
    return userRulesCache;
  }
  try {
    const { loadRegistry } = require("./schema-loader.js") as typeof import("./schema-loader.js");
    const registry = loadRegistry(wikiRoot);
    userRulesCache = registry.rules;
  } catch {
    userRulesCache = [];
  }
  return userRulesCache;
}

export function resetUserRules(): void {
  userRulesCache = null;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Classify memory content for wiki sync.
 *
 * Inversion (Eco + Ahrens): default to REJECT. A memory is
 * promoted to the wiki only if it passes three gates:
 *
 *   1. Noise rejection (tool output, JSON, slash-command framing)
 *   2. Hard-negative gate (imperatives, first-person narration, status,
 *      temporal deixis — any hit disqualifies)
 *   3. Positive scoring (≥ 4 of 8 quality signals)
 *
 * Explicit knowledge-shaped tags (decision/adr/spec/design/lesson/
 * convention/rule) bypass the positive scorer — those are opt-in by
 * the caller and presumed wiki-worthy.
 *
 * Returns page kind ('adr', 'lesson', 'convention', 'spec', 'note')
 * or null if the content should be rejected.
 */
export function classifyMemory(
  content: string,
  tags?: readonly string[] | null,
  wikiRoot?: string,
): string | null {
  if (!content || content.trim().length < 50) return null;

  const stripped = content.trim();
  const firstLine = stripped.split("\n")[0]?.trim() ?? "";

  // Gate -1 — Audit-tag gate
  const tagSetPre = new Set((tags ?? []).map((t) => t.toLowerCase()));
  if (failsAuditTagGate(tagSetPre)) return null;

  // Gate 0 — User-editable rules
  const rules = loadUserRules(wikiRoot);
  if (rules.length > 0) {
    const match = applyRules(content, tags ?? null, rules);
    if (match.matched_rule !== null) {
      return match.target_kind; // null means rejection
    }
  }

  // Gate 1 — Noise rejection
  for (const prefix of REJECT_PREFIXES) {
    if (stripped.startsWith(prefix)) return null;
  }
  for (const pattern of REJECT_PATTERNS) {
    if (pattern.test(stripped)) return null;
  }
  if (REJECT_TITLES.has(slugify(firstLine))) return null;

  // Gate 2 — Hard-negative gate
  if (failsHardNegatives(content, firstLine)) return null;

  // Tag-based fast-path
  const EXPLICIT_KNOWLEDGE_TAGS = new Set([
    "decision", "adr", "architecture", "spec", "design", "lesson",
    "convention", "rule", "standard", "paper", "research",
  ]);
  let hasExplicitTag = false;
  for (const tag of tagSetPre) {
    if (EXPLICIT_KNOWLEDGE_TAGS.has(tag)) { hasExplicitTag = true; break; }
  }

  // Gate 3 — Positive scoring
  if (!hasExplicitTag) {
    if (positiveScore(content, tagSetPre) < POSITIVE_SCORE_THRESHOLD) return null;
  }

  // Route to right kind
  for (const pat of ADR_PATTERNS) {
    if (pat.test(content)) return "adr";
  }
  if (tagSetPre.has("decision") || tagSetPre.has("adr")) return "adr";

  for (const pat of LESSON_PATTERNS) {
    if (pat.test(content)) return "lesson";
  }
  if (tagSetPre.has("lesson") || tagSetPre.has("debugging") || tagSetPre.has("fix") || tagSetPre.has("bug-fix")) {
    return "lesson";
  }

  for (const pat of CONVENTION_PATTERNS) {
    if (pat.test(content)) return "convention";
  }
  if (tagSetPre.has("convention") || tagSetPre.has("rule") || tagSetPre.has("standard")) {
    return "convention";
  }

  if (hasTagIn(tagSetPre, SPEC_TAGS) && content.length > 200) return "spec";
  if ((tagSetPre.has("architecture") || tagSetPre.has("design")) && content.length > 200) return "spec";

  return "note";
}

function hasTagIn(tagSet: Set<string>, candidates: Set<string>): boolean {
  for (const tag of tagSet) {
    if (candidates.has(tag)) return true;
  }
  return false;
}

/**
 * Derive a meaningful title for a wiki page.
 */
export function deriveTitle(
  content: string,
  kind: string,
  tags?: readonly string[] | null,
  entities?: readonly string[] | null,
): string {
  const lines = content.trim().split("\n");
  let firstMeaningful = "";
  for (const line of lines) {
    let cleaned = line.trim();
    for (const pat of TITLE_STRIP_PREFIXES) {
      cleaned = cleaned.replace(pat, "").trim();
    }
    if (cleaned.length > 10 && !cleaned.startsWith("{") && !cleaned.startsWith("[")) {
      firstMeaningful = cleaned;
      break;
    }
  }

  if (!firstMeaningful) {
    firstMeaningful = content.trim().slice(0, 80);
  }

  if (firstMeaningful.length > 80) {
    const truncated = firstMeaningful.slice(0, 77);
    const lastSpace = truncated.lastIndexOf(" ");
    firstMeaningful = lastSpace > 0 ? truncated.slice(0, lastSpace) + "..." : truncated + "...";
  }

  const prefixMap: Record<string, string> = {
    adr: "Decision",
    lesson: "Lesson",
    convention: "Convention",
    spec: "Spec",
  };
  const prefix = prefixMap[kind] ?? "";

  if (entities && entities.length >= 2) {
    const entityTitle = entities.slice(0, 2).join(" + ");
    return prefix ? `${prefix}: ${entityTitle}` : entityTitle;
  }

  if (prefix && !firstMeaningful.toLowerCase().startsWith(prefix.toLowerCase())) {
    return `${prefix}: ${firstMeaningful}`;
  }

  return firstMeaningful;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}


