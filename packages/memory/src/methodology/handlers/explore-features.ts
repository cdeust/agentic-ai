/**
 * Handler for the explore_features tool — interpretability exploration.
 *
 * Modes: features, attribution, persona, crosscoder.
 *
 * OWNERSHIP DECISION (Bateson/methodology worktree):
 *   explore_features.py is owned by THIS worktree (port/cortex-methodology).
 *   Rationale: the four modes (features, attribution, persona, crosscoder)
 *   all operate on the cognitive profile data structure and the feature
 *   dictionary that lives in the methodology engine. The graph-navigation
 *   worktree does NOT need this handler — it navigates the memory graph, not
 *   the cognitive-profile feature space. The only shared artifact is
 *   SIGNAL_NAMES / D from attribution-pipeline.ts, which both worktrees can
 *   import from this package.
 *
 *   If port/cortex-graph-navigation later needs interpretability views of its
 *   own graph nodes, it should import the types from this package rather than
 *   re-implementing. Document this in graph-navigation's MISSION.md.
 *
 * source: mcp_server/handlers/explore_features.py
 */

import type { DomainProfile, PersonaVector, ProfilesStore } from "../types.js";
import { PERSONA_NUMERIC_DIMENSIONS } from "../types.js";
import {
  buildPersonaVector,
  composePersonas,
  personaDrift,
} from "../cognitive-profile.js";
import { traceAttribution } from "../attribution-pipeline.js";
import { detectPersistentFeatures, compareFeatureProfiles } from "../methodology-engine.js";

// ── Seed dictionary (stub when no sessions have been scanned) ─────────────────

/**
 * Minimal seed feature dictionary for cold-start scenarios.
 * source: mcp_server/core/sparse_dictionary.py build_seed_dictionary (stub)
 */
function buildSeedDictionary(): {
  K: number;
  D: number;
  sparsity: number;
  learnedFromSessions: number;
  features: Array<{ index: number; label: string; description: string; topSignals: Array<{ signal: string; weight: number }> }>;
  signalNames: string[];
} {
  return {
    K: 8, D: 27, sparsity: 0.1, learnedFromSessions: 0,
    features: [
      { index: 0, label: "edit-heavy", description: "High ratio of Edit/Write tool usage", topSignals: [{ signal: "tool:Edit", weight: 0.8 }, { signal: "tool:Write", weight: 0.5 }] },
      { index: 1, label: "read-heavy", description: "High ratio of Read/Grep tool usage", topSignals: [{ signal: "tool:Read", weight: 0.8 }, { signal: "tool:Grep", weight: 0.5 }] },
      { index: 2, label: "autonomous", description: "Frequent Agent/Bash usage", topSignals: [{ signal: "tool:Agent", weight: 0.7 }, { signal: "tool:Bash", weight: 0.6 }] },
      { index: 3, label: "research-mode", description: "WebSearch and broad exploration", topSignals: [{ signal: "tool:WebSearch", weight: 0.8 }, { signal: "cat:research", weight: 0.6 }] },
      { index: 4, label: "burst-iteration", description: "Short high-velocity sessions", topSignals: [{ signal: "tmp:burst", weight: 0.9 }, { signal: "tmp:short", weight: 0.7 }] },
      { index: 5, label: "deep-focus", description: "Long focused sessions", topSignals: [{ signal: "tmp:long", weight: 0.8 }, { signal: "tmp:explore", weight: 0.5 }] },
      { index: 6, label: "refactor-driven", description: "Pattern of refactoring work", topSignals: [{ signal: "drv:refactor", weight: 0.9 }, { signal: "cat:architecture", weight: 0.5 }] },
      { index: 7, label: "debug-oriented", description: "Debugging and diagnosis focus", topSignals: [{ signal: "drv:debug", weight: 0.9 }, { signal: "cat:bug-fix", weight: 0.7 }] },
    ],
    signalNames: [],
  };
}

// ── Mode handlers ─────────────────────────────────────────────────────────────

function handleFeatures(profiles: ProfilesStore): Record<string, unknown> {
  const d = profiles.featureDictionary ?? buildSeedDictionary();
  return {
    status: "ok",
    dictionary: {
      K: d.K, D: d.D, sparsity: d.sparsity,
      learnedFromSessions: d.learnedFromSessions,
      features: d.features.map((f) => ({
        index: f.index, label: f.label,
        description: f.description, topSignals: f.topSignals,
      })),
    },
    persistentFeatures: profiles.persistentFeatures ?? [],
  };
}

