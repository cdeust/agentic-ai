/**
 * Stage functions for seed_project — discovery extraction from a codebase.
 *
 * Each stage scans a specific aspect of the project directory and returns
 * a list of discovery dicts with title, content, and tags.
 *
 * Constants live in seed-project-constants.ts.
 *
 * Port of: mcp_server/handlers/seed_project_stages.py
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  CI_FILES,
  CONFIG_FILES,
  DOC_DIRS,
  DOC_GLOBS,
  ENTRY_POINT_NAMES,
  EXT_MAP,
  HEAT_BY_TYPE,
  IGNORE_DIRS,
} from "./seed-project-constants.js";

// ── Types ─────────────────────────────────────────────────────────────────

export interface Discovery {
  title: string;
  content: string;
  tags: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Determine initial heat based on discovery type tags.
 * Port of: mcp_server/handlers/seed_project_stages.py::heat_for_tags
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py:26
 */
export function heatForTags(tags: string[]): number {
  if (tags.includes("project-structure") || tags.includes("structural_summary")) {
    return HEAT_BY_TYPE["structural_summary"] ?? 0.9;
  }
  if (tags.includes("documentation")) return HEAT_BY_TYPE["documentation"] ?? 0.85;
  if (tags.includes("entry-point")) return HEAT_BY_TYPE["entry_point"] ?? 0.80;
  if (tags.includes("config") || tags.includes("project-setup")) {
    return HEAT_BY_TYPE["config"] ?? 0.70;
  }
  if (tags.includes("ci-cd") || tags.includes("devops")) return HEAT_BY_TYPE["ci_cd"] ?? 0.60;
  return 0.7; // source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py:38
}

/**
 * Read a file up to maxBytes. Returns empty string on error.
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py:41
 */
function safeRead(filePath: string, maxBytes: number = 65536): string {
  try {
    const buf = Buffer.alloc(maxBytes);
    const fd = fs.openSync(filePath, "r");
    try {
      const bytesRead = fs.readSync(fd, buf, 0, maxBytes, null);
      return buf.subarray(0, bytesRead).toString("utf-8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

/**
 * Yield all file paths under root, skipping IGNORE_DIRS and not following
 * symlinks. Mirrors os.walk(followlinks=False) with in-place pruning.
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py:50
 */
function* walkPruned(root: string): Generator<string> {
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dirPath = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isSymbolicLink()) continue; // followlinks=False
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        yield fullPath;
      }
    }
  }
}

/**
 * Detect primary programming languages from file extensions.
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py:66
 */
function detectLanguages(root: string): string[] {
  const extCounts: Record<string, number> = {};
  for (const filePath of walkPruned(root)) {
    const ext = path.extname(filePath).toLowerCase();
    const lang = EXT_MAP[ext];
    if (lang) {
      extCounts[lang] = (extCounts[lang] ?? 0) + 1;
    }
  }
  return Object.entries(extCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5) // source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py:73
    .map(([lang]) => lang);
}

/**
 * Return top-level directories and key files.
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py:76
 */
function topLevelLayout(root: string): string[] {
  const items: string[] = [];
  try {
    const entries = (fs.readdirSync(root, { withFileTypes: true }) as import("node:fs").Dirent[]).sort(
      (a, b) => a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".github") continue;
      if (IGNORE_DIRS.has(entry.name)) continue;
      const prefix = entry.isDirectory() ? "📁 " : "📄 ";
      items.push(`${prefix}${entry.name}`);
    }
  } catch {
    // PermissionError equivalent — skip
  }
  return items.slice(0, 30); // source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py:89
}

// ── Stages ────────────────────────────────────────────────────────────────

/**
 * Extract project config files.
 * Port of: mcp_server/handlers/seed_project_stages.py::stage_configs
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py:92
 */
export function stageConfigs(root: string, maxBytes: number): Discovery[] {
  const discoveries: Discovery[] = [];
  for (const name of CONFIG_FILES) {
    const p = path.join(root, name);
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) continue;
    const content = safeRead(p, maxBytes);
    if (content.trim()) {
      discoveries.push({
        title: `Project config: ${name}`,
        content: `# ${name}\n\n${content}`,
        tags: ["config", "project-setup", name.replace(".", "_")],
      });
    }
  }
  return discoveries;
}

/**
 * Harvest documentation files from the project root.
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py:110
 */
function harvestRootDocs(
  root: string,
  maxBytes: number,
): Array<Discovery & { _path?: string }> {
  const discoveries: Array<Discovery & { _path?: string }> = [];
  const seen = new Set<string>();

  // Expand glob patterns by listing root directory
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return discoveries;
  }

  for (const pattern of DOC_GLOBS) {
    // Simple glob: pattern ends with '*' means prefix match
    const prefix = pattern.endsWith("*") ? pattern.slice(0, -1) : pattern;
    for (const name of entries) {
      if (!name.startsWith(prefix)) continue;
      const p = path.join(root, name);
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) continue;
      if (seen.has(p)) continue;
      seen.add(p);
      const content = safeRead(p, maxBytes);
      if (content.trim()) {
        discoveries.push({
          title: `Documentation: ${name}`,
          content: `# ${name}\n\n${content}`,
          tags: ["documentation", "project-context"],
          _path: p,
        });
      }
    }
  }
  return discoveries;
}

/**
 * Harvest documentation from docs directories.
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py:131
 */
