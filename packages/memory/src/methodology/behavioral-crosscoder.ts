/**
 * Cross-domain behavioral feature persistence detection.
 *
 * Detects features active in >50% of domains (persistent).
 * Ranks by persistence then consistency (low variance).
 *
 * Pure business logic — no I/O.
 *
 * Port of: cortex@ed33435 mcp_server/core/behavioral_crosscoder.py
 */

// ── Threshold constants ───────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/behavioral_crosscoder.py:111-112

const ACTIVATION_THRESHOLD = 0.1; // source: cortex@ed33435 mcp_server/core/behavioral_crosscoder.py:111
const PERSISTENCE_THRESHOLD = 0.5; // source: cortex@ed33435 mcp_server/core/behavioral_crosscoder.py:112

// ── Feature activation population ────────────────────────────────────────

interface DomainStats {
  sum: number;
  count: number;
}

/**
 * Fill featureActivations from explicit per-domain activation data.
 * source: cortex@ed33435 mcp_server/core/behavioral_crosscoder.py:13-29
 */
function populateFromDomainActivations(
  domainActivations: Record<string, Array<Record<string, unknown>>>,
  featureActivations: Record<string, Record<string, DomainStats>>,
): void {
  for (const [domainId, activations] of Object.entries(domainActivations)) {
    for (const activation of activations) {
      const weights = activation["weights"] ?? {};
      const items: Array<[string, number]> = typeof weights === "object" && !Array.isArray(weights)
        ? Object.entries(weights as Record<string, number>)
        : (weights as Array<[string, number]>);
      for (const [label, weight] of items) {
        if (!(label in featureActivations)) continue;
        const domainMap = featureActivations[label]!;
        const existing = domainMap[domainId] ?? { sum: 0, count: 0 };
        existing.sum += Math.abs(Number(weight));
        existing.count++;
        domainMap[domainId] = existing;
      }
    }
  }
}

/**
 * Fill featureActivations from profile featureActivations fields.
 * source: cortex@ed33435 mcp_server/core/behavioral_crosscoder.py:32-47
 */
function populateFromProfiles(
  profiles: Record<string, Record<string, unknown>>,
  featureActivations: Record<string, Record<string, DomainStats>>,
): void {
  for (const [domainId, profile] of Object.entries(profiles)) {
    const fa = profile["featureActivations"] as Record<string, number> | undefined;
    if (!fa) continue;
    for (const [label, weight] of Object.entries(fa)) {
      if (!(label in featureActivations)) continue;
      featureActivations[label]![domainId] = {
        sum: Math.abs(weight),
        count: 1,
      };
    }
  }
}

// ── Persistence statistics ────────────────────────────────────────────────

/**
 * Compute persistence ratio, std deviation, and active domain list.
 *
 * precondition:  totalDomains >= 1; activationThreshold > 0.
 * postcondition: [persistenceRatio, stdDev, activeDomains].
 *
 * source: cortex@ed33435 mcp_server/core/behavioral_crosscoder.py:50-74
 */
function computePersistenceStats(
  domainMap: Record<string, DomainStats>,
  totalDomains: number,
  activationThreshold: number,
): [number, number, string[]] {
  const activeDomains: string[] = [];
  const activationValues: number[] = [];

  for (const [domainId, stats] of Object.entries(domainMap)) {
    const meanActivation = stats.count > 0 ? stats.sum / stats.count : 0;
    if (meanActivation >= activationThreshold) {
      activeDomains.push(domainId);
      activationValues.push(meanActivation);
    }
  }

  const persistence = totalDomains > 0 ? activeDomains.length / totalDomains : 0;

  if (activationValues.length === 0) return [persistence, 0.0, activeDomains];

  const mean = activationValues.reduce((a, b) => a + b, 0) / activationValues.length;
  const variance = activationValues.reduce((acc, v) => acc + (v - mean) ** 2, 0) / activationValues.length;
  const consistency = Math.sqrt(variance);

  return [persistence, consistency, activeDomains];
}

