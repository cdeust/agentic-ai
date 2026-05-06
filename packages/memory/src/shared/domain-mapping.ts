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

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface RepoInfo {
  fsPath: string;
  dirName: string;
  remoteName: string;
  canonical: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Length of the ".git" suffix stripped from remote URLs. */
// source: cortex@ed33435 mcp_server/shared/domain_mapping.py:57-60 (_extract_repo_name)
const GIT_SUFFIX_LEN = 4; // ".git"

/**
 * Minimum number of characters a shared hyphen-prefix must have to be
 * treated as a meaningful family name.
 * source: cortex@ed33435 mcp_server/shared/domain_mapping.py:117-120 (_shared_prefix docstring)
 */
const MIN_PREFIX_LEN = 4;

/**
 * Minimum fragment length included in the fragment index.
 * source: cortex@ed33435 mcp_server/shared/domain_mapping.py:221-223 (_build_fragment_index)
 */
const MIN_FRAGMENT_LEN = 4;

/**
 * Minimum character length for a slug to be treated as a path-like slug
 * (avoids false-positive slug matching on very short strings).
 * source: cortex@ed33435 mcp_server/shared/domain_mapping.py:298 (resolve_domain)
 */
const MIN_SLUG_LEN = 10;

// ── Step 1: Discover git repos ──────────────────────────────────────────────

function getRemoteUrl(repoPath: string): string {
  // SEC-002 fix: argv-style invocation (shell:false). Previously interpolated
  // ${repoPath} into a shell string, which permitted command injection if a
  // discovered directory name contained shell metacharacters (the filesystem
  // legitimately allows ;, $, `, \n in directory names).
  // source: packages/memory/src/infrastructure/git-diff-exec.ts (canonical pattern)
  try {
    return execFileSync(
      "git",
      ["-C", repoPath, "remote", "get-url", "origin"],
      // source: cortex@ed33435 mcp_server/shared/domain_mapping.py:44 (timeout=3 seconds)
      { timeout: 3000, stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8", shell: false },
    ).toString().trim();
  } catch {
    return "";
  }
}

function extractRepoName(url: string): string {
  if (!url) return "";
  let name = url.replace(/\/$/, "").split("/").pop() ?? "";
  if (name.endsWith(".git")) name = name.slice(0, -GIT_SUFFIX_LEN);
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
  // Require prefix to be meaningful: at least MIN_PREFIX_LEN chars
  return prefix.length >= MIN_PREFIX_LEN ? prefix : "";
}

function groupRepos(repos: RepoInfo[]): Map<string, string> {
  const allNames = repos.map((r) => r.remoteName);
  const prefixGroups = new Map<string, Set<string>>();

  for (let i = 0; i < allNames.length; i++) {
    for (let j = i + 1; j < allNames.length; j++) {
      const prefix = sharedPrefix(allNames[i] ?? "", allNames[j] ?? "");
      if (prefix) {
        if (!prefixGroups.has(prefix)) prefixGroups.set(prefix, new Set());
        const group = prefixGroups.get(prefix);
        if (group) {
          group.add(allNames[i] ?? "").add(allNames[j] ?? "");
        }
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
          if (fragment.length < MIN_FRAGMENT_LEN) continue;
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
  // SEC-002 fix: argv-style invocation (shell:false). See getRemoteUrl above.
  try {
    return execFileSync(
      "git",
      ["-C", path, "rev-parse", "--show-toplevel"],
      // source: cortex@ed33435 mcp_server/shared/domain_mapping.py:236 (timeout=3 seconds)
      { timeout: 3000, stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8", shell: false },
    ).toString().trim();
  } catch {
    return null;
  }
}

// ── Registry (singleton cache) ───────────────────────────────────────────────

// source: cortex@ed33435 mcp_server/shared/domain_mapping.py:252-258 (DomainRegistry dataclass)
export interface DomainRegistry {
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
  if (clean.startsWith("-") && clean.length > MIN_SLUG_LEN) {
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
    if (frag.length >= MIN_FRAGMENT_LEN && lower.includes(frag) && frag.length > bestFragLen) {
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

// ── Test-only internals export ──────────────────────────────────────────────
// Exposed for SEC-002 regression tests (file-level, not part of the public API).
// source: packages/memory/__tests__/shared/domain-mapping-security.test.ts
export const _internalsForTest = {
  getRemoteUrl,
  gitRoot,
};
