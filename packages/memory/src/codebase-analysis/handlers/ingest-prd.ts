/**
 * Handler: ingest-prd — pull a PRD document into Cortex's store.
 *
 * Ported from mcp_server/handlers/ingest_prd.py
 *
 * Sources supported
 * -----------------
 * - `path`          — absolute path to a markdown PRD file
 * - `content`       — raw markdown string
 * - `pipeline_id`   — prd-gen pipeline state id; fetches via upstream MCP
 *
 * Outputs into Cortex
 * -------------------
 * - Wiki page under `specs/<slug>.md` (kind=spec)
 * - One memory for the PRD summary (tagged `prd`, `spec`)
 * - One memory per extracted decision (tagged `decision`)
 * - One memory per extracted requirement (tagged `requirement`)
 * - Optional validation stats from prd-gen's `validate_prd_document`
 *
 * Cortex consumes; prd-gen produces.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  callUpstream,
  McpConnectionError,
  normaliseMcpPayload,
} from "./ingest-helpers.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MemoryStore = any;

const _UPSTREAM_SERVER = "prd-gen";

// ── Schema ────────────────────────────────────────────────────────────────

export const schema = {
  description:
    "Ingest a PRD (Product Requirements Document) into Cortex's " +
    "store. Source: a file path, raw markdown, or a prd-gen pipeline " +
    "state id (fetched via upstream MCP). Writes the PRD as a wiki " +
    "spec page under specs/<slug>.md, extracts decisions and " +
    "requirements as separate tagged memories (`decision`, " +
    "`requirement`), and optionally routes the document through " +
    "prd-gen's `validate_prd_document` to capture quality signals. " +
    "Use this after a PRD is authored or generated so Cortex's " +
    "Wiki/Board/Knowledge views reflect it. Distinct from " +
    "`wiki_write` (manual single-page write, no decision/requirement " +
    "extraction), `ingest_codebase` (code symbols, not requirement " +
    "documents), and `remember` (one memory, no wiki page or " +
    "structured extraction). Mutates wiki/specs/ + memories table. " +
    "Latency varies (~500ms-3s depending on validation flag). " +
    "Returns {wiki_path, memories_created: {summary, decisions, " +
    "requirements}, validation?: stats}.",
  inputSchema: {
    type: "object" as const,
    required: [] as const,
    properties: {
      path: {
        type: "string",
        description:
          "Absolute path to a markdown PRD file. Mutually exclusive with content/pipeline_id.",
        examples: ["/Users/alice/code/myapp/docs/prd-auth-v2.md"],
      },
      content: {
        type: "string",
        description: "Raw PRD markdown. Mutually exclusive with path/pipeline_id.",
      },
      pipeline_id: {
        type: "string",
        description:
          "prd-gen pipeline state id. When supplied, Cortex calls " +
          "get_pipeline_state to fetch the rendered PRD.",
        examples: ["prd-pipeline-12345"],
      },
      title: {
        type: "string",
        description:
          "Override the PRD title (otherwise parsed from the first # heading or filename).",
        examples: ["Auth v2 redesign"],
      },
      validate: {
        type: "boolean",
        description:
          "If true, call prd-gen's validate_prd_document and attach " +
          "validation stats to the ingestion summary.",
        default: false,
      },
      domain: {
        type: "string",
        description: "Cognitive domain to tag the ingested memories with.",
        examples: ["myapp", "auth-service"],
      },
    },
  },
} as const;

// ── Store singleton ───────────────────────────────────────────────────────

let _store: MemoryStore | null = null;
let _wikiRoot = "";

export function initStore(store: MemoryStore, wikiRoot: string): void {
  _store = store;
  _wikiRoot = wikiRoot;
}

function _getStore(): MemoryStore {
  if (!_store) {
    throw new Error(
      "MemoryStore not initialised. Call ingest-prd.initStore() first. " +
        "port-pending: DI wiring from port/cortex-shared",
    );
  }
  return _store;
}

// ── PRD fetch ─────────────────────────────────────────────────────────────

async function _fetchPrd(
  args: Record<string, unknown>,
): Promise<[string, string]> {
  const path = ((args["path"] as string) ?? "").trim();
  const content = (args["content"] as string) ?? "";
  const pipelineId = ((args["pipeline_id"] as string) ?? "").trim();

  const provided = [Boolean(path), Boolean(content), Boolean(pipelineId)];
  if (provided.filter(Boolean).length !== 1) {
    throw new Error("exactly one of path / content / pipeline_id must be supplied");
  }

  if (path) return [readFileSync(resolve(path), "utf8"), "path"];
  if (content) return [content, "content"];

  const payload = await callUpstream(_UPSTREAM_SERVER, "get_pipeline_state", {
    pipeline_id: pipelineId,
  });
  const result = normaliseMcpPayload(payload) as Record<string, unknown>;
  const prdText =
    (result["rendered_prd"] as string) ??
    (result["prd"] as string) ??
    (result["text"] as string);
  if (!prdText) {
    throw new Error(
      `prd-gen returned no rendered PRD for pipeline_id=${pipelineId}`,
    );
  }
  return [prdText, "pipeline_id"];
}

// ── Title extraction ──────────────────────────────────────────────────────

function _extractTitle(text: string, override: string | undefined): string {
  if (override) return override.trim();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) return trimmed.slice(2).trim();
  }
  return "Untitled PRD";
}

// ── Section splitting ─────────────────────────────────────────────────────

const _SECTION_RE = /^#{2,3}\s+(.+?)\s*$/gm;

function _splitSections(text: string): [string, string][] {
  const matches = [...text.matchAll(_SECTION_RE)];
  const sections: [string, string][] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const heading = m[1]!.trim();
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : text.length;
    const body = text.slice(start, end).trim();
    if (heading && body) sections.push([heading, body]);
  }
  return sections;
}

const _DECISION_HEADINGS = new Set([
  "decisions",
  "decision",
  "architecture decisions",
]);
const _REQUIREMENT_HEADINGS = new Set([
  "requirements",
  "functional requirements",
  "non-functional requirements",
  "acceptance criteria",
  "user stories",
]);

// ── Bullet extraction ─────────────────────────────────────────────────────

function _extractBullets(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split("\n")) {
    const stripped = line.trim();
    if (stripped.startsWith("- ") || stripped.startsWith("* ")) {
      out.push(stripped.slice(2).trim());
    } else {
      const numbered = /^\d+[.)]\s+(.+)/.exec(stripped);
      if (numbered) out.push(numbered[1]!.trim());
    }
  }
  return out.filter((b) => b.length >= 8);
}

// ── Slugify ───────────────────────────────────────────────────────────────

function _slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "prd";
}

// ── Wiki page rendering ───────────────────────────────────────────────────

function _nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function _renderPrdSpecPage(
  title: string,
  text: string,
  source: string,
): [string, string] {
  const slug = _slugify(title);
  const relPath = `specs/${slug}.md`;
  const frontmatter = [
    "---",
    `title: ${title}`,
    "kind: spec",
    "tags: [prd, spec, ingest]",
    `source: ${source}`,
    `updated: ${_nowIso()}`,
    "---",
    "",
  ];
  const body = text.trimStart().startsWith("# ")
    ? text.trim()
    : `# ${title}\n\n${text.trim()}`;
  return [relPath, frontmatter.join("\n") + "\n" + body + "\n"];
}

function _writePage(wikiRoot: string, relPath: string, markdown: string): void {
  const fullPath = join(wikiRoot, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, markdown, "utf8");
}

// ── Memory writers ────────────────────────────────────────────────────────

function _writeBulletMemories(
  store: MemoryStore,
  bullets: string[],
  tag: string,
  title: string,
  domain: string,
  directory: string,
): number[] {
  const ids: number[] = [];
  for (const bullet of bullets) {
    const content = `${tag.charAt(0).toUpperCase() + tag.slice(1)} (from PRD '${title}'): ${bullet}`;
    const record = {
      content,
      tags: [tag, "prd", "ingest"],
      source: "ingest_prd",
      domain,
      directory_context: directory,
      importance: tag === "decision" ? 0.7 : 0.5,
      heat: 0.8,
      is_protected: tag === "decision",
    };
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      ids.push(store.insertMemory(record) as number);
    } catch {
      // best-effort
    }
  }
  return ids;
}

// ── Optional validation ───────────────────────────────────────────────────

async function _maybeValidate(
  text: string,
): Promise<Record<string, unknown> | null> {
  try {
    const payload = await callUpstream(_UPSTREAM_SERVER, "validate_prd_document", {
      content: text,
    });
    return normaliseMcpPayload(payload) as Record<string, unknown>;
  } catch (e) {
    if (e instanceof McpConnectionError) {
      return { skipped: true, reason: "upstream_unreachable" };
    }
    return { skipped: true, reason: (e as Error).constructor.name };
  }
}

// ── Handler ───────────────────────────────────────────────────────────────

export async function handler(
  args: Record<string, unknown> | null = null,
): Promise<Record<string, unknown>> {
  /**
   * Ingest a PRD document into Cortex.
   */
  const a = args ?? {};

  let text: string;
  let source: string;
  try {
    [text, source] = await _fetchPrd(a);
  } catch (e) {
    if (e instanceof McpConnectionError) {
      return { ingested: false, reason: "prd_gen_unreachable", error: String(e) };
    }
    const err = e as Error;
    if (err.message?.includes("ENOENT") || err.message?.includes("not found")) {
      return { ingested: false, reason: `prd file not found: ${err.message}` };
    }
    return { ingested: false, reason: String(err.message ?? err) };
  }

  const title = _extractTitle(text, a["title"] as string | undefined);
  const domain = ((a["domain"] as string) ?? "prd").trim() || "prd";
  const rawPath = (a["path"] as string) ?? ".";
  const directory = dirname(resolve(rawPath));

  // 1. Write the spec page.
  const [relPath, markdown] = _renderPrdSpecPage(title, text, source);
  let wikiPath: string | null = relPath;
  try {
    _writePage(_wikiRoot, relPath, markdown);
  } catch {
    wikiPath = null;
  }

  // 2. Extract decisions + requirements.
  const store = _getStore();
  const decisionBullets: string[] = [];
  const requirementBullets: string[] = [];
  for (const [heading, body] of _splitSections(text)) {
    const h = heading.toLowerCase();
    if (_DECISION_HEADINGS.has(h) || [..._DECISION_HEADINGS].some((k) => h.includes(k))) {
      decisionBullets.push(..._extractBullets(body));
    } else if (
      _REQUIREMENT_HEADINGS.has(h) ||
      [..._REQUIREMENT_HEADINGS].some((k) => h.includes(k))
    ) {
      requirementBullets.push(..._extractBullets(body));
    }
  }

  const decisionIds = _writeBulletMemories(
    store,
    decisionBullets,
    "decision",
    title,
    domain,
    directory,
  );
  const requirementIds = _writeBulletMemories(
    store,
    requirementBullets,
    "requirement",
    title,
    domain,
    directory,
  );

  // 3. Summary memory.
  const summaryRecord = {
    content:
      `PRD ingested: '${title}' (${decisionBullets.length} decisions, ` +
      `${requirementBullets.length} requirements).`,
    tags: ["prd", "ingest", "summary"],
    source: "ingest_prd",
    domain,
    directory_context: directory,
    importance: 0.8,
    heat: 0.9,
    is_protected: true,
  };
  let summaryId: number | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    summaryId = store.insertMemory(summaryRecord) as number;
  } catch {
    // best-effort
  }

  // 4. Optional validation.
  let validation: Record<string, unknown> | null = null;
  if (a["validate"]) {
    validation = await _maybeValidate(text);
  }

  return {
    ingested: true,
    title,
    source,
    wiki_path: wikiPath,
    summary_memory_id: summaryId,
    decision_count: decisionIds.length,
    requirement_count: requirementIds.length,
    validation,
  };
}
