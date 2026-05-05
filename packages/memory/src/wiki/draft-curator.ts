/**
 * Phase 2.4 — Draft curation.
 *
 * Pure-logic gate: given a DraftPage and its KindDefinition, decide
 * whether to approve, reject, or hold for review.
 *
 * Hard-rule gate (no LLM): a draft must satisfy all of:
 *   - confidence >= MIN_CONFIDENCE
 *   - all required sections present and non-placeholder
 *   - lead present, non-placeholder, <= MAX_LEAD_WORDS
 *   - title is a noun phrase (not imperative-shaped)
 *
 * Pure logic, no I/O.
 *
 * Port of: cortex@ed33435 mcp_server/core/draft_curator.py
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type CurationVerdict = "approved" | "rejected" | "hold";

export interface KindDefinition {
  readonly name: string;
  readonly displayName: string;
  readonly dirName: string;
  readonly requiredSections: string[];
  readonly optionalSections: string[];
  readonly parentKind?: string | null;
  readonly autofillPrompt?: string;
}

/**
 * Outcome of evaluating one draft.
 * source: cortex@ed33435 mcp_server/core/draft_curator.py:50-56
 */
export interface CurationDecision {
  readonly verdict: CurationVerdict;
  readonly reasons: readonly string[];
  readonly score: number; // 0.0–1.0
}

// ── Constants ─────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/draft_curator.py:31-35

export const MIN_CONFIDENCE_APPROVE = 0.6; // source: cortex@ed33435 mcp_server/core/draft_curator.py:31
export const MIN_CONFIDENCE_HOLD = 0.4;    // source: cortex@ed33435 mcp_server/core/draft_curator.py:32
export const MAX_LEAD_WORDS = 80;          // source: cortex@ed33435 mcp_server/core/draft_curator.py:33
const PLACEHOLDER_PREFIX = "_(to be filled)_";
const PLACEHOLDER_LEAD_MARKERS = ["_(no claims yet", "_(to be filled)_"] as const;

// source: cortex@ed33435 mcp_server/core/draft_curator.py:39-47
const IMPERATIVE_TITLE_RE = /^\s*(let'?s|use|fetch|take|give|look at|verify|audit|check|make|do|run|push|remove|rename|adapt|implement|execute|perform|replace|add|delete|update|modify|fix|install|setup|configure|create|build|write|test|sync|import|move|copy|ensure|try|go|start|stop|open|close|clean|restart|refactor|migrate|enable|disable|apply|reset|rebuild|regenerate|analyze)\b/i;

// ── Helpers ───────────────────────────────────────────────────────────────

function wordCount(text: string): number {
  return (text ?? "").split(/\s+/).filter(Boolean).length;
}

function sectionIsFilled(body: string): boolean {
  if (!body || !body.trim()) return false;
  if (body.trim().startsWith(PLACEHOLDER_PREFIX)) return false;
  return true;
}

function missingRequiredSections(
  sections: Array<Record<string, unknown>>,
  required: string[],
): string[] {
  const byHeading: Record<string, string> = {};
  for (const s of sections) {
    const heading = ((s["heading"]) as string | undefined)?.trim() ?? "";
    const body = (s["body"] as string | undefined) ?? "";
    byHeading[heading] = body;
  }
  return required.filter((h) => {
    const body = byHeading[h];
    return body === undefined || !sectionIsFilled(body);
  });
}

function titleIsImperative(title: string): boolean {
  return IMPERATIVE_TITLE_RE.test(title ?? "");
}

function leadIsPlaceholder(lead: string): boolean {
  if (!lead) return true;
  const stripped = lead.trim();
  return PLACEHOLDER_LEAD_MARKERS.some((m) => stripped.startsWith(m));
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Evaluate a single draft. Returns approval verdict + reasons.
 *
 * precondition:  draft has confidence, title, lead, sections fields (all optional).
 * postcondition: if no reasons → verdict="approved"; if confidence < MIN_CONFIDENCE_HOLD
 *   or score < 0.3 → verdict="rejected"; otherwise → verdict="hold".
 *
 * source: cortex@ed33435 mcp_server/core/draft_curator.py:98-155
 */
export function evaluateDraft(
  draft: Record<string, unknown>,
  kindDefinition: KindDefinition | null,
): CurationDecision {
  const reasons: string[] = [];
  let score = 1.0;

  const confidence = Number((draft["confidence"] as number | undefined) ?? 0.0);
  const title = (draft["title"] as string | undefined) ?? "";
  const lead = (draft["lead"] as string | undefined) ?? "";
  const sections = (draft["sections"] as Array<Record<string, unknown>> | undefined) ?? [];
  const required = kindDefinition?.requiredSections ?? [];

  // 1. Confidence floor
  if (confidence < MIN_CONFIDENCE_HOLD) {
    reasons.push(`confidence ${confidence.toFixed(2)} below hold threshold ${MIN_CONFIDENCE_HOLD}`);
    score -= 0.4;
  } else if (confidence < MIN_CONFIDENCE_APPROVE) {
    reasons.push(`confidence ${confidence.toFixed(2)} below approve threshold ${MIN_CONFIDENCE_APPROVE}`);
    score -= 0.15;
  }

  // 2. Title shape
  if (titleIsImperative(title)) {
    reasons.push(`title is imperative-shaped: ${JSON.stringify(title)}`);
    score -= 0.25;
  } else if (!title.trim()) {
    reasons.push("title is empty");
    score -= 0.3;
  }

  // 3. Lead non-placeholder, length cap
  if (leadIsPlaceholder(lead)) {
    reasons.push("lead is placeholder");
    score -= 0.25;
  } else {
    const wc = wordCount(lead);
    if (wc > MAX_LEAD_WORDS) {
      reasons.push(`lead too long (${wc} words > ${MAX_LEAD_WORDS})`);
      score -= 0.1;
    }
  }

  // 4. Required sections filled
  const missing = missingRequiredSections(sections, required);
  if (missing.length > 0) {
    reasons.push(`missing required sections: ${JSON.stringify(missing)}`);
    score -= 0.15 * missing.length;
  }

  score = Math.max(0.0, score);

  if (reasons.length === 0) {
    return { verdict: "approved", reasons: [], score };
  }
  if (confidence < MIN_CONFIDENCE_HOLD || score < 0.3) {
    return { verdict: "rejected", reasons, score };
  }
  return { verdict: "hold", reasons, score };
}
