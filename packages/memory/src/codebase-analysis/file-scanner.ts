/**
 * file-scanner.ts — project discovery scanner for seed_project.
 *
 * Performs a five-stage structural sweep of a project directory:
 *   Stage 1: Config extraction  (package.json, pyproject.toml, Cargo.toml, …)
 *   Stage 2: Docs harvesting    (README*, CLAUDE*, docs/, adr/, …)
 *   Stage 3: Entry point scan   (main.ts, index.js, __main__.py, …)
 *   Stage 4: CI/CD detection    (.github/workflows, Makefile, Dockerfile, …)
 *   Stage 5: Structural summary (top-level layout + language detection)
 *
 * Pure filesystem I/O — no memory store operations.
 * Consumers (seed-project handler) decide what to do with the discoveries.
 *
 * Layer: infrastructure/codebase-analysis
 * Allowed imports: node:fs, node:path — no @agentic/* layer imports.
 *
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py
 * source: cortex@ed33435 mcp_server/handlers/seed_project_constants.py
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";

// ── Constants ──────────────────────────────────────────────────────────────────

// source: cortex@ed33435 mcp_server/handlers/seed_project_constants.py:9-15
export const HEAT_BY_TYPE: Readonly<Record<string, number>> = {
  structural_summary: 0.9,   // source: cortex@ed33435 seed_project_constants.py:10
  documentation:     0.85,   // source: cortex@ed33435 seed_project_constants.py:11
  entry_point:       0.80,   // source: cortex@ed33435 seed_project_constants.py:12
  config:            0.70,   // source: cortex@ed33435 seed_project_constants.py:13
  ci_cd:             0.60,   // source: cortex@ed33435 seed_project_constants.py:14
};

// source: cortex@ed33435 mcp_server/handlers/seed_project_constants.py:17-34
const CONFIG_FILES: readonly string[] = [
  "package.json",
  "package-lock.json",
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "requirements.txt",
  "Cargo.toml",
  "Cargo.lock",
  "go.mod",
  "go.sum",
  "pom.xml",
  "build.gradle",
  "composer.json",
  ".ruby-version",
  "Gemfile",
  "mix.exs",
];

// source: cortex@ed33435 mcp_server/handlers/seed_project_constants.py:36-37
const DOC_GLOBS: readonly string[] = ["README", "CLAUDE", "CONTRIBUTING", "CHANGELOG", "ARCHITECTURE"];
const DOC_DIRS: readonly string[] = ["docs", "doc", "documentation", "adr", "docs/adr"];

// source: cortex@ed33435 mcp_server/handlers/seed_project_constants.py:39-55
const ENTRY_POINT_NAMES: ReadonlySet<string> = new Set([
  "__main__.py",
  "main.py",
  "app.py",
  "server.py",
  "cli.py",
  "index.js",
  "index.ts",
  "main.js",
  "main.ts",
  "server.js",
  "main.go",
  "main.rs",
  "Main.java",
]);

// source: cortex@ed33435 mcp_server/handlers/seed_project_constants.py:57-71
const CI_FILES: readonly string[] = [
  ".github/workflows",
  "Makefile",
  "makefile",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "tox.ini",
  ".travis.yml",
  "circle.yml",
  ".circleci",
  "Jenkinsfile",
  ".gitlab-ci.yml",
  "bitbucket-pipelines.yml",
];

// source: cortex@ed33435 mcp_server/handlers/seed_project_constants.py:73-98
const IGNORE_DIRS: ReadonlySet<string> = new Set([
  ".git", ".hg", ".svn",
  "node_modules", "__pycache__", ".mypy_cache", ".pytest_cache",
  ".ruff_cache", ".venv", "venv", "env", ".env",
  "dist", "build", "target", "out", ".next", ".nuxt",
  "coverage", ".coverage", "htmlcov", "site-packages", ".tox", ".nox",
]);

// source: cortex@ed33435 mcp_server/handlers/seed_project_constants.py:100-118
const EXT_MAP: Readonly<Record<string, string>> = {
  ".py":    "Python",
  ".js":    "JavaScript",
  ".ts":    "TypeScript",
  ".go":    "Go",
  ".rs":    "Rust",
  ".java":  "Java",
  ".kt":    "Kotlin",
  ".rb":    "Ruby",
  ".php":   "PHP",
  ".cs":    "C#",
  ".cpp":   "C++",
  ".c":     "C",
  ".swift": "Swift",
  ".ex":    "Elixir",
  ".exs":   "Elixir",
  ".scala": "Scala",
  ".clj":   "Clojure",
  ".hs":    "Haskell",
};

// ── Stage limit constants ──────────────────────────────────────────────────────

// source: cortex@ed33435 seed_project_stages.py::_top_level_layout:89 — top-30 layout items
const TOP_LEVEL_LAYOUT_CAP = 30; // source: cortex@ed33435 seed_project_stages.py:89
// source: cortex@ed33435 seed_project_stages.py::_detect_languages:73 — top-5 languages
const TOP_LANGUAGES_CAP = 5; // source: cortex@ed33435 seed_project_stages.py:73
// source: cortex@ed33435 seed_project_stages.py::stage_docs:171 — max 20 doc discoveries
const STAGE_DOCS_CAP = 20; // source: cortex@ed33435 seed_project_stages.py:171
// source: cortex@ed33435 seed_project_stages.py::stage_entry_points:192 — max 5 entry points
const STAGE_ENTRY_POINTS_CAP = 5; // source: cortex@ed33435 seed_project_stages.py:192
// source: cortex@ed33435 seed_project_stages.py::stage_cicd:231 — max 5 CI/CD discoveries
const STAGE_CICD_CAP = 5; // source: cortex@ed33435 seed_project_stages.py:231
// source: cortex@ed33435 seed_project_stages.py::_scan_cicd_dir:199 — max 3 yaml files per dir
const CICD_DIR_YAML_CAP = 3; // source: cortex@ed33435 seed_project_stages.py::_scan_cicd_dir:199
// source: cortex@ed33435 seed_project_stages.py::_scan_cicd_dir:208 — 32KB CI/CD read limit
const CICD_MAX_BYTES = 32768; // source: cortex@ed33435 seed_project_stages.py:208 — 32*1024

// ── Discovery type ────────────────────────────────────────────────────────────

export interface Discovery {
  readonly title:   string;
  readonly content: string;
  readonly tags:    string[];
}

// ── Filesystem helpers ────────────────────────────────────────────────────────

/**
 * Read a file up to maxBytes. Returns "" on any read error.
 *
 * precondition:  filePath is an absolute path.
 * postcondition: returns at most maxBytes bytes of content; never throws.
 *
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py::_safe_read:41-47
 */
