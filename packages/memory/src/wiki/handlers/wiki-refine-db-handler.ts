/**
 * Wiki Phase 2.3 (Path B) — DB-backed MCP tool handlers.
 *
 * Two MCP tools backed by wiki.drafts / wiki.claim_events / wiki.memos:
 *
 *   handlerGet(db, wikiRoot, args)    — wiki_get_draft tool
 *   handlerRefine(db, wikiRoot, args) — wiki_refine_draft tool
 *
 * Path A (template synthesizer) populates wiki.drafts at scale.
 * Path B is the per-draft refinement that turns a routed-claim skeleton
 * into prose. Caller (Claude) owns the writing; the server enforces schema
 * and audit.
 *
 * For the in-process LLM-only handler see wiki-refine-handler.ts.
 *
 * source: cortex@ed33435 mcp_server/handlers/wiki_refine.py
 */

import * as crypto from "node:crypto";
import { getDraft, listDrafts, updateDraft, insertMemo } from "../storage/pg-wiki-store-concepts.js";
import { loadRegistry } from "../schema-loader.js";
import type { WikiDbClient } from "../storage/pg-wiki-store-pages.js";

// ── Constants ─────────────────────────────────────────────────────────────────

// source: mcp_server/handlers/wiki_refine.py:313 — LLM-refined drafts get a confidence bump
const REFINED_DRAFT_CONFIDENCE = 0.85;

// source: mcp_server/handlers/wiki_refine.py:49 — default list limit
const DEFAULT_LIST_LIMIT = 20;

// source: mcp_server/handlers/wiki_refine.py:148 — lead preview cap in list response
const LIST_LEAD_PREVIEW_CHARS = 200;

// Hex prefix length for the prompt audit trail.
// source: mcp_server/handlers/wiki_refine.py:298-300 — hexdigest()[:16]
const PROMPT_HASH_LEN = 16;

// ── Tool schemas ──────────────────────────────────────────────────────────────

/**
 * source: cortex@ed33435 mcp_server/handlers/wiki_refine.py:48-69 (schema_get)
 */
export const schemaGet = {
  description:
    "Fetch a draft + its source claims + the kind contract so the " +
    "caller (LLM) can refine it. Phase 2.3 (Path B).",
  inputSchema: {
    type: "object",
    properties: {
      draft_id: { type: "integer" },
      list_pending: {
        type: "boolean",
        default: false,
        description: "If true, list pending drafts instead of fetching one.",
      },
      kind: {
        type: "string",
        description: "Filter list by kind when list_pending=true.",
      },
      limit: { type: "integer", default: DEFAULT_LIST_LIMIT },
    },
  },
} as const;

/**
 * source: cortex@ed33435 mcp_server/handlers/wiki_refine.py:207-250 (schema_refine)
 */
export const schemaRefine = {
  description:
    "Submit a refined draft (lead, sections, optional title). Updates " +
    "wiki.drafts in place; records an audit memo. Phase 2.3 (Path B).",
  inputSchema: {
    type: "object",
    required: ["draft_id"],
    properties: {
      draft_id: { type: "integer" },
      title: { type: "string" },
      lead: { type: "string" },
      sections: {
        type: "array",
        items: {
          type: "object",
          required: ["heading", "body"],
          properties: {
            heading: { type: "string" },
            body: { type: "string" },
            claim_ids: { type: "array", items: { type: "integer" } },
          },
        },
      },
      frontmatter: { type: "object" },
      synth_model: {
        type: "string",
        default: "claude_refine_v1",
        description: "Identifier for the refinement model/method.",
      },
      synth_prompt: {
        type: "string",
        description: "Optional copy of the refinement prompt for audit.",
      },
      rationale: {
        type: "string",
        description: "Optional explanation of what was changed and why.",
      },
    },
  },
} as const;

// ── Public types ──────────────────────────────────────────────────────────────

export interface RefineGetArgs {
  readonly draft_id?: number | null;
  readonly list_pending?: boolean | null;
  readonly kind?: string | null;
  readonly limit?: number | null;
}

