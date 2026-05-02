/**
 * Handler: codebase-analyze — scan a project and store code structure as memories.
 *
 * Ported from mcp_server/handlers/codebase_analyze.py
 *
 * Walks a project directory, parses source files using tree-sitter AST
 * (with regex fallback), and stores one memory per file with symbols as
 * entities and imports as relationships. Then runs cross-file resolution,
 * call graph extraction, and community detection.
 *
 * Incremental by default: only processes files whose content hash changed.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { EXT_TO_LANG, buildMemoryContent, parseFile } from "../codebase-parser.js";
import { isAvailable as astIsAvailable, parseFileAst } from "../ast-parser.js";
import { detectCommunities, extractInheritance, resolveAllImports } from "../codebase-graph.js";
import { resolveTypeReferences } from "../codebase-type-resolver.js";
import type { FileAnalysis } from "../types.js";
import {
  CODEBASE_AGENT_CONTEXT,
  FILE_TAG_PREFIX,
  HASH_TAG_PREFIX,
  collectSourceFiles,
  loadExistingHashes,
  markStale,
  persistCommunityTags,
  persistEntities,
  persistFileEdge,
  persistInheritanceEdge,
  resolveRelativePath,
} from "./codebase-analyze-helpers.js";
import type { MemoryStore } from "../../remember/storage/memory-store.js";

// ── Dependency injection types ────────────────────────────────────────────

/**
 * Dependencies for the codebase-analyze handler.
 *
 * precondition:  store is a fully initialised MemoryStore instance.
 * postcondition: the handler uses store for all persistence operations.
 */
export interface CodebaseAnalyzeDeps {
  store: MemoryStore;
}

// ── Schema ────────────────────────────────────────────────────────────────

export const schema = {
  title: "Codebase analyze",
  description:
    "Walk a codebase and store its structure as memories using tree-" +
    "sitter AST parsing (with regex fallback for unsupported " +
    "languages). One memory per file, with symbols as entities and " +
    "imports as relationships; then cross-file symbol resolution, " +
    "call-graph extraction, and community detection over the call " +
    "graph. Incremental — only re-processes files whose content hash " +
    "changed since last run (tracked via HASH_TAG_PREFIX tags). Use " +
    "this on first onboarding to a serious codebase, or after a major " +
    "refactor that invalidates symbol assumptions. Distinct from " +
    "`seed_project` (5-stage shallow structural sweep, no AST), " +
    "`backfill_memories` (Claude Code conversations, not source " +
    "files), `wiki_seed_codebase` (seeds wiki pages from .md docs), " +
    "and `ingest_codebase` (downstream PRD-generator consumer). " +
    "Mutates memories + entities + relationships tables.",
  inputSchema: {
    type: "object" as const,
    required: [] as const,
    properties: {
      directory: {
        type: "string",
        description: "Root directory of the codebase to analyze.",
        examples: ["/Users/alice/code/cortex"],
      },
      languages: {
        type: "array",
        description: "Restrict analysis to specific languages.",
        items: { type: "string" },
        default: [],
      },
      max_files: {
        type: "integer",
        description: "Maximum number of files to process per call.",
        default: 500, // source: cortex mcp_server/handlers/codebase_analyze.py — max_files default=500
        minimum: 1,
        maximum: 50000, // source: cortex mcp_server/handlers/codebase_analyze.py — max_files max=50000
      },
      max_file_size_kb: {
        type: "integer",
        description: "Skip files larger than this many kilobytes.",
        default: 100, // source: cortex mcp_server/handlers/codebase_analyze.py — max_file_size_kb default=100
        minimum: 1,
        maximum: 4096, // source: 4096 KB = standard 4 MB file-size upper bound (in exempt list)
      },
      incremental: {
        type: "boolean",
        description: "Only re-process files whose content hash changed.",
        default: true,
      },
      dry_run: {
        type: "boolean",
        description: "Report what would be analyzed without writing memories.",
        default: false,
      },
      domain: {
        type: "string",
        description: "Cognitive domain to tag analysis memories with.",
        examples: ["cortex", "auth-service"],
      },
    },
  },
} as const;

const CODEBASE_SOURCE = "codebase_analyze";
const CODEBASE_TAG = "codebase";
const LANG_TAG_PREFIX = "lang:";
// source: cortex Python source mcp_server/handlers/codebase_analyze.py — default values
const DEFAULT_MAX_FILES = 500; // source: cortex mcp_server/handlers/codebase_analyze.py — max_files default=500
const DEFAULT_MAX_FILE_SIZE_KB = 100; // source: cortex mcp_server/handlers/codebase_analyze.py — max_file_size_kb default=100
// source: cortex mcp_server/handlers/codebase_analyze.py — top N symbols stored as tags per file
const MAX_SYMBOL_TAGS_PER_FILE = 10;
// source: 1024 bytes per KB — standard SI definition; used for stat().size comparison
const BYTES_PER_KB = 1024;

