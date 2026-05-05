/**
 * Persistence layer for methodology profiles.
 *
 * D5 fix (Phase 1 fragility sweep): profiles are now split into one JSON file
 * per domain under ~/.claude/methodology/domains/<domain-id>.json, with a
 * top-level ~/.claude/methodology/index.json listing domain ids + the
 * small globals (version, updatedAt, globalStyle).
 *
 * Before this change every record_session_end fully read and fully
 * rewrote a single profiles.json containing every domain's full profile.
 * Per Thompson's audit: at 1000 domains that's ~10 MB of write amplification
 * per session end — unacceptable as the system scales.
 *
 * Public API:
 *   loadProfiles()            - unified v2 dict (backwards compatible)
 *   saveProfiles(profiles)    - splits into per-domain files + index
 *   loadProfile(domainId)     - lazy single-domain load
 *   saveProfile(domainId, p)  - targeted write — ONLY touches one file
 *
 * Migration: on first call after upgrade, if a legacy single-file
 * profiles.json exists, it is split into per-domain files and the
 * legacy file is renamed to profiles.json.v1_backup.
 *
 * Layer: INFRASTRUCTURE — file I/O only, no core imports.
 * source: Cortex mcp_server/infrastructure/profile_store.py
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { METHODOLOGY_DIR, PROFILES_PATH } from "./config.js";
import { ensureDir, readJson, writeJson } from "./file-io.js";

// Per-domain split layout. Sibling files rather than nested so index.json
// can act as the cheap "list all domains" read without touching any
// per-domain file. See ADR-0045 §R2 (bounded I/O per operation).
// source: Cortex mcp_server/infrastructure/profile_store.py — DOMAINS_DIR = METHODOLOGY_DIR / "domains"
const DOMAINS_DIR = path.join(METHODOLOGY_DIR, "domains");

// source: Cortex mcp_server/infrastructure/profile_store.py — INDEX_PATH = METHODOLOGY_DIR / "index.json"
const INDEX_PATH = path.join(METHODOLOGY_DIR, "index.json");

// source: Cortex mcp_server/infrastructure/profile_store.py — LEGACY_BACKUP_PATH
const LEGACY_BACKUP_PATH = PROFILES_PATH + ".v1_backup";

/** Unified v2 profiles dict shape. */
export interface ProfilesDoc {
  version: number;
  updatedAt: string | null;
  globalStyle: unknown | null;
  domains: Record<string, unknown>;
}

/** Index file shape. */
interface IndexDoc {
  version: number;
  updatedAt: string | null;
  globalStyle: unknown | null;
  domain_ids: string[];
}

// source: Cortex mcp_server/infrastructure/profile_store.py:empty_profiles
export function emptyProfiles(): ProfilesDoc {
  return { version: 2, updatedAt: null, globalStyle: null, domains: {} };
}

// source: Cortex mcp_server/infrastructure/profile_store.py:_empty_index
function _emptyIndex(): IndexDoc {
  return {
    version: 2,
    updatedAt: null,
    globalStyle: null,
    domain_ids: [],
  };
}

// source: Cortex mcp_server/infrastructure/profile_store.py:_now_iso
function _nowIso(): string {
  return new Date().toISOString().replace("+00:00", "Z");
}

/**
 * Per-domain file path. domainId is used verbatim — callers upstream
 * are responsible for producing safe identifiers. We still guard against
 * path traversal here defensively.
 *
 * precondition:  domainId is a non-empty string.
 * postcondition: returns an absolute path under DOMAINS_DIR.
 *   throws if domainId contains "/" or ".." or "\0".
 *
 * source: Cortex mcp_server/infrastructure/profile_store.py:_domain_path
 */
function _domainPath(domainId: string): string {
  if (domainId.includes("/") || domainId.includes("..") || domainId.includes("\x00")) {
    throw new Error(`unsafe domainId: ${JSON.stringify(domainId)}`);
  }
  return path.join(DOMAINS_DIR, `${domainId}.json`);
}

/**
 * If a legacy single-file profiles.json exists, split it.
 *
 * Returns true if a migration happened. Safe to call repeatedly — it's
 * a no-op once the legacy file has been renamed.
 *
 * source: Cortex mcp_server/infrastructure/profile_store.py:_migrate_legacy_if_present
 */
function _migrateLegacyIfPresent(): boolean {
  if (!fs.existsSync(PROFILES_PATH)) {
    return false;
  }
  const legacy = readJson(PROFILES_PATH);
  if (legacy === null || typeof legacy !== "object" || Array.isArray(legacy)) {
    return false;
  }
  const legacyDoc = legacy as Record<string, unknown>;
  const domains = legacyDoc["domains"];
  if (domains === null || typeof domains !== "object" || Array.isArray(domains)) {
    return false;
  }
  const domainsObj = domains as Record<string, unknown>;

  // Write each domain to its own file and build an index. This is one
  // bounded bulk operation per upgrade; subsequent session ends only
  // touch a single per-domain file.
  ensureDir(DOMAINS_DIR);
  for (const [domainId, profile] of Object.entries(domainsObj)) {
    if (typeof domainId === "string" && profile !== null && typeof profile === "object") {
      try {
        writeJson(_domainPath(domainId), profile);
      } catch {
        // Skip ids that fail the safety guard — they will surface
        // at loadProfile time if something depends on them.
        continue;
      }
    }
  }

  const index: IndexDoc = {
    version: typeof legacyDoc["version"] === "number" ? legacyDoc["version"] : 2,
    updatedAt: typeof legacyDoc["updatedAt"] === "string" ? legacyDoc["updatedAt"] : null,
    globalStyle: legacyDoc["globalStyle"] ?? null,
    domain_ids: Object.keys(domainsObj)
      .filter((d) => typeof d === "string" && !d.includes("/"))
      .sort(),
  };
  writeJson(INDEX_PATH, index);
  fs.renameSync(PROFILES_PATH, LEGACY_BACKUP_PATH);
  return true;
}

