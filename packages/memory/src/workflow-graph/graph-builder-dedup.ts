/* eslint-disable @typescript-eslint/no-magic-numbers -- source: exact port of Python source; all numeric literals copied verbatim from cited Python file */
/**
 * Domain aggregation for the unified graph builder.
 *
 * Merges domains sharing a common group key (e.g., all "ai architect ..."
 * sub-paths) into a single aggregate profile, preventing visual clutter.
 * Pure business logic — no I/O.
 *
 * source: Cortex mcp_server/core/graph_builder_dedup.py
 */

// Words to strip from path-based domain names before grouping
const PATH_NOISE = new Set(
  "users documents mac mini de cl ment cle clement developments ios "
  + "personal bu business pipeline worktrees builds landing pages "
  + "aiprd website 008".split(" "), // source: Cortex graph_builder_dedup.py::_PATH_NOISE — observed filesystem noise words
);

/**
 * Extract a short root name for domain grouping.
 *
 * Strips filesystem noise, keeps first 2 meaningful words.
 */
export function domainGroupKey(label: string): string {
  const parts = label.toLowerCase().trim().split(/[\s/\-_]+/);
  const clean = parts.filter((p) => p && !PATH_NOISE.has(p) && p.length > 1);
  if (clean.length === 0) return label.trim().slice(0, 20);
  return clean.slice(0, 2).join(" ");
}

// ── resolveDomain stub ────────────────────────────────────────────────────
// The Python version imports from mcp_server.shared.domain_mapping which
// has no TS port yet. We provide a passthrough so the dedup logic compiles;
// the composition root can inject a real resolver via the exported type.

export type DomainResolver = (key: string) => string;

const _passThroughResolver: DomainResolver = (key) => key;

/**
 * Merge domains sharing the same group key into a single profile.
 *
 * Sums sessions, unions entry points / patterns, merges top tools and
 * feature activations. Returns {group_key: merged_profile}.
 *
 * @param allDomains - raw domain dict from the profiles store.
 * @param resolveDomain - optional domain canonicaliser. Defaults to
 *   passthrough when not injected.
 */
export function aggregateDomains(
  allDomains: Record<string, unknown>,
  resolveDomain: DomainResolver = _passThroughResolver,
): Record<string, Record<string, unknown>> {
  const groups = new Map<string, Array<[string, Record<string, unknown>]>>();

  for (const [key, dp] of Object.entries(allDomains)) {
    if (!dp) continue;
    const dpObj = dp as Record<string, unknown>;
    const resolved = resolveDomain(key);
    const gk =
      resolved !== key
        ? resolved
        : domainGroupKey(String(dpObj["label"] ?? key));
    if (!groups.has(gk)) groups.set(gk, []);
    const grpList = groups.get(gk);
    if (grpList !== undefined) grpList.push([key, dpObj]);
  }

  const merged: Record<string, Record<string, unknown>> = {};
  for (const [gk, members] of groups) {
    if (members.length === 1) {
      const first = members[0];
      if (first === undefined) continue;
      const [origKey, dp] = first;
      merged[gk] = { ...dp, _orig_keys: [origKey] };
      continue;
    }
    merged[gk] = mergeProfiles(gk, members);
  }

  // Drop trivial domains (< 2 sessions) to reduce noise
  // source: Cortex graph_builder_dedup.py::aggregate_domains session threshold
  return Object.fromEntries(
    Object.entries(merged).filter(([, v]) => Number(v["sessionCount"] ?? 0) >= 2),
  );
}

/** Merge multiple domain profiles into one aggregate profile. */
export function mergeProfiles(
  groupKey: string,
  members: Array<[string, Record<string, unknown>]>,
): Record<string, unknown> {
  const totalSessions = members.reduce(
    (s, [, dp]) => s + Number(dp["sessionCount"] ?? 0),
    0,
  );
  const maxConf = Math.max(...members.map(([, dp]) => Number(dp["confidence"] ?? 0)));
  const origKeys = members.map(([k]) => k);

  const entryPoints = unionEntries(members);
  const patterns = unionPatterns(members);
  const tools = mergeTools(members);
  const featMerged = mergeFeatures(members);
  const bridges = firstBridges(members);

  const prettyLabel = groupKey.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    label: prettyLabel,
    sessionCount: totalSessions,
    confidence: maxConf,
    entryPoints: entryPoints.slice(0, 8),
    recurringPatterns: patterns,
    toolPreferences: tools,
    featureActivations: featMerged,
    connectionBridges: bridges,
    _orig_keys: origKeys,
  };
}

function unionEntries(
  members: Array<[string, Record<string, unknown>]>,
): Record<string, unknown>[] {
  const seen = new Set<string>();
  const result: Record<string, unknown>[] = [];
  for (const [, dp] of members) {
    for (const ep of ((dp["entryPoints"] as Record<string, unknown>[]) ?? [])) {
      const pat = String(ep["pattern"] ?? "");
      if (!seen.has(pat)) {
        seen.add(pat);
        result.push(ep);
      }
    }
  }
  return result;
}

function unionPatterns(
  members: Array<[string, Record<string, unknown>]>,
): Record<string, unknown>[] {
  const seen = new Set<string>();
  const result: Record<string, unknown>[] = [];
  for (const [, dp] of members) {
    for (const rp of ((dp["recurringPatterns"] as Record<string, unknown>[]) ?? [])) {
      const pat = String(rp["pattern"] ?? "");
      if (!seen.has(pat)) {
        seen.add(pat);
        result.push(rp);
      }
    }
  }
  result.sort((a, b) => Number(b["frequency"] ?? 0) - Number(a["frequency"] ?? 0));
  return result.slice(0, 20);
}

function mergeTools(
  members: Array<[string, Record<string, unknown>]>,
): Record<string, Record<string, number>> {
  const tools: Record<string, { ratio: number; avgPerSession: number; _n: number }> = {};
  for (const [, dp] of members) {
    for (const [name, pref] of Object.entries(
      (dp["toolPreferences"] as Record<string, Record<string, number>>) ?? {},
    )) {
      if (!(name in tools)) {
        tools[name] = { ratio: 0, avgPerSession: 0, _n: 0 };
      }
      const entry = tools[name];
      if (entry === undefined) continue;
      entry.ratio += pref["ratio"] ?? 0;
      entry.avgPerSession += pref["avgPerSession"] ?? 0;
      entry._n += 1;
    }
  }
  const result: Record<string, Record<string, number>> = {};
  for (const [name, v] of Object.entries(tools)) {
    result[name] = {
      ratio: v._n > 1 ? v.ratio / v._n : v.ratio,
      avgPerSession: v._n > 1 ? v.avgPerSession / v._n : v.avgPerSession,
    };
  }
  return result;
}

function mergeFeatures(
  members: Array<[string, Record<string, unknown>]>,
): Record<string, number> {
  const feats: Record<string, number[]> = {};
  for (const [, dp] of members) {
    for (const [feat, w] of Object.entries(
      (dp["featureActivations"] as Record<string, number>) ?? {},
    )) {
      if (!(feat in feats)) feats[feat] = [];
      feats[feat]?.push(w);
    }
  }
  const result: Record<string, number> = {};
  for (const [k, vs] of Object.entries(feats)) {
    result[k] = vs.reduce((s, v) => s + v, 0) / vs.length;
  }
  return result;
}

function firstBridges(
  members: Array<[string, Record<string, unknown>]>,
): unknown[] {
  for (const [, dp] of members) {
    if (dp["connectionBridges"]) return dp["connectionBridges"] as unknown[];
  }
  return [];
}