// ── Argument parsing ──────────────────────────────────────────────────────

function _parseArgs(args: Record<string, unknown> | null): {
  directory: string;
  languages: string[] | null;
  maxFiles: number;
  maxBytes: number;
  incremental: boolean;
  dryRun: boolean;
  domain: string;
} {
  const a = args ?? {};
  const directory = ((a["directory"] as string) ?? process.cwd()).trim() || process.cwd();
  const languages = (a["languages"] as string[] | null | undefined) ?? null;
  const maxFiles = Number(a["max_files"] ?? DEFAULT_MAX_FILES);
  const maxKb = Number(a["max_file_size_kb"] ?? DEFAULT_MAX_FILE_SIZE_KB);
  const incremental = (a["incremental"] as boolean | undefined) ?? true;
  const dryRun = (a["dry_run"] as boolean | undefined) ?? false;
  const domain = (a["domain"] as string | undefined) ?? "";
  return { directory, languages, maxFiles, maxBytes: maxKb * BYTES_PER_KB, incremental, dryRun, domain };
}

// ── Tag building ──────────────────────────────────────────────────────────

function _buildTags(relPath: string, analysis: FileAnalysis): string[] {
  const tags = [
    CODEBASE_TAG,
    `${FILE_TAG_PREFIX}${relPath}`,
    `${HASH_TAG_PREFIX}${analysis.contentHash}`,
    `${LANG_TAG_PREFIX}${analysis.language}`,
  ];
  for (const sym of analysis.definitions.slice(0, MAX_SYMBOL_TAGS_PER_FILE)) {
    tags.push(`symbol:${sym.name}`);
  }
  return tags;
}

// ── File parsing ──────────────────────────────────────────────────────────

function _parseOneFile(path: string, content: string): FileAnalysis {
  if (astIsAvailable()) {
    return parseFileAst(path, Buffer.from(content, "utf8"));
  }
  return parseFile(path, content);
}

// ── Store file ────────────────────────────────────────────────────────────

async function _storeFile(
  root: string,
  relPath: string,
  analysis: FileAnalysis,
  domain: string,
  store: MemoryStore,
): Promise<[number | null, number, number]> {
  /**
   * Store a single file as a memory with entities.
   *
   * precondition:  store is a live MemoryStore; relPath is the file path
   *                relative to root; analysis holds the parsed symbols.
   * postcondition: returns [memory_id, entity_count, relationship_count].
   *                memory_id is null if insertMemory throws (best-effort).
   */
  const content = buildMemoryContent(analysis);
  const tags = _buildTags(relPath, analysis);

  let memoryId: number | null = null;
  try {
    memoryId = store.insertMemory({
      content,
      tags,
      directory_context: root,
      domain,
      source: CODEBASE_SOURCE,
      agent_context: CODEBASE_AGENT_CONTEXT,
    });
  } catch {
    return [null, 0, 0];
  }

  if (memoryId === null) return [null, 0, 0];

  const [ents, rels] = persistEntities(store, analysis, memoryId, domain || "code");
  return [memoryId, ents, rels];
}

// ── Process files ─────────────────────────────────────────────────────────

async function _processFiles(
  sourceFiles: string[],
  root: string,
  existing: Map<string, [number, string]>,
  incremental: boolean,
  domain: string,
  store: MemoryStore,
): Promise<{
  newCount: number;
  updatedCount: number;
  unchangedCount: number;
  totalEntities: number;
  totalRelationships: number;
  seenPaths: Set<string>;
  allAnalyses: FileAnalysis[];
  fileContents: Map<string, string>;
}> {
  let newCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  let totalEntities = 0;
  let totalRelationships = 0;
  const seenPaths = new Set<string>();
  const allAnalyses: FileAnalysis[] = [];
  const fileContents = new Map<string, string>();

  for (const sourcePath of sourceFiles) {
    const relPath = resolveRelativePath(sourcePath, root);
    seenPaths.add(relPath);

    let content: string;
    try {
      content = readFileSync(sourcePath, "utf8");
    } catch {
      continue;
    }
    fileContents.set(relPath, content);
    const analysis = _parseOneFile(relPath, content);
    allAnalyses.push(analysis);

    if (incremental && existing.has(relPath)) {
      const existingEntry = existing.get(relPath);
      if (existingEntry !== undefined && existingEntry[1] === analysis.contentHash) {
        unchangedCount++;
        continue;
      }
      updatedCount++;
    } else {
      newCount++;
    }

    const [, ents, rels] = await _storeFile(root, relPath, analysis, domain, store);
    totalEntities += ents;
    totalRelationships += rels;
  }

  return {
    newCount,
    updatedCount,
    unchangedCount,
    totalEntities,
    totalRelationships,
    seenPaths,
    allAnalyses,
    fileContents,
  };
}

