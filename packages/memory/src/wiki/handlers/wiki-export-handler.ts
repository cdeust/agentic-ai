/**
 * Wiki Phase 10 — Pandoc-backed wiki page export.
 *
 * Exports a wiki page (or an ad-hoc markdown body) to:
 *   pdf  — via Pandoc → LaTeX → PDF
 *   tex  — Pandoc LaTeX source
 *   docx — Pandoc Word
 *   html — standalone Pandoc HTML
 *
 * Path validation uses the wiki_store readPage CWE-22 sanitizer.
 * Never shells out with user-controlled strings — every Pandoc arg
 * comes from a whitelist or is routed through a temp file.
 *
 * source: mcp_server/handlers/wiki_export.py (Cortex ed33435)
 */

import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(childProcess.execFile);

// source: mcp_server/handlers/wiki_export.py:31-35 (_ALLOWED_FORMATS)
const ALLOWED_FORMATS = {
  pdf:  { pandocTo: "pdf",    ext: "pdf",  engine: "pdflatex" as string | null },
  tex:  { pandocTo: "latex",  ext: "tex",  engine: null },
  docx: { pandocTo: "docx",   ext: "docx", engine: null },
  html: { pandocTo: "html5",  ext: "html", engine: null },
} as const;

type ExportFormat = keyof typeof ALLOWED_FORMATS;

// source: mcp_server/handlers/wiki_export.py:122-131 (_SAFE_FLAG_ALLOWLIST)
const SAFE_FLAG_ALLOWLIST = new Set([
  "--toc",
  "--number-sections",
  "--standalone",
  "--section-divs",
  "--shift-heading-level-by=1",
  "--shift-heading-level-by=-1",
  "--citeproc",
  "--biblatex",
]);

// source: mcp_server/handlers/wiki_export.py:164-165
const FM_KEY_RE = /^[A-Za-z_][\w-]{0,62}$/;
const FM_MAX_LINE = 1000; // source: mcp_server/handlers/wiki_export.py:165 (sanity cap for frontmatter lines)

// Frontmatter fence ("---") character count
// source: YAML specification (front-matter delimiters are exactly 3 dashes)
const FM_FENCE_LEN = 3;

// Frontmatter end offset including leading newline ("\n---")
// source: YAML specification + markdown front-matter convention
const FM_END_FENCE_LEN = 4;

// Pandoc stderr/stdout truncation limits in error responses
// source: mcp_server/handlers/wiki_export.py:356-357
const PANDOC_STDERR_CAP = 2000;
const PANDOC_STDOUT_CAP = 500; // source: mcp_server/handlers/wiki_export.py:357 (stdout truncation cap)

const META_KEYS_FOR_PANDOC = ["title", "subtitle", "author", "date", "abstract"] as const;

const MIME: Record<ExportFormat, string> = {
  pdf:  "application/pdf",
  tex:  "application/x-tex",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  html: "text/html",
};

export interface WikiExportArgs {
  readonly path?: string | null;
  readonly format?: string | null;
  readonly body?: string | null;
  readonly bibliography?: readonly string[] | null;
  readonly pandoc_args?: readonly string[] | null;
  readonly wiki_root?: string | null;
  [key: string]: unknown;
}

export type WikiExportResult =
  | {
      readonly ok: true;
      readonly format: string;
      readonly bytes: number;
      readonly mime: string;
      readonly content_base64: string;
      readonly bibliography_used: string[];
    }
  | { readonly error: string; readonly stderr?: string; readonly stdout?: string };

/**
 * Parse best-effort frontmatter from a markdown string.
 * source: mcp_server/handlers/wiki_export.py:168-198 (_split_frontmatter)
 */
function splitFrontmatter(markdown: string): [Record<string, string>, string] {
  if (!markdown.startsWith("---")) return [{}, markdown];
  const end = markdown.indexOf("\n---", FM_FENCE_LEN);
  if (end < 0) return [{}, markdown];
  const raw = markdown.slice(FM_FENCE_LEN, end).trim();
  const body = markdown.slice(end + FM_END_FENCE_LEN).trimStart();
  const fields: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    if (line.length > FM_MAX_LINE || !line.includes(":")) continue;
    const colon = line.indexOf(":");
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (!FM_KEY_RE.test(key)) continue;
    if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === "'" || value[0] === '"')) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }
  return [fields, body];
}

/**
 * Extract bibliography hints from frontmatter.
 * source: mcp_server/handlers/wiki_export.py:204-218 (_extract_bibliography_hint)
 */
