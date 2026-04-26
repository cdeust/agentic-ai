/**
 * Wiki filesystem store — authoring primitives, never destructive.
 *
 * Operations:
 *   readPage       return the raw markdown or null if missing
 *   writePage      atomic write in create/append/replace modes
 *   appendSection  append text under a named ## Section
 *   listPages      enumerate pages, optionally filtered by kind
 *   nextAdrNumber  find the next free ADR sequence number
 *
 * Never deletes pages. Never regenerates content. The only file that may
 * be overwritten by regeneration is .generated/INDEX.md.
 *
 * Path sanitization follows the CWE-22 pattern used in the Python source
 * (commonpath check). This is the TS equivalent of the CodeQL-recognized
 * sanitizer from wiki_store.py.
 *
 * source: mcp_server/infrastructure/wiki_store.py
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { PAGE_KINDS } from "../layout.js";
import type { WikiKind } from "../types.js";
import { WikiExists, WikiMissing } from "../types.js";
import type { WriteResult } from "../types.js";

// ── Path sanitization (CWE-22) ────────────────────────────────────────────

/**
 * Resolve relPath against root with CWE-22 sanitization.
 *
 * Four layers:
 *   1. Reject empty and null-byte paths.
 *   2. Reject absolute paths.
 *   3. Resolve both root and target.
 *   4. Confirm the resolved target lies under the resolved root.
 *
 * source: wiki_store.py::_safe_join (CodeQL py/path-injection pattern)
 */
function safeJoin(root: string, relPath: string): string {
  if (!relPath || relPath.includes("\x00")) {
    throw new Error("invalid wiki path: empty or contains null byte");
  }
  if (path.isAbsolute(relPath)) {
    throw new Error(`absolute paths are not allowed: ${JSON.stringify(relPath)}`);
  }

  const rootResolved = fs.realpathSync(root);
  let candidate: string;
  try {
    candidate = fs.realpathSync(path.join(rootResolved, relPath));
  } catch {
    // realpathSync throws if the path doesn't exist; build the path manually
    candidate = path.resolve(rootResolved, relPath);
  }

  // CommonPath check — equivalent to Python's os.path.commonpath
  const rel = path.relative(rootResolved, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`path escapes wiki root: ${JSON.stringify(relPath)}`);
  }

  return candidate;
}

// ── Core operations ───────────────────────────────────────────────────────

/**
 * Return the raw markdown content of a wiki page, or null if not found.
 */
export function readPage(root: string, relPath: string): string | null {
  if (!relPath || relPath.includes("\x00") || path.isAbsolute(relPath)) {
    return null;
  }
  let fullPath: string;
  try {
    fullPath = safeJoin(root, relPath);
  } catch {
    return null;
  }
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, "utf-8");
}

function atomicWriteString(safePath: string, content: string): number {
  const dir = path.dirname(safePath);
  if (dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = safePath + ".tmp";
  const data = Buffer.from(content, "utf-8");
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, safePath);
  return data.byteLength;
}

/**
 * Write a page atomically.
 *
 * * create  — raises WikiExists if the file already exists.
 * * replace — overwrites regardless.
 * * append  — appends the content to the existing file (with a
 *             separating blank line), raises WikiMissing if file missing.
 */
export function writePage(
  root: string,
  relPath: string,
  content: string,
  mode: string = "create",
): WriteResult {
  const safePath = safeJoin(root, relPath);
  const existed = fs.existsSync(safePath);

  let written: number;

  if (mode === "create") {
    if (existed) throw new WikiExists(relPath);
    written = atomicWriteString(safePath, content);
  } else if (mode === "replace") {
    written = atomicWriteString(safePath, content);
  } else if (mode === "append") {
    if (!existed) throw new WikiMissing(relPath);
    let current = fs.readFileSync(safePath, "utf-8");
    if (current && !current.endsWith("\n")) current += "\n";
    let merged = current + "\n" + content;
    if (!merged.endsWith("\n")) merged += "\n";
    written = atomicWriteString(safePath, merged);
  } else {
    throw new Error(`unknown write mode: ${mode}`);
  }

  return { path: relPath, mode, created: !existed, bytes_written: written };
}

/**
 * Append text under a ## heading section, creating it if missing.
 */
export function appendSection(
  root: string,
  relPath: string,
  heading: string,
  content: string,
): WriteResult {
  const safePath = safeJoin(root, relPath);
  if (!fs.existsSync(safePath)) throw new WikiMissing(relPath);

  let current = fs.readFileSync(safePath, "utf-8");
  const headingLine = `## ${heading}`;
  let merged: string;

  if (current.includes(headingLine)) {
    if (!current.endsWith("\n")) current += "\n";
    merged = `${current}\n${content}\n`;
  } else {
    if (current && !current.endsWith("\n")) current += "\n";
    merged = `${current}\n${headingLine}\n\n${content}\n`;
  }

  const written = atomicWriteString(safePath, merged);
  return { path: relPath, mode: "append-section", created: false, bytes_written: written };
}

/**
 * Enumerate authored pages relative to the wiki root.
 *
 * Skips .generated/. If kind is supplied, only returns pages under
 * <root>/<kind>/. Output is sorted for determinism.
 */
export function listPages(root: string, kind?: WikiKind | null): string[] {
  if (!fs.existsSync(root)) return [];
  const kinds = kind ? [kind] : [...PAGE_KINDS];
  const results: string[] = [];

  for (const k of kinds) {
    if (!(PAGE_KINDS as readonly string[]).includes(k)) continue;
    const kindDir = path.join(root, k);
    if (!fs.existsSync(kindDir)) continue;
    walkMd(kindDir, root, results);
  }

  return results.sort();
}

function walkMd(dir: string, root: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMd(full, root, out);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(path.relative(root, full).replace(/\\/g, "/"));
    }
  }
}

/**
 * Return the next free ADR sequence number (1-based).
 */
export function nextAdrNumber(root: string): number {
  const pages = listPages(root, "adr");
  let maxSeen = 0;
  for (const rel of pages) {
    const name = rel.split("/").pop() ?? "";
    const head = name.split("-")[0] ?? "";
    const num = parseInt(head, 10);
    if (!isNaN(num) && num > maxSeen) maxSeen = num;
  }
  return maxSeen + 1;
}

/**
 * Remove old {id}-{slug}.md files that have a {slug}.md counterpart.
 */
export function cleanupIdPrefixedPages(root: string): number {
  const notesDir = path.join(root, "notes");
  if (!fs.existsSync(notesDir)) return 0;

  const slugFiles = new Set<string>();
  for (const entry of fs.readdirSync(notesDir)) {
    if (entry.endsWith(".md") && !/^\d+-/.test(entry)) slugFiles.add(entry);
  }

  let removed = 0;
  for (const entry of fs.readdirSync(notesDir)) {
    const m = /^(\d+)-(.+)$/.exec(entry);
    if (m && slugFiles.has(m[2]!)) {
      fs.unlinkSync(path.join(notesDir, entry));
      removed++;
    }
  }
  return removed;
}
