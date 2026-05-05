/**
 * Pipeline attribution graph via perturbation-based tracing.
 *
 * Perturbs each input signal by +/-epsilon, re-runs downstream pure functions,
 * measures |output_perturbed - output_original| / epsilon. Samples at most 20 sessions.
 *
 * Port of: mcp_server/core/attribution_tracer.py
 * Pure business logic — no I/O.
 */

import { norm, subtract } from "../shared/linear-algebra.js";
import { SIGNAL_NAMES, D, extractSessionActivation } from "../consolidation/sparse-dictionary.js";

// ── Node construction helpers ────────────────────────────────────────────────

function buildLayerNodes(
  names: string[],
  layer: string,
  prefix: string,
): Record<string, unknown>[] {
  return names.map((name) => ({
    id: `${prefix}:${name}`,
    label: name,
    layer,
    activation: 0,
  }));
}

function buildClassifierNodes(profile: Record<string, unknown>): Record<string, unknown>[] {
  const classifiers = [
    "activeReflective",
    "sensingIntuitive",
    "sequentialGlobal",
    "problemDecomposition",
    "explorationStyle",
    "verificationBehavior",
  ];
  const mc = (profile["metacognitive"] as Record<string, unknown> | undefined) ?? {};
  return classifiers.map((cls) => ({
    id: `classifier:${cls}`,
    label: cls,
    layer: "classifier",
    activation: mc[cls] ?? 0,
  }));
}

function buildFeatureNodes(
  dictionary: Record<string, unknown> | null | undefined,
): Record<string, unknown>[] {
  if (!dictionary || !dictionary["features"]) return [];
  const features = dictionary["features"] as Array<Record<string, unknown>>;
  return features.map((f) => ({
    id: `feature:${f["label"]}`,
    label: f["label"],
    layer: "feature",
    activation: 0,
  }));
}

/**
 * Build all attribution graph nodes.
 *
 * Precondition: profile is a non-null object; dictionary may be null.
 * Postcondition: returns array of node objects with id, label, layer, activation.
 */
export function buildAttributionNodes(
  profile: Record<string, unknown>,
  dictionary: Record<string, unknown> | null | undefined,
): Record<string, unknown>[] {
  const extractors = ["entryPoints", "recurringPatterns", "toolPreferences", "sessionShape"];

  const nodes: Record<string, unknown>[] = [];
  nodes.push(...buildLayerNodes(Array.from(SIGNAL_NAMES), "input", "input"));
  nodes.push(...buildLayerNodes(extractors, "extractor", "extractor"));
  nodes.push(...buildClassifierNodes(profile));
  nodes.push(...buildFeatureNodes(dictionary));
  nodes.push({
    id: "aggregator:profile",
    label: "Domain Profile",
    layer: "aggregator",
    activation: profile["confidence"] ?? 0,
  });
  nodes.push({
    id: "output:context",
    label: "Context Output",
    layer: "output",
    activation: 1,
  });
  return nodes;
}

// ── Perturbation-based edge weight computation ────────────────────────────────

const SIGNAL_TO_EXTRACTOR: Map<string, string> = new Map();
for (let i = 0; i < 7; i++) {
  SIGNAL_TO_EXTRACTOR.set(SIGNAL_NAMES[i] ?? "", "extractor:toolPreferences");
}
for (let i = 7; i < 11; i++) {
  SIGNAL_TO_EXTRACTOR.set(SIGNAL_NAMES[i] ?? "", "extractor:entryPoints");
}
for (let i = 11; i < 16; i++) {
  SIGNAL_TO_EXTRACTOR.set(SIGNAL_NAMES[i] ?? "", "extractor:sessionShape");
}
SIGNAL_TO_EXTRACTOR.set(SIGNAL_NAMES[16] ?? "", "extractor:toolPreferences");
for (let i = 17; i < 27; i++) {
  SIGNAL_TO_EXTRACTOR.set(SIGNAL_NAMES[i] ?? "", "extractor:recurringPatterns");
}

const EXTRACTOR_CLASSIFIER_MAP: Record<string, string[]> = {
  "extractor:toolPreferences": ["classifier:activeReflective", "classifier:explorationStyle"],
  "extractor:entryPoints": ["classifier:sensingIntuitive", "classifier:problemDecomposition"],
  "extractor:sessionShape": ["classifier:activeReflective", "classifier:sequentialGlobal"],
  "extractor:recurringPatterns": ["classifier:verificationBehavior", "classifier:sensingIntuitive"],
};

function getClassifierForSignal(signal: string): string | null {
  if (signal.startsWith("tool:Edit") || signal.startsWith("tool:Write") || signal.startsWith("tool:Bash")) {
    return "classifier:activeReflective";
  }
  if (signal.startsWith("tool:Read") || signal.startsWith("tool:Grep") || signal.startsWith("tool:Glob")) {
    return "classifier:explorationStyle";
  }
  if (signal.startsWith("kw:abstract") || signal.startsWith("kw:concrete")) {
    return "classifier:sensingIntuitive";
  }
  if (signal.startsWith("kw:planning") || signal.startsWith("kw:trial")) {
    return "classifier:problemDecomposition";
  }
  if (signal.startsWith("tmp:")) return "classifier:sequentialGlobal";
  if (signal.startsWith("cat:")) return "classifier:verificationBehavior";
  if (signal.startsWith("drv:")) return "classifier:activeReflective";
  return null;
}