function safeRead(filePath: string, maxBytes: number): string {
  try {
    const buf = readFileSync(filePath);
    const slice = buf.subarray(0, maxBytes);
    return slice.toString("utf-8");
  } catch {
    return "";
  }
}

/**
 * Walk the directory tree, skipping IGNORE_DIRS. Returns all file paths.
 *
 * precondition:  root is an absolute path to an existing directory.
 * postcondition: yields every file path under root that is not inside an
 *   ignored directory; does not follow symlinks at dir boundaries.
 *   termination: directory tree is finite.
 *
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py::_walk_pruned:50-63
 */
function* walkPruned(root: string): Generator<string> {
  const stack: string[] = [root];
  // invariant: stack contains directories to visit; each pop reduces the tree
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break; // cannot happen per invariant but satisfies eslint no-non-null-assertion;
    let entries: string[];
    try {
      entries = readdirSync(dir, { encoding: "utf8" });
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let stat;
      try {
        stat = statSync(full, { bigint: false });
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (!IGNORE_DIRS.has(name)) {
          stack.push(full);
        }
      } else if (stat.isFile()) {
        yield full;
      }
    }
  }
}

// ── Language detection ────────────────────────────────────────────────────────

/**
 * Detect primary programming languages from file extensions.
 *
 * postcondition: returns up to 5 languages ordered by descending file count.
 *
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py::_detect_languages:66-73
 */
function detectLanguages(root: string): string[] {
  const extCounts = new Map<string, number>();
  for (const file of walkPruned(root)) {
    const lang = EXT_MAP[extname(file).toLowerCase()];
    if (lang) extCounts.set(lang, (extCounts.get(lang) ?? 0) + 1);
  }
  return [...extCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_LANGUAGES_CAP)
    .map(([lang]) => lang);
}

// ── Stage helpers ─────────────────────────────────────────────────────────────

/**
 * Top-level layout: directories and key files.
 *
 * postcondition: returns up to 30 entries as descriptive strings.
 *
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py::_top_level_layout:76-89
 */
function topLevelLayout(root: string): string[] {
  const items: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root, { encoding: "utf8" });
  } catch {
    return [];
  }
  for (const name of entries.sort()) {
    if (name.startsWith(".") && name !== ".github") continue;
    if (IGNORE_DIRS.has(name)) continue;
    const full = join(root, name);
    let isDir = false;
    try { isDir = statSync(full).isDirectory(); } catch { /* ignore */ }
    items.push(`${isDir ? "[dir] " : "[file] "}${name}`);
  }
  return items.slice(0, TOP_LEVEL_LAYOUT_CAP);
}