function handleAttribution(
  profiles: ProfilesStore,
  domain: string | undefined,
): Record<string, unknown> {
  const domainId = domain ?? Object.keys(profiles.domains)[0];
  const dp: DomainProfile | undefined = domainId ? profiles.domains[domainId] : undefined;

  if (!dp) {
    return { status: "error", message: `Domain not found: ${domainId ?? "(none)"}` };
  }

  const d = profiles.featureDictionary ?? buildSeedDictionary();
  const graph = traceAttribution([], d, dp);

  // Enrich with stored activations
  if (dp.featureActivations) {
    for (const node of graph.nodes) {
      if (node.layer === "feature" && node.label in dp.featureActivations) {
        node.activation = dp.featureActivations[node.label] ?? 0;
      }
    }
  }

  return { status: "ok", domain: domainId, graph };
}

function handlePersona(
  profiles: ProfilesStore,
  domain: string | undefined,
): Record<string, unknown> {
  if (domain) {
    const dp = profiles.domains[domain];
    if (!dp) return { status: "error", message: `Domain not found: ${domain}` };
    const persona = dp.personaVector ?? buildPersonaVector(dp);
    return { status: "ok", domain, persona, dimensions: PERSONA_NUMERIC_DIMENSIONS };
  }

  const domainPersonas: Record<string, PersonaVector> = {};
  const vectors: PersonaVector[] = [];
  const weights: number[] = [];

  for (const [dId, dp] of Object.entries(profiles.domains)) {
    const pv = dp.personaVector ?? buildPersonaVector(dp);
    domainPersonas[dId] = pv;
    vectors.push(pv);
    weights.push(dp.sessionCount ?? 1);
  }

  const globalPersona = composePersonas(vectors, weights);
  return { status: "ok", domains: domainPersonas, global: globalPersona, dimensions: PERSONA_NUMERIC_DIMENSIONS };
}

function handleCrosscoder(
  profiles: ProfilesStore,
  domain: string | undefined,
  compareDomain: string | undefined,
): Record<string, unknown> {
  const d = profiles.featureDictionary ?? buildSeedDictionary();

  if (domain && compareDomain) {
    const dpA = profiles.domains[domain];
    const dpB = profiles.domains[compareDomain];
    if (!dpA) return { status: "error", message: `Domain not found: ${domain}` };
    if (!dpB) return { status: "error", message: `Domain not found: ${compareDomain}` };

    const comparison = compareFeatureProfiles(
      dpA.featureActivations ?? null,
      dpB.featureActivations ?? null,
    );
    return { status: "ok", comparison: { domainA: domain, domainB: compareDomain, ...comparison } };
  }

  const persistent = profiles.persistentFeatures ??
    detectPersistentFeatures(profiles.domains, d);

  return { status: "ok", persistentFeatures: persistent, domainCount: Object.keys(profiles.domains).length };
}

// ── Persona drift helper (exposed for tests) ──────────────────────────────────

export { personaDrift };

// ── Main export ───────────────────────────────────────────────────────────────

export type ExploreMode = "features" | "attribution" | "persona" | "crosscoder";

/**
 * Inspect the user's cognitive profile through one of four interpretability lenses.
 * source: mcp_server/handlers/explore_features.py handler
 */
export function exploreFeatures(
  args: { mode: ExploreMode; domain?: string; compareDomain?: string },
  profiles: ProfilesStore,
): Record<string, unknown> {
  if (!profiles || Object.keys(profiles.domains).length === 0) {
    return { status: "no_data", message: "No profiles built yet. Run rebuild_profiles first." };
  }

  switch (args.mode) {
    case "features":   return handleFeatures(profiles);
    case "attribution": return handleAttribution(profiles, args.domain);
    case "persona":    return handlePersona(profiles, args.domain);
    case "crosscoder": return handleCrosscoder(profiles, args.domain, args.compareDomain);
    default:
      return { status: "error", message: `Unknown mode: ${String(args.mode)}` };
  }
}