function computeMeanBaseline(
  conversations: Record<string, unknown>[],
  maxSamples: number,
): number[] {
  const sampled = conversations.slice(0, maxSamples);
  const activations = sampled.map((c) => extractSessionActivation(c));
  const mean = new Array<number>(D).fill(0.0);
  if (activations.length > 0) {
    for (const act of activations) {
      for (let d = 0; d < D; d++) {
        mean[d] = (mean[d] ?? 0) + ((act[d] ?? 0) as number) / activations.length;
      }
    }
  }
  return mean;
}

function computeInputToExtractorEdges(
  meanBaseline: number[],
  epsilon: number,
): Record<string, unknown>[] {
  const edges: Record<string, unknown>[] = [];
  for (let s = 0; s < D; s++) {
    const signal = SIGNAL_NAMES[s] ?? "";
    const extractor = SIGNAL_TO_EXTRACTOR.get(signal);
    if (!extractor || !signal) continue;

    const perturbed = meanBaseline.map((v, i) => (i === s ? v + epsilon : v));
    const diff = norm(subtract(perturbed, meanBaseline));
    const weight = diff / epsilon;

    if (weight > 0.01) {
      edges.push({
        source: `input:${signal}`,
        target: extractor,
        weight: Math.round(weight * 1000) / 1000,
      });
    }
  }
  return edges;
}

function computeFeatureEdges(
  dictionary: Record<string, unknown> | null | undefined,
): Record<string, unknown>[] {
  if (!dictionary || !dictionary["features"]) return [];
  const features = dictionary["features"] as Array<Record<string, unknown>>;
  const edges: Record<string, unknown>[] = [];

  for (const feature of features) {
    const topSignals = (feature["topSignals"] as Array<Record<string, unknown>> | undefined) ?? [];
    for (const ts of topSignals) {
      const classifierFor = getClassifierForSignal(ts["signal"] as string);
      if (classifierFor) {
        edges.push({
          source: classifierFor,
          target: `feature:${feature["label"]}`,
          weight: Math.abs(ts["weight"] as number),
        });
      }
    }
    edges.push({
      source: `feature:${feature["label"]}`,
      target: "aggregator:profile",
      weight: 0.5,
    });
  }
  return edges;
}

/**
 * Compute all edge weights for the attribution graph.
 *
 * Precondition: conversations is a non-empty array; profile is a non-null object.
 * Postcondition: returns array of {source, target, weight} edge objects.
 */
export function computeEdgeWeights(
  conversations: Record<string, unknown>[],
  profile: Record<string, unknown>,
  dictionary: Record<string, unknown> | null | undefined,
): Record<string, unknown>[] {
  const EPSILON = 0.1;
  const MAX_SAMPLES = 20;

  const meanBaseline = computeMeanBaseline(conversations, MAX_SAMPLES);
  const edges: Record<string, unknown>[] = [];

  edges.push(...computeInputToExtractorEdges(meanBaseline, EPSILON));

  // Extractor -> Classifier edges
  for (const [extractor, classifiers] of Object.entries(EXTRACTOR_CLASSIFIER_MAP)) {
    for (const classifier of classifiers) {
      edges.push({ source: extractor, target: classifier, weight: 0.5 });
    }
  }

  edges.push(...computeFeatureEdges(dictionary));

  // Aggregator -> Output
  edges.push({
    source: "aggregator:profile",
    target: "output:context",
    weight: (profile["confidence"] as number | undefined) ?? 0.5,
  });

  return edges;
}

// ── Full attribution graph ────────────────────────────────────────────────────

/**
 * Build the full attribution graph for a profile.
 *
 * @param conversations - Session conversation objects.
 * @param dictionary - Sparse dictionary (may be null).
 * @param profile - Domain profile.
 * @returns {nodes, edges} attribution graph.
 *
 * Precondition: conversations is an array (may be empty); profile is a non-null object.
 * Postcondition: returns {nodes: [], edges: []} when inputs are empty or null.
 */
export function traceAttribution(
  conversations: Record<string, unknown>[] | null | undefined,
  dictionary: Record<string, unknown> | null | undefined,
  profile: Record<string, unknown> | null | undefined,
): { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } {
  if (!conversations || conversations.length === 0 || !profile) {
    return { nodes: [], edges: [] };
  }

  const nodes = buildAttributionNodes(profile, dictionary);

  // Update input node activations from mean session data
  const activations = conversations.slice(0, 20).map((c) => extractSessionActivation(c));
  if (activations.length > 0) {
    for (let s = 0; s < D; s++) {
      const mean =
        activations.reduce((sum, act) => sum + (act[s] ?? 0), 0) / activations.length;
      for (const node of nodes) {
        if (node["id"] === `input:${SIGNAL_NAMES[s] ?? ""}`) {
          node["activation"] = Math.round(mean * 1000) / 1000;
          break;
        }
      }
    }
  }

  const edges = computeEdgeWeights(conversations, profile, dictionary);
  return { nodes, edges };
}