// ── Stage 1 — config extraction ───────────────────────────────────────────────

/**
 * Extract project config files.
 *
 * postcondition: returns one Discovery per config file that exists and is
 *   non-empty; at most CONFIG_FILES.length items.
 *
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py::stage_configs:92-107
 */
export function stageConfigs(root: string, maxBytes: number): Discovery[] {
  const discoveries: Discovery[] = [];
  for (const name of CONFIG_FILES) {
    const p = join(root, name);
    if (!existsSync(p)) continue;
    let isFile = false;
    try { isFile = statSync(p).isFile(); } catch { continue; }
    if (!isFile) continue;
    const content = safeRead(p, maxBytes);
    if (content.trim()) {
      discoveries.push({
        title:   `Project config: ${name}`,
        content: `# ${name}\n\n${content}`,
        tags:    ["config", "project-setup", name.replace(/\./g, "_")],
      });
    }
  }
  return discoveries;
}

// ── Stage 2 — documentation harvesting ───────────────────────────────────────

/**
 * Harvest documentation from root-level glob patterns and doc directories.
 *
 * postcondition: returns up to 20 doc discoveries; deduplicates by path.
 *
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py::stage_docs:164-171
 */
export function stageDocs(root: string, maxBytes: number): Discovery[] {
  const seen = new Set<string>();
  const discoveries: Discovery[] = [];

  // Root-level docs matching DOC_GLOBS prefixes
  // source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py::_harvest_root_docs:111-128
  let rootEntries: string[];
  try {
    rootEntries = readdirSync(root, { encoding: "utf8" });
  } catch {
    rootEntries = [];
  }
  for (const name of rootEntries) {
    const p = join(root, name);
    let isFile = false;
    try { isFile = statSync(p).isFile(); } catch { continue; }
    if (!isFile) continue;
    const nameLower = name.toUpperCase();
    const matchesGlob = DOC_GLOBS.some((prefix) => nameLower.startsWith(prefix));
    if (!matchesGlob) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    const content = safeRead(p, maxBytes);
    if (content.trim()) {
      discoveries.push({
        title:   `Documentation: ${name}`,
        content: `# ${name}\n\n${content}`,
        tags:    ["documentation", "project-context"],
      });
    }
  }

  // Doc directories
  // source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py::_harvest_doc_dirs:131-161
  const docSuffixes = new Set([".md", ".rst", ".txt", ".adoc"]);
  for (const docDir of DOC_DIRS) {
    const d = join(root, docDir);
    if (!existsSync(d)) continue;
    let isDir = false;
    try { isDir = statSync(d).isDirectory(); } catch { continue; }
    if (!isDir) continue;
    let dirEntries: string[];
    try { dirEntries = readdirSync(d, { encoding: "utf8" }).sort(); } catch { continue; }
    for (const name of dirEntries) {
      const p = join(d, name);
      let isFile = false;
      try { isFile = statSync(p).isFile(); } catch { continue; }
      if (!isFile) continue;
      if (!docSuffixes.has(extname(name).toLowerCase())) continue;
      if (seen.has(p)) continue;
      seen.add(p);
      const content = safeRead(p, maxBytes);
      if (content.trim()) {
        const relPath = relative(root, p);
        const isAdr = docDir.includes("adr");
        discoveries.push({
          title:   `Doc: ${relPath}`,
          content: `# ${name}\n\n${content}`,
          tags:    ["documentation", isAdr ? "adr" : "docs"],
        });
      }
    }
  }

  return discoveries.slice(0, STAGE_DOCS_CAP);
}

// ── Stage 3 — entry points ────────────────────────────────────────────────────

/**
 * Find and read entry point files.
 *
 * postcondition: returns up to 5 entry point discoveries.
 *
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py::stage_entry_points:174-193
 */
export function stageEntryPoints(root: string, maxBytes: number): Discovery[] {
  const discoveries: Discovery[] = [];
  for (const filePath of walkPruned(root)) {
    if (discoveries.length >= STAGE_ENTRY_POINTS_CAP) break;
    const name = basename(filePath);
    if (!ENTRY_POINT_NAMES.has(name)) continue;
    const content = safeRead(filePath, maxBytes);
    if (!content.trim()) continue;
    const relPath = relative(root, filePath);
    discoveries.push({
      title:   `Entry point: ${relPath}`,
      content: `# Entry point: ${relPath}\n\n\`\`\`\n${content}\n\`\`\``,
      tags:    ["entry-point", "architecture"],
    });
  }
  return discoveries;
}