/**
 * Return the on-disk index, triggering legacy migration if needed.
 *
 * source: Cortex mcp_server/infrastructure/profile_store.py:_ensure_index
 */
function _ensureIndex(): IndexDoc {
  _migrateLegacyIfPresent();
  const idx = readJson(INDEX_PATH);
  if (idx !== null && typeof idx === "object" && !Array.isArray(idx)) {
    const doc = idx as Record<string, unknown>;
    if (!("version" in doc)) doc["version"] = 2;
    if (!("domain_ids" in doc)) doc["domain_ids"] = [];
    return doc as unknown as IndexDoc;
  }
  return _emptyIndex();
}

/**
 * Lazy single-domain load — O(1) file reads, never touches other domains.
 *
 * precondition:  domainId is the canonical domain identifier.
 * postcondition: returns the domain profile dict if the file exists;
 *   returns null if the domain is unknown.
 *   triggers the legacy migration on first access if needed.
 *
 * source: Cortex mcp_server/infrastructure/profile_store.py:load_profile
 */
export function loadProfile(domainId: string): unknown | null {
  _ensureIndex();
  try {
    const p = _domainPath(domainId);
    return readJson(p);
  } catch {
    return null;
  }
}

/**
 * Load all profiles, reassembled into the legacy v2 dict shape.
 *
 * Backwards-compatible: callers that expect profiles.domains[id]
 * keep working. Internally: O(D) reads where D is the number of domains,
 * once per call.
 *
 * source: Cortex mcp_server/infrastructure/profile_store.py:load_profiles
 */
export function loadProfiles(): ProfilesDoc {
  const idx = _ensureIndex();
  const domains: Record<string, unknown> = {};
  for (const domainId of idx.domain_ids) {
    const profile = loadProfile(domainId);
    if (profile !== null) {
      domains[domainId] = profile;
    }
  }
  return {
    version: typeof idx.version === "number" ? idx.version : 2,
    updatedAt: idx.updatedAt ?? null,
    globalStyle: idx.globalStyle ?? null,
    domains,
  };
}

/**
 * Save a single domain's profile — does NOT touch other domains' files.
 *
 * postcondition:
 *   - <domains_dir>/<domainId>.json is rewritten.
 *   - index.json is updated only if domainId is new.
 *   - index.json.updatedAt is refreshed.
 *   - mtime of OTHER per-domain files is unchanged.
 *
 * precondition:
 *   - domainId is non-empty and contains no path-separator chars.
 *   - profile is a serialisable object.
 *
 * source: Cortex mcp_server/infrastructure/profile_store.py:save_profile
 */
export function saveProfile(domainId: string, profile: unknown): void {
  ensureDir(DOMAINS_DIR);
  writeJson(_domainPath(domainId), profile);

  const idx = _ensureIndex();
  const domainIds = [...idx.domain_ids];
  if (!domainIds.includes(domainId)) {
    domainIds.push(domainId);
    domainIds.sort();
  }
  idx.domain_ids = domainIds;
  idx.updatedAt = _nowIso();
  writeJson(INDEX_PATH, idx);
}

/**
 * Save all profiles — splits into per-domain files + index.
 *
 * Backwards-compatible with the legacy whole-dict API.
 *
 * source: Cortex mcp_server/infrastructure/profile_store.py:save_profiles
 */
export function saveProfiles(profiles: ProfilesDoc): void {
  ensureDir(DOMAINS_DIR);
  profiles.updatedAt = _nowIso();

  const domains: Record<string, unknown> =
    profiles.domains !== null &&
    typeof profiles.domains === "object" &&
    !Array.isArray(profiles.domains)
      ? (profiles.domains as Record<string, unknown>)
      : {};

  for (const [domainId, profile] of Object.entries(domains)) {
    if (
      typeof domainId !== "string" ||
      profile === null ||
      typeof profile !== "object"
    ) {
      continue;
    }
    try {
      writeJson(_domainPath(domainId), profile);
    } catch {
      continue;
    }
  }

  const index: IndexDoc = {
    version: typeof profiles.version === "number" ? profiles.version : 2,
    updatedAt: profiles.updatedAt,
    globalStyle: profiles.globalStyle ?? null,
    domain_ids: Object.keys(domains)
      .filter((d) => typeof d === "string" && !d.includes("/"))
      .sort(),
  };
  writeJson(INDEX_PATH, index);
}