// ── Feature activation builder ────────────────────────────────────────────

/**
 * Initialize and populate feature activation maps.
 * source: cortex@ed33435 mcp_server/core/behavioral_crosscoder.py:77-92
 */
function buildFeatureActivations(
  profiles: Record<string, Record<string, unknown>> | null,
  dictionary: Record<string, unknown>,
  domainActivations: Record<string, Array<Record<string, unknown>>> | null,
): Record<string, Record<string, DomainStats>> {
  const featureActivations: Record<string, Record<string, DomainStats>> = {};
  const features = (dictionary["features"] ?? []) as Array<{ label: string }>;
  for (const feature of features) {
    featureActivations[feature.label] = {};
  }

  if (domainActivations) {
    populateFromDomainActivations(domainActivations, featureActivations);
  } else {
    populateFromProfiles(profiles ?? {}, featureActivations);
  }

  return featureActivations;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Detect behavioral features that persist across >50% of domains.
 *
 * precondition:  dictionary.features is an array; profiles has >= 2 domain keys.
 * postcondition: returned array is sorted by (-persistence, consistency);
 *   each entry has label, persistence, consistency, domains.
 *   Returns [] when dictionary is null or has < 2 domain profiles.
 *
 * source: cortex@ed33435 mcp_server/core/behavioral_crosscoder.py:95-130
 *   activation_threshold = 0.1; persistence_threshold = 0.5
 */
export function detectPersistentFeatures(
  profiles: Record<string, Record<string, unknown>> | null,
  dictionary: Record<string, unknown> | null,
  domainActivations: Record<string, Array<Record<string, unknown>>> | null = null,
): Array<Record<string, unknown>> {
  if (!dictionary || !dictionary["features"]) return [];

  const domainIds = Object.keys(profiles ?? {});
  if (domainIds.length < 2) return [];

  const featureActivations = buildFeatureActivations(profiles, dictionary, domainActivations);

  const results: Array<Record<string, unknown>> = [];
  for (const [label, domainMap] of Object.entries(featureActivations)) {
    const [persistence, consistency, activeDomains] = computePersistenceStats(
      domainMap,
      domainIds.length,
      ACTIVATION_THRESHOLD,
    );
    if (persistence >= PERSISTENCE_THRESHOLD) {
      results.push({
        label,
        persistence: Math.round(persistence * 100) / 100,
        consistency: Math.round(consistency * 1000) / 1000,
        domains: activeDomains,
      });
    }
  }

  results.sort((a, b) => {
    const pDiff = (b["persistence"] as number) - (a["persistence"] as number);
    if (pDiff !== 0) return pDiff;
    return (a["consistency"] as number) - (b["consistency"] as number);
  });
  return results;
}

/**
 * Compare feature profiles from two activation sets.
 *
 * precondition:  activationsA and activationsB are maps of label → weight.
 * postcondition: returned object has shared, uniqueToA, uniqueToB arrays.
 *
 * source: cortex@ed33435 mcp_server/core/behavioral_crosscoder.py:133-154
 *   threshold = 0.1
 */
export function compareFeatureProfiles(
  activationsA: Record<string, number> | null,
  activationsB: Record<string, number> | null,
  _dictionary: Record<string, unknown> | null = null,
): { shared: string[]; uniqueToA: string[]; uniqueToB: string[] } {
  const threshold = 0.1; // source: cortex@ed33435 mcp_server/core/behavioral_crosscoder.py:138
  const activeA = new Set(
    Object.entries(activationsA ?? {})
      .filter(([, w]) => Math.abs(w) >= threshold)
      .map(([l]) => l),
  );
  const activeB = new Set(
    Object.entries(activationsB ?? {})
      .filter(([, w]) => Math.abs(w) >= threshold)
      .map(([l]) => l),
  );

  return {
    shared: [...activeA].filter((l) => activeB.has(l)),
    uniqueToA: [...activeA].filter((l) => !activeB.has(l)),
    uniqueToB: [...activeB].filter((l) => !activeA.has(l)),
  };
}
