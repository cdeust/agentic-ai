/**
 * list-domains.ts — Domain overview handler.
 *
 * Ports: handlers/list_domains.py (67 LOC, 1 function)
 *
 * Reads profiles.json and emits an overview row for every cognitive
 * domain Cortex has profiled, sorted by session count.
 *
 * Read-only. Takes no arguments. Latency <10ms.
 *
 * source: cortex@ed33435 mcp_server/handlers/list_domains.py
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Constants ──────────────────────────────────────────────────────────────

// source: cortex@ed33435 mcp_server/handlers/list_domains.py:handler — top-3 categories per domain
const TOP_CATEGORIES_LIMIT = 3;

// ── Schema ────────────────────────────────────────────────────────────────

export const schema = {
  title: "List domains",
  description:
    "Read profiles.json and emit an overview row for every cognitive " +
    "domain Cortex has profiled, sorted by session count. Per domain: " +
    "id, human label, sessionCount, confidence, lastActive, top-3 " +
    "work categories with ratios, and dominantMode from the session " +
    "shape. Read-only. Takes no arguments. Latency <10ms.",
  inputSchema: {
    type: "object",
    required: [],
    properties: {},
    additionalProperties: false,
  },
};

// ── Profile I/O ───────────────────────────────────────────────────────────

function loadProfiles(): Record<string, unknown> {
  const p = join(homedir(), ".claude", "methodology", "profiles.json");
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ── Handler ───────────────────────────────────────────────────────────────

export interface DomainOverview {
  id: string | null;
  label: string | null;
  sessionCount: number;
  confidence: number;
  lastActive: string | null;
  topCategories: Array<{ category: string; ratio: number }>;
  dominantMode: string | null;
}

export interface ListDomainsResult {
  domains: DomainOverview[];
  totalDomains: number;
  globalStyle: unknown;
}

/**
 * Return domain overview list sorted by session count.
 *
 * source: cortex@ed33435 mcp_server/handlers/list_domains.py:handler
 */
export async function listDomainsHandler(): Promise<ListDomainsResult> {
  const profiles = loadProfiles();
  const domainsMap = (profiles["domains"] ?? {}) as Record<string, Record<string, unknown>>;
  const domains: DomainOverview[] = [];

  for (const d of Object.values(domainsMap)) {
    const categories = (d["categories"] ?? {}) as Record<string, number>;
    const topCategories = Object.entries(categories)
      .sort(([, a], [, b]) => b - a)
      .slice(0, TOP_CATEGORIES_LIMIT)
      .map(([category, ratio]) => ({ category, ratio: ratio as number }));

    const sessionShape = d["sessionShape"] as Record<string, unknown> | undefined;
    domains.push({
      id: (d["id"] as string) ?? null,
      label: (d["label"] as string) ?? null,
      sessionCount: (d["sessionCount"] as number) ?? 0,
      confidence: (d["confidence"] as number) ?? 0,
      lastActive: (d["lastUpdated"] as string) ?? null,
      topCategories,
      dominantMode: sessionShape ? ((sessionShape["dominantMode"] as string) ?? null) : null,
    });
  }

  domains.sort((a, b) => b.sessionCount - a.sessionCount);

  return {
    domains,
    totalDomains: domains.length,
    globalStyle: profiles["globalStyle"] ?? null,
  };
}