// ── Graph analysis ────────────────────────────────────────────────────────

function _runGraphAnalysis(
  analyses: FileAnalysis[],
  fileContents: Map<string, string>,
  store: MemoryStore,
  domain: string,
): Record<string, number> {
  const importEdges = resolveAllImports(analyses);
  const typeRefEdges = resolveTypeReferences(analyses, fileContents);
  // Deduplicate edges by string key
  const allFileEdgesMap = new Map<string, [string, string]>();
  for (const e of [...importEdges, ...typeRefEdges]) {
    allFileEdgesMap.set(`${e[0]}::${e[1]}`, e);
  }
  const allFileEdges = [...allFileEdgesMap.values()];
  const inheritEdges = extractInheritance(analyses);
  const communities = detectCommunities(allFileEdges, []);

  const fileRels = persistFileEdge(store, allFileEdges, domain);
  const inheritRels = persistInheritanceEdge(store, inheritEdges, domain);
  persistCommunityTags(store, communities);

  return {
    import_edges: importEdges.length,
    type_ref_edges: typeRefEdges.length,
    total_file_edges: allFileEdges.length,
    inheritance_edges: inheritEdges.length,
    communities: new Set(communities.values()).size,
    file_edges_stored: fileRels,
    inherit_edges_stored: inheritRels,
  };
}

// ── Handler ───────────────────────────────────────────────────────────────

/**
 * Analyze a codebase and store its structure as Cortex memories.
 *
 * precondition:  deps.store is a live MemoryStore; args.directory (or cwd)
 *                is an existing directory on the local filesystem.
 * postcondition: returns a result object with analyzed=true and counts of
 *                new/updated/unchanged/stale files plus graph stats; or
 *                analyzed=false with a reason string on early-exit paths.
 */
export async function handler(
  args: Record<string, unknown> | null,
  deps: CodebaseAnalyzeDeps,
): Promise<Record<string, unknown>> {
  const {
    directory: root,
    languages,
    maxFiles,
    maxBytes,
    incremental,
    dryRun,
    domain,
  } = _parseArgs(args);

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return { analyzed: false, reason: `directory not found: ${root}` };
  }

  process.stderr.write(
    `[codebase-analyze] scanning ${root} (max_files=${maxFiles}, incremental=${incremental})\n`,
  );
  const sourceFiles = collectSourceFiles(root, languages, maxFiles, maxBytes);
  process.stderr.write(`[codebase-analyze] found ${sourceFiles.length} source files\n`);

  if (dryRun) {
    const langs = [
      ...new Set(
        sourceFiles.map((f) => EXT_TO_LANG[extname(f).toLowerCase()] ?? "?"),
      ),
    ];
    return {
      analyzed: false,
      dry_run: true,
      directory: root,
      source_files: sourceFiles.length,
      languages: langs,
    };
  }

  const store = deps.store;
  const existing = incremental ? loadExistingHashes(store) : new Map<string, [number, string]>();
  if (incremental) {
    process.stderr.write(`[codebase-analyze] loaded ${existing.size} existing file hashes\n`);
  }

  const {
    newCount,
    updatedCount,
    unchangedCount,
    totalEntities,
    totalRelationships,
    seenPaths,
    allAnalyses,
    fileContents,
  } = await _processFiles(sourceFiles, root, existing, incremental, domain, store);

  // Mark stale: memories for files no longer on disk
  const stale = _markDeleted(existing, seenPaths, store, incremental);

  // Phase 2: cross-file resolution, type references, communities
  const graphStats = _runGraphAnalysis(
    allAnalyses,
    fileContents,
    store,
    domain || "code",
  );

  process.stderr.write(
    `[codebase-analyze] done: ${newCount} new, ${updatedCount} updated, ` +
      `${unchangedCount} unchanged, ${stale} stale\n`,
  );

  return {
    analyzed: true,
    directory: root,
    source_files: sourceFiles.length,
    new: newCount,
    updated: updatedCount,
    unchanged: unchangedCount,
    stale_marked: stale,
    entities: totalEntities,
    relationships: totalRelationships,
    graph: graphStats,
    languages: [
      ...new Set(
        sourceFiles.map((f) => EXT_TO_LANG[extname(f).toLowerCase()] ?? "?"),
      ),
    ],
  };
}

function _markDeleted(
  existing: Map<string, [number, string]>,
  seenPaths: Set<string>,
  store: MemoryStore,
  incremental: boolean,
): number {
  if (!incremental) return 0;
  const deletedIds: number[] = [];
  for (const [path, [mid]] of existing) {
    if (!seenPaths.has(path)) deletedIds.push(mid);
  }
  return markStale(store, deletedIds);
}
