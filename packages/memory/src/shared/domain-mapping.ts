/**
 * Domain mapping — resolves paths, slugs, and hints to canonical domain names.
 *
 * Builds the mapping dynamically from git repos discovered on the filesystem.
 * No hardcoded domain list — git remote URLs are the structural invariant
 * (they survive renames, moves, worktree creation).
 *
 * Algorithm (Rejewski + Shannon):
 *   1. Discover git repos under ~/Developments
 *   2. Group related repos by shared remote-URL name prefix
 *   3. Build a slug decoder (encode known paths as slugs, match by prefix)
 *   4. Build a fragment index (all substrings of known names)
 *   5. Resolve: cwd → git_root → longest prefix match → canonical name
 *
 * Pure business logic — uses child_process only for `git remote get-url`.
 *
 * Port of: mcp_server/shared/domain_mapping.py
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface RepoInfo {
  fsPath: string;
  dirName: string;
  remoteName: string;
  canonical: string;
}

// ── Step 1: Discover git repos ──────────────────────────────────────────────

function getRemoteUrl(repoPath: string): string {
  try {
    return execSync(
      `git -C "${repoPath}" remote get-url origin`,
      { timeout: 3000, stdio: ["pipe", "pipe", "pipe"] },
    ).toString().trim();
  } catch {
    return "";
  }
}

function extractRepoName(url: string): string {
  if (!url) return "";
  let name = url.replace(/\/$/, "").split("/").pop() ?? "";
  if (name.endsWith(".git")) name = name.slice(0, -4);
  return name.toLowerCase();
}

function isGitDir(p: string): boolean {
  try {
    return statSync(join(p, ".git")).isDirectory();
  } catch {
    return false;
  }
}

function discoverRepos(devRoot: string): RepoInfo[] {
  const repos: RepoInfo[] = [];
  if (!existsSync(devRoot)) return repos;

  let items: string[];
  try {
    items = readdirSync(devRoot);
  } catch {
    return repos;
  }

  for (const name of items) {
    if (name.startsWith(".")) continue;
    const itemPath = join(devRoot, name);
    let st;
    try { st = statSync(itemPath); } catch { continue; }
    if (!st.isDirectory()) continue;

    if (isGitDir(itemPath)) {
      const remote = getRemoteUrl(itemPath);
      repos.push({
        fsPath: itemPath,
        dirName: name.toLowerCase(),
        remoteName: extractRepoName(remote) || name.toLowerCase(),
        canonical: "",
      });
    } else {
      // One level deeper for org dirs
      let subItems: string[];
      try { subItems = readdirSync(itemPath); } catch { continue; }
      for (const subName of subItems) {
        const subPath = join(itemPath, subName);
        try {
          if (!statSync(subPath).isDirectory()) continue;
        } catch { continue; }
        if (isGitDir(subPath)) {
          const remote = getRemoteUrl(subPath);
          repos.push({
            fsPath: subPath,
            dirName: subName.toLowerCase(),
            remoteName: extractRepoName(remote) || subName.toLowerCase(),
            canonical: "",
          });
        }
      }
    }
  }
  return repos;
}

// ── Step 2: Group repos by shared remote-name prefix ────────────────────────

function sharedPrefix(a: string, b: string): string {
  const partsA = a.split("-");
  const partsB = b.split("-");
  const common: string[] = [];
  for (let i = 0; i < Math.min(partsA.length, partsB.length); i++) {
    if (partsA[i] === partsB[i]) {
      common.push(partsA[i] as string);
    } else {
      break;
    }
  }
  const prefix = common.join("-");
  // Require prefix to be meaningful: at least 4 chars
  return prefix.length >= 4 ? prefix : "";
}

function groupRepos(repos: RepoInfo[]): Map<string, string> {
  const allNames = repos.map((r) => r.remoteName);
  const prefixGroups = new Map<string, Set<string>>();

  for (let i = 0; i < allNames.length; i++) {
    for (let j = i + 1; j < allNames.length; j++) {
      const prefix = sharedPrefix(allNames[i] ?? "", allNames[j] ?? "");
      if (prefix) {
        if (!prefixGroups.has(prefix)) prefixGroups.set(prefix, new Set());
        prefixGroups.get(prefix)!.add(allNames[i] ?? "").add(allNames[j] ?? "");
      }
    }
  }

  // Sort by prefix length descending (longest prefix wins)
  const sorted = Array.from(prefixGroups.entries()).sort(
    (a, b) => b[0].length - a[0].length,
  );

  const nameToCanonical = new Map<string, string>();
  for (const [prefix, members] of sorted) {
    for (const member of members) {
      if (!nameToCanonical.has(member)) {
        nameToCanonical.set(member, prefix);
      }
    }
  }

  // Assign canonical to repos and register dir_names
  for (const repo of repos) {
    const rn = repo.remoteName;
    if (nameToCanonical.has(rn)) {
      repo.canonical = nameToCanonical.get(rn) as string;
    } else {
      repo.canonical = rn;
      nameToCanonical.set(rn, rn);
    }
    if (repo.dirName !== rn && !nameToCanonical.has(repo.dirName)) {
      nameToCanonical.set(repo.dirName, repo.canonical);
    }
  }

  return nameToCanonical;
}

// ── Step 3: Build slug decoder ───────────────────────────────────────────────

function buildSlugIndex(repos: RepoInfo[]): Map<string, RepoInfo> {
  const index = new Map<string, RepoInfo>();
  for (const repo of repos) {
    const slug = repo.fsPath.replace(/\//g, "-").replace(/^-/, "").toLowerCase();
    index.set(slug, repo);
  }
  return index;
}

function matchSlug(slug: string, slugIndex: Map<string, RepoInfo>): RepoInfo | null {
  let clean = slug.replace(/^-+/, "").toLowerCase();
  if (clean.includes("--")) clean = clean.split("--")[0] ?? clean;
  if (clean.includes("-worktrees-")) clean = clean.slice(0, clean.indexOf("-worktrees-"));

  let best: RepoInfo | null = null;
  let bestLen = 0;
  for (const [knownSlug, repo] of slugIndex) {
    if (clean.startsWith(knownSlug) && knownSlug.length > bestLen) {
      best = repo;
      bestLen = knownSlug.length;
    }
  }
  return best;
}

// ── Step 4: Build fragment index ─────────────────────────────────────────────

function buildFragmentIndex(
  repos: RepoInfo[],
  _nameToCanonical: Map<string, string>,
): Map<string, string> {
  const fragments = new Map<string, [string, number]>(); // fragment → [canonical, length]

  for (const repo of repos) {
    const canonical = repo.canonical;
    for (const name of new Set([repo.dirName, repo.remoteName])) {
      const parts = name.split("-");
      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j <= parts.length; j++) {
          const fragment = parts.slice(i, j).join("-");
          if (fragment.length < 4) continue;
          const existing = fragments.get(fragment);
          if (!existing || fragment.length > existing[1]) {
            fragments.set(fragment, [canonical, fragment.length]);
          }
        }
      }
    }
  }

  const result = new Map<string, string>();
  for (const [k, [canonical]] of fragments) {
    result.set(k, canonical);
  }
  return result;
}

// ── Step 5: Git root resolution ──────────────────────────────────────────────

function gitRoot(path: string): string | null {
  try {
    return execSync(
      `git -C "${path}" rev-parse --show-toplevel`,
      { timeout: 3000, stdio: ["pipe", "pipe", "pipe"] },
    ).toString().trim();
  } catch {
    return null;
  }
}

// ── Registry (singleton cache) ───────────────────────────────────────────────

interface DomainRegistry {
  readonly repos: RepoInfo[];
  readonly nameToCanonical: Map<string, string>;
  readonly slugIndex: Map<string, RepoInfo>;
  readonly fragmentIndex: Map<string, string>;
  readonly pathToRepo: Map<string, RepoInfo>;
}

let _registry: DomainRegistry | null = null;

function buildRegistry(): DomainRegistry {
  if (_registry) return _registry;
  const devRoot = join(homedir(), "Developments");
  const repos = discoverRepos(devRoot);
  const nameToCanonical = groupRepos(repos);
  const slugIndex = buildSlugIndex(repos);
  const fragmentIndex = buildFragmentIndex(repos, nameToCanonical);
  const pathToRepo = new Map(repos.map((r) => [r.fsPath, r]));
  _registry = { repos, nameToCanonical, slugIndex, fragmentIndex, pathToRepo };
  return _registry;
}

/** Reset the registry cache (for tests). */
export function resetRegistry(): void {
  _registry = null;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve any input to a canonical domain name.
 *
 * Handles:
 * - Filesystem paths: /Users/cdeust/Developments/Cortex/mcp_server
 * - Project slugs: -Users-cdeust-Developments-Cortex
 * - Domain hints: 'cortex', 'ai-architect'
 * - Broken fragments: 'architect', 'builder', 'loop'
 */
export function resolveDomain(inputStr: string): string {
  if (!inputStr || !inputStr.trim()) return "";

  const registry = buildRegistry();
  const clean = inputStr.trim();

  // 1. Is it a filesystem path? → git_root → repo match
  if (clean.includes("/") && !clean.startsWith("-")) {
    const root = gitRoot(clean);
    if (root) {
      const repo = registry.pathToRepo.get(root);
      if (repo) return repo.canonical;
    }
    for (const repo of registry.repos) {
      if (clean.startsWith(repo.fsPath)) return repo.canonical;
    }
  }

  // 2. Is it a slug? (starts with - and looks path-like)
  if (clean.startsWith("-") && clean.length > 10) {
    const repo = matchSlug(clean, registry.slugIndex);
    if (repo) return repo.canonical;
  }

  // 3. Exact match against known names
  const lower = clean.toLowerCase();
  const exact = registry.nameToCanonical.get(lower);
  if (exact) return exact;

  // 4. Fragment match — longest known fragment that is a substring of input
  const exactFrag = registry.fragmentIndex.get(lower);
  if (exactFrag) return exactFrag;

  let bestFrag = "";
  let bestFragLen = 0;
  for (const [frag, canonical] of registry.fragmentIndex) {
    if (frag.length >= 4 && lower.includes(frag) && frag.length > bestFragLen) {
      bestFrag = canonical;
      bestFragLen = frag.length;
    }
  }
  if (bestFrag) return bestFrag;

  // 5. No match — strip known path prefixes for raw slugs
  if (clean.startsWith("-")) {
    let stripped = lower;
    for (const prefix of [
      "-users-cdeust-developments-",
      "-users-cdeust-documents-",
      "-users-cdeust-",
    ]) {
      if (stripped.startsWith(prefix)) {
        stripped = stripped.slice(prefix.length);
        break;
      }
    }
    if (stripped.includes("-worktrees-")) {
      stripped = stripped.slice(0, stripped.indexOf("-worktrees-"));
    }
    return stripped.includes("-") ? (stripped.split("-")[0] ?? lower) : (stripped || lower);
  }

  return lower;
}

/**
 * Resolve a working directory to a canonical domain.
 *
 * This is the primary domain resolution path (Shannon: cwd is the
 * minimum sufficient statistic for domain identity).
 *
 * Returns '' if the cwd does not belong to a *known* repo — callers
 * rely on empty-string to fall through to explicit domain hints.
 */
export function resolveCwd(cwd: string): string {
  if (!cwd) return "";
  const root = gitRoot(cwd);
  if (root) {
    const registry = buildRegistry();
    const repo = registry.pathToRepo.get(root);
    if (repo) return repo.canonical;
  }
  return "";
}