function harvestDocDirs(
  root: string,
  maxBytes: number,
  seen: Set<string>,
): Discovery[] {
  const discoveries: Discovery[] = [];
  const docExts = new Set([".md", ".rst", ".txt", ".adoc"]);

  for (const docDir of DOC_DIRS) {
    const d = path.join(root, docDir);
    if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) continue;

    let entries: string[] = [];
    try {
      entries = fs.readdirSync(d).sort();
    } catch {
      continue;
    }

    for (const name of entries) {
      const p = path.join(d, name);
      if (!fs.statSync(p).isFile()) continue;
      const ext = path.extname(p).toLowerCase();
      if (!docExts.has(ext)) continue;
      if (seen.has(p)) continue;
      seen.add(p);
      const content = safeRead(p, maxBytes);
      if (content.trim()) {
        discoveries.push({
          title: `Doc: ${path.relative(root, p)}`,
          content: `# ${name}\n\n${content}`,
          tags: [
            "documentation",
            docDir.includes("adr") ? "adr" : "docs",
          ],
        });
      }
    }
  }
  return discoveries;
}

/**
 * Harvest documentation files.
 * Port of: mcp_server/handlers/seed_project_stages.py::stage_docs
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py:164
 */
export function stageDocs(root: string, maxBytes: number): Discovery[] {
  const rootDocs = harvestRootDocs(root, maxBytes);
  const seen = new Set<string>(
    rootDocs.filter((d) => d._path).map((d) => d._path!),
  );
  const cleanDocs = rootDocs.map(({ _path: _, ...d }) => d as Discovery);
  const dirDocs = harvestDocDirs(root, maxBytes, seen);
  return [...cleanDocs, ...dirDocs].slice(0, 20); // source: cortex@ed33435 seed_project_stages.py:171
}

/**
 * Find and read entry point files.
 * Port of: mcp_server/handlers/seed_project_stages.py::stage_entry_points
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py:174
 */
export function stageEntryPoints(root: string, maxBytes: number): Discovery[] {
  const discoveries: Discovery[] = [];
  for (const filePath of walkPruned(root)) {
    // Skip dist-info/egg-info build metadata
    if (filePath.match(/\.(dist-info|egg-info)[/\\]/)) continue;
    const basename = path.basename(filePath);
    if (!ENTRY_POINT_NAMES.has(basename)) continue;
    const content = safeRead(filePath, maxBytes);
    if (content.trim()) {
      const rel = path.relative(root, filePath);
      discoveries.push({
        title: `Entry point: ${rel}`,
        content: `# Entry point: ${rel}\n\n\`\`\`\n${content}\n\`\`\``,
        tags: ["entry-point", "architecture"],
      });
    }
  }
  return discoveries.slice(0, 5); // source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py:192
}

/**
 * Scan a CI/CD directory for YAML workflow files.
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py:195
 */
function scanCicdDir(root: string, directory: string): Discovery[] {
  const found: Discovery[] = [];
  const yamlFiles: string[] = [];

  function collectYaml(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectYaml(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml"))) {
        yamlFiles.push(fullPath);
      }
    }
  }
  collectYaml(directory);

  for (const f of yamlFiles.slice(0, 3)) { // source: cortex@ed33435 seed_project_stages.py:199
    const content = safeRead(f, 32768); // source: cortex@ed33435 seed_project_stages.py:201
    if (content.trim()) {
      const rel = path.relative(root, f);
      found.push({
        title: `CI/CD: ${rel}`,
        content: `# CI/CD: ${rel}\n\n\`\`\`yaml\n${content}\n\`\`\``,
        tags: ["ci-cd", "devops"],
      });
    }
  }
  return found;
}

/**
 * Detect CI/CD configuration.
 * Port of: mcp_server/handlers/seed_project_stages.py::stage_cicd
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py:212
 */
export function stageCicd(root: string): Discovery[] {
  const found: Discovery[] = [];
  for (const pathStr of CI_FILES) {
    const p = path.join(root, pathStr);
    if (!fs.existsSync(p)) continue;

    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      found.push(...scanCicdDir(root, p));
    } else {
      const content = safeRead(p, 32768); // source: cortex@ed33435 seed_project_stages.py:224
      if (content.trim()) {
        found.push({
          title: `CI/CD: ${path.basename(p)}`,
          content: `# ${path.basename(p)}\n\n\`\`\`\n${content}\n\`\`\``,
          tags: ["ci-cd", "devops"],
        });
      }
    }
  }
  return found.slice(0, 5); // source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py:231
}

/**
 * Build a structural summary memory.
 * Port of: mcp_server/handlers/seed_project_stages.py::stage_structural_summary
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py:234
 */
export function stageStructuralSummary(root: string): Discovery {
  const layout = topLevelLayout(root);
  const languages = detectLanguages(root);
  const rootName = path.basename(root);

  const contentLines = [
    `# Project structure: ${rootName}`,
    `\n**Root:** \`${root}\``,
    `\n**Primary languages:** ${languages.join(", ") || "unknown"}`,
    "\n## Top-level layout",
    ...layout.map((item) => `- ${item}`),
  ];

  return {
    title: `Project structure: ${rootName}`,
    content: contentLines.join("\n"),
    tags: ["project-structure", "architecture", "seeded"],
  };
}

/**
 * Run all stages and return combined discovery list.
 * Port of: mcp_server/handlers/seed_project_stages.py::collect_all_discoveries
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py:253
 */
export function collectAllDiscoveries(root: string, maxBytes: number): Discovery[] {
  const discoveries: Discovery[] = [];
  discoveries.push(stageStructuralSummary(root));
  discoveries.push(...stageConfigs(root, maxBytes));
  discoveries.push(...stageDocs(root, maxBytes));
  discoveries.push(...stageEntryPoints(root, maxBytes));
  discoveries.push(...stageCicd(root));
  return discoveries;
}