function extractBibliographyHint(markdown: string): string[] {
  if (!markdown.startsWith("---")) return [];
  const end = markdown.indexOf("\n---", FM_FENCE_LEN);
  if (end < 0) return [];
  const fm = markdown.slice(FM_FENCE_LEN, end);
  const m = /^\s*bibliography:\s*\[(.*?)\]/m.exec(fm);
  if (!m) return [];
  return (m[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Resolve bib file paths within wiki/_bibliography/.
 * source: mcp_server/handlers/wiki_export.py:221-245 (_resolve_bibliography_paths)
 *
 * Precondition: wikiRoot is a valid path; hints are file-name strings.
 * Postcondition: returned paths are absolute, exist, and lie within _bibliography/.
 */
function resolveBibliographyPaths(wikiRoot: string, hints: string[]): string[] {
  const resolved: string[] = [];
  const bibRoot = path.resolve(wikiRoot, "_bibliography");
  if (!fs.existsSync(bibRoot)) return [];
  for (const hint of hints) {
    let rel = hint.startsWith("_bibliography/") ? hint.slice("_bibliography/".length) : hint;
    if (!rel.endsWith(".bib") || rel.includes("/")) continue;
    const target = path.resolve(bibRoot, rel);
    try {
      const realTarget = fs.realpathSync(target);
      const realBibRoot = fs.realpathSync(bibRoot);
      if (!realTarget.startsWith(realBibRoot + path.sep) && realTarget !== realBibRoot) continue;
      if (fs.existsSync(realTarget)) resolved.push(realTarget);
    } catch {
      // ignore
    }
  }
  return resolved;
}

function filterPandocArgs(args: readonly string[] | null | undefined): string[] {
  if (!args) return [];
  return args.filter((a) => SAFE_FLAG_ALLOWLIST.has(a));
}

function which(cmd: string): string | null {
  try {
    const result = childProcess.execFileSync("which", [cmd], { encoding: "utf-8" }).trim();
    return result || null;
  } catch {
    return null;
  }
}

/**
 * Wiki export handler.
 *
 * Precondition:  pandoc is installed on PATH; for PDF, a LaTeX engine too.
 *   wikiRoot is set when reading pages from disk.
 * Postcondition: on success, returns base64-encoded artifact, format,
 *   mime type, byte size, and list of bib files used.
 *   On failure, returns {error: string}.
 *   Never raises.
 *
 * source: mcp_server/handlers/wiki_export.py:248-384
 */
export async function wikiExportHandler(
  args: WikiExportArgs,
  readPageFn: (relPath: string) => Promise<string | null>,
): Promise<WikiExportResult> {
  const fmt = (args.format ?? "pdf") as string;
  if (!(fmt in ALLOWED_FORMATS)) {
    return { error: `unsupported format: ${JSON.stringify(fmt)}` };
  }
  const fmtKey = fmt as ExportFormat;
  const meta = ALLOWED_FORMATS[fmtKey];

  const pandoc = which("pandoc");
  if (!pandoc) {
    return {
      error:
        "pandoc is not installed — install it first (brew install pandoc on macOS; " +
        "apt install pandoc on Linux). For PDF you also need a LaTeX engine.",
    };
  }

  if (fmtKey === "pdf") {
    const engines = ["pdflatex", "xelatex", "lualatex", "tectonic"];
    if (!engines.some((e) => which(e) !== null)) {
      return {
        error:
          "pandoc is installed but no LaTeX engine found (tried: " +
          engines.join(", ") +
          "). Install: brew install --cask basictex (macOS) or apt install texlive-xetex (Linux).",
      };
    }
  }

  // Read source body
  let markdown: string;
  if (typeof args.body === "string") {
    markdown = args.body;
  } else if (typeof args.path === "string") {
    const content = await readPageFn(args.path);
    if (content === null) return { error: `page not found: ${args.path}` };
    markdown = content;
  } else {
    return { error: "path or body is required" };
  }

  const wikiRoot = typeof args.wiki_root === "string" && args.wiki_root
    ? args.wiki_root
    : process.cwd();

  let bibHints = (args.bibliography as string[] | null | undefined) ?? extractBibliographyHint(markdown);
  if (!bibHints.length) {
    const bibDir = path.join(wikiRoot, "_bibliography");
    if (fs.existsSync(bibDir)) {
      try {
        bibHints = fs.readdirSync(bibDir).filter((n) => n.endsWith(".bib"));
      } catch { bibHints = []; }
    }
  }
  const bibFiles = resolveBibliographyPaths(wikiRoot, bibHints);

  const [fm, bodyOnly] = splitFrontmatter(markdown);

  // Use a temp dir to avoid any user-controlled path injection
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-export-"));
  try {
    const srcPath = path.join(tmpDir, "page.md");
    const outPath = path.join(tmpDir, `out.${meta.ext}`);
    fs.writeFileSync(srcPath, bodyOnly, "utf-8");

    const cmd: string[] = [
      pandoc, srcPath, "-o", outPath,
      "--from", "markdown-yaml_metadata_block",
      "--to", meta.pandocTo,
      "--standalone",
    ];

    for (const key of META_KEYS_FOR_PANDOC) {
      if (fm[key]) cmd.push("--metadata", `${key}=${fm[key]}`);
    }
    if (bibFiles.length) {
      cmd.push("--citeproc");
      for (const bf of bibFiles) cmd.push("--bibliography", bf);
    }
    if (meta.engine) cmd.push(`--pdf-engine=${meta.engine}`);
    cmd.push(...filterPandocArgs(args.pandoc_args));

    try {
      const pandocBin = cmd[0] ?? pandoc;
      await execFile(pandocBin, cmd.slice(1), {
        cwd: tmpDir,
        timeout: 90_000, // source: mcp_server/handlers/wiki_export.py:341 (90s Pandoc timeout)
        env: { ...process.env },
      });
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      if (e.message?.includes("ETIMEDOUT") || e.message?.includes("timeout")) {
        return { error: "pandoc timed out after 90s" };
      }
      return {
        error: "pandoc exited non-zero",
        stderr: (e.stderr ?? "").slice(0, PANDOC_STDERR_CAP), // source: mcp_server/handlers/wiki_export.py:356 (stderr cap)
        stdout: (e.stdout ?? "").slice(0, PANDOC_STDOUT_CAP),  // source: mcp_server/handlers/wiki_export.py:357 (stdout cap)
      };
    }

    if (!fs.existsSync(outPath)) {
      return { error: "pandoc did not produce an output file" };
    }

    const data = fs.readFileSync(outPath);
    return {
      ok: true,
      format: fmt,
      bytes: data.length,
      mime: MIME[fmtKey],
      content_base64: data.toString("base64"),
      bibliography_used: bibFiles.map((p) => path.basename(p)),
    };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