export interface RefineSubmitArgs {
  readonly draft_id: number;
  readonly title?: string | null;
  readonly lead?: string | null;
  readonly sections?: ReadonlyArray<{
    readonly heading: string;
    readonly body: string;
    readonly claim_ids?: readonly number[];
  }> | null;
  readonly frontmatter?: Record<string, unknown> | null;
  readonly synth_model?: string | null;
  readonly synth_prompt?: string | null;
  readonly rationale?: string | null;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Fetch claims for a memory from wiki.claim_events.
 *
 * Precondition:  memoryId is a positive integer; db is a live WikiDbClient.
 * Postcondition: returns all claim_events rows for this memory, ordered by id.
 *
 * source: cortex@ed33435 mcp_server/handlers/wiki_refine.py:77-100 (_claims_for_memory)
 */
async function claimsForMemory(
  db: WikiDbClient,
  memoryId: number,
): Promise<Record<string, unknown>[]> {
  const r = await db.query<Record<string, unknown>>(
    `SELECT id, text, claim_type, entity_ids, evidence_refs, confidence
       FROM wiki.claim_events WHERE memory_id = $1 ORDER BY id`,
    [memoryId],
  );
  return r.rows;
}

/**
 * Return the structural contract for a kind: required + optional sections
 * plus the autofill prompt string the LLM should follow.
 *
 * Precondition:  wikiRoot is a valid directory path; kind is a non-empty string.
 * Postcondition: returns a contract dict; unknown kinds return empty sections.
 *
 * source: cortex@ed33435 mcp_server/handlers/wiki_refine.py:103-122 (_kind_contract)
 */
function kindContract(
  wikiRoot: string,
  kind: string,
): {
  kind: string;
  display_name: string;
  required_sections: string[];
  optional_sections: string[];
  autofill_prompt: string;
} {
  try {
    const registry = loadRegistry(wikiRoot);
    const kdef = registry.kinds[kind];
    if (!kdef) {
      return { kind, display_name: kind, required_sections: [], optional_sections: [], autofill_prompt: "" };
    }
    return {
      kind: kdef.name,
      display_name: kdef.display_name,
      required_sections: [...kdef.required_sections],
      optional_sections: [...kdef.optional_sections],
      autofill_prompt: kdef.autofill_prompt,
    };
  } catch {
    // wikiRoot may not exist in tests — return empty contract gracefully.
    return { kind, display_name: kind, required_sections: [], optional_sections: [], autofill_prompt: "" };
  }
}

/**
 * Validate that submitted sections satisfy required_sections from the contract.
 *
 * Precondition:  sections is an array of {heading, body} objects.
 * Postcondition: returns list of human-readable errors (empty ⟺ valid).
 *
 * Exported for white-box unit tests (validateAgainstContractForTest alias).
 *
 * source: cortex@ed33435 mcp_server/handlers/wiki_refine.py:253-265 (_validate_against_contract)
 */
export function validateAgainstContractForTest(
  sections: ReadonlyArray<{ readonly heading: string; readonly body: string }>,
  requiredSections: readonly string[],
): string[] {
  return validateAgainstContract(sections, requiredSections);
}

function validateAgainstContract(
  sections: ReadonlyArray<{ readonly heading: string; readonly body: string }>,
  requiredSections: readonly string[],
): string[] {
  const errors: string[] = [];
  const headings = new Set(sections.map((s) => s.heading.trim()));
  for (const req of requiredSections) {
    if (!headings.has(req)) errors.push(`required section missing: ${JSON.stringify(req)}`);
  }
  for (const s of sections) {
    if (!s.body.trim()) errors.push(`section ${JSON.stringify(s.heading)} has empty body`);
  }
  return errors;
}

// ── DB-backed handlers ────────────────────────────────────────────────────────

/**
 * wiki_get_draft — DB-backed tool handler.
 *
 * When list_pending=true: return a trimmed list of pending drafts.
 * Otherwise: fetch the draft by id, its source claims, and the kind contract.
 *
 * Precondition:  db is a live WikiDbClient; wikiRoot is a valid directory path.
 * Postcondition: on success returns draft + kind_contract + source_claims;
 *                on list returns {drafts, count}; returns {error} on miss.
 *
 * source: cortex@ed33435 mcp_server/handlers/wiki_refine.py:125-201 (handler_get)
 */
export async function handlerGet(
  db: WikiDbClient,
  wikiRoot: string,
  args: RefineGetArgs = {},
): Promise<Record<string, unknown>> {
  if (args.list_pending) {
    const drafts = await listDrafts(
      db,
      "pending",
      args.kind ?? undefined,
      args.limit ?? DEFAULT_LIST_LIMIT,
    );
    return {
      drafts: drafts.map((d) => ({
        id: d["id"],
        kind: d["kind"],
        title: d["title"],
        lead: typeof d["lead"] === "string" ? d["lead"].slice(0, LIST_LEAD_PREVIEW_CHARS) : "",
        memory_id: d["memory_id"],
        concept_id: d["concept_id"],
        confidence: d["confidence"],
        synth_model: d["synth_model"],
      })),
      count: drafts.length,
    };
  }

  const draftId = args.draft_id;
  if (draftId == null) {
    return { error: "draft_id required (or list_pending=true)" };
  }

  const draft = await getDraft(db, draftId);
  if (!draft) return { error: `draft ${draftId} not found` };

  // Source claims (only when memory-backed)
  let claims: Record<string, unknown>[] = [];
  const memoryId = draft["memory_id"];
  if (typeof memoryId === "number" && memoryId > 0) {
    claims = await claimsForMemory(db, memoryId);
  }

  const contract = kindContract(wikiRoot, String(draft["kind"] ?? ""));

  return {
    draft: {
      id: draft["id"],
      memory_id: draft["memory_id"],
      concept_id: draft["concept_id"],
      kind: draft["kind"],
      title: draft["title"],
      lead: draft["lead"],
      sections: draft["sections"],
      frontmatter: draft["frontmatter"],
      confidence: draft["confidence"],
      synth_model: draft["synth_model"],
      status: draft["status"],
    },
    kind_contract: contract,
    source_claims: claims.map((c) => ({
      id: c["id"],
      claim_type: c["claim_type"],
      text: c["text"],
      confidence: c["confidence"],
      evidence_refs: c["evidence_refs"],
    })),
    instructions:
      "Refine the draft to satisfy the kind_contract. " +
      "Each required_section must be filled with prose grounded in " +
      "the source_claims. The lead must be ≤60 words and self-contained. " +
      "Use [[slug]] syntax to link to other wiki pages where appropriate. " +
      "When done, call wiki_refine_draft with the new lead and sections.",
  };
}

/**
 * wiki_refine_draft — DB-backed tool handler.
 *
 * Validates sections against the kind contract, updates wiki.drafts in place,
 * and records an audit memo via wiki.memos.
 *
 * Precondition:  db is a live WikiDbClient; args.draft_id is a positive integer.
 * Postcondition: on success updates wiki.drafts and inserts a wiki.memos row;
 *                returns {draft_id, updated, synth_model, synth_prompt_hash}.
 *
 * source: cortex@ed33435 mcp_server/handlers/wiki_refine.py:268-337 (handler_refine)
 */
export async function handlerRefine(
  db: WikiDbClient,
  wikiRoot: string,
  args: RefineSubmitArgs,
): Promise<Record<string, unknown>> {
  const { draft_id: draftId } = args;
  if (draftId == null) return { error: "draft_id required" };

  const draft = await getDraft(db, draftId);
  if (!draft) return { error: `draft ${draftId} not found` };

  const sections = args.sections ? [...args.sections] : undefined;
  if (sections !== undefined) {
    const contract = kindContract(wikiRoot, String(draft["kind"] ?? ""));
    const validationErrors = validateAgainstContract(sections, contract.required_sections);
    if (validationErrors.length > 0) {
      return {
        error: "validation failed",
        validation_errors: validationErrors,
        kind_contract: contract,
      };
    }
  }

  const synthModel = args.synth_model ?? "claude_refine_v1";
  const synthPrompt = args.synth_prompt ?? null;
  const promptHash = synthPrompt
    ? crypto.createHash("sha256").update(synthPrompt, "utf-8").digest("hex").slice(0, PROMPT_HASH_LEN)
    : null;

  const updated = await updateDraft(db, draftId, {
    title: args.title ?? null,
    lead: args.lead ?? null,
    // cast: UpdateDraftFields.sections accepts unknown[] | null
    sections: (sections ?? null) as unknown[] | null,
    frontmatter: args.frontmatter ?? null,
    synth_model: synthModel,
    synth_prompt: synthPrompt,
    confidence: REFINED_DRAFT_CONFIDENCE,
  });

  if (updated) {
    const rationale =
      args.rationale ??
      `LLM-refined draft. Model: ${synthModel}. Prompt hash: ${promptHash ?? "n/a"}.`;
    await insertMemo(
      db,
      "draft",
      draftId,
      "refined_llm",
      rationale,
      [],
      { synth_model: synthModel, synth_prompt_hash: promptHash },
      REFINED_DRAFT_CONFIDENCE,
      "claude_refine",
    );
  }

  return {
    draft_id: draftId,
    updated,
    synth_model: synthModel,
    synth_prompt_hash: promptHash,
  };
}