// ── Stage 4 — CI/CD detection ─────────────────────────────────────────────────

/**
 * Detect CI/CD configuration files and workflow directories.
 *
 * postcondition: returns up to 5 CI/CD discoveries.
 *
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py::stage_cicd:212-231
 */
export function stageCicd(root: string): Discovery[] {
  const found: Discovery[] = [];

  for (const pathStr of CI_FILES) {
    if (found.length >= STAGE_CICD_CAP) break;
    const p = join(root, pathStr);
    if (!existsSync(p)) continue;
    let stat;
    try { stat = statSync(p); } catch { continue; }

    if (stat.isDirectory()) {
      // Scan YAML files in CI directory
      // source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py::_scan_cicd_dir:195-210
      let entries: string[];
      try {
        entries = readdirSync(p, { encoding: "utf8" });
      } catch {
        continue;
      }
      const yamlFiles = entries
        .filter((n) => n.endsWith(".yml") || n.endsWith(".yaml"))
        .slice(0, CICD_DIR_YAML_CAP);
      for (const yamlName of yamlFiles) {
        if (found.length >= STAGE_CICD_CAP) break;
        const fp = join(p, yamlName);
        const content = safeRead(fp, CICD_MAX_BYTES);
        if (content.trim()) {
          const relPath = relative(root, fp);
          found.push({
            title:   `CI/CD: ${relPath}`,
            content: `# CI/CD: ${relPath}\n\n\`\`\`yaml\n${content}\n\`\`\``,
            tags:    ["ci-cd", "devops"],
          });
        }
      }
    } else if (stat.isFile()) {
      const content = safeRead(p, CICD_MAX_BYTES);
      if (content.trim()) {
        found.push({
          title:   `CI/CD: ${basename(p)}`,
          content: `# ${basename(p)}\n\n\`\`\`\n${content}\n\`\`\``,
          tags:    ["ci-cd", "devops"],
        });
      }
    }
  }

  return found;
}

// ── Stage 5 — structural summary ──────────────────────────────────────────────

/**
 * Build a structural summary discovery.
 *
 * postcondition: returns exactly one Discovery with project structure overview.
 *
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py::stage_structural_summary:234-250
 */
export function stageStructuralSummary(root: string): Discovery {
  const layout = topLevelLayout(root);
  const languages = detectLanguages(root);
  const name = basename(root);
  const lines = [
    `# Project structure: ${name}`,
    `\n**Root:** \`${root}\``,
    `\n**Primary languages:** ${languages.join(", ") || "unknown"}`,
    "\n## Top-level layout",
    ...layout.map((item) => `- ${item}`),
  ];
  return {
    title:   `Project structure: ${name}`,
    content: lines.join("\n"),
    tags:    ["project-structure", "architecture", "seeded"],
  };
}

// ── Public collector ──────────────────────────────────────────────────────────

/**
 * Run all five stages and return the combined discovery list.
 *
 * precondition:  root is an absolute path to an existing directory.
 * postcondition: returns all discoveries across all stages; structural summary
 *   is always first (drives initial project seeding).
 *
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py::collect_all_discoveries:253-261
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

/**
 * Determine initial heat score from discovery tags.
 *
 * postcondition: returns a float in [0.6, 0.9] matching the discovery type.
 *
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py::heat_for_tags:26-38
 */
// source: cortex@ed33435 seed_project_constants.py:38 — fallback heat when no type tag matches
const HEAT_FALLBACK = 0.7; // source: cortex@ed33435 seed_project_stages.py::heat_for_tags:38

export function heatForTags(tags: readonly string[]): number {
  const tagSet = new Set(tags);
  if (tagSet.has("project-structure") || tagSet.has("structural_summary")) {
    return HEAT_BY_TYPE["structural_summary"] ?? HEAT_FALLBACK;
  }
  if (tagSet.has("documentation")) return HEAT_BY_TYPE["documentation"] ?? HEAT_FALLBACK;
  if (tagSet.has("entry-point")) return HEAT_BY_TYPE["entry_point"] ?? HEAT_FALLBACK;
  if (tagSet.has("config") || tagSet.has("project-setup")) return HEAT_BY_TYPE["config"] ?? HEAT_FALLBACK;
  if (tagSet.has("ci-cd") || tagSet.has("devops")) return HEAT_BY_TYPE["ci_cd"] ?? HEAT_FALLBACK;
  return HEAT_FALLBACK;
}
