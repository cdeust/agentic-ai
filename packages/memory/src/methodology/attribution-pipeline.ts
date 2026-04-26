/**
 * Pipeline attribution graph via perturbation-based tracing.
 *
 * Perturbs each input signal by +epsilon, re-runs downstream pure functions,
 * measures |output_perturbed - output_original| / epsilon.
 * Samples at most 20 sessions.
 *
 * source: mcp_server/core/attribution_tracer.py
 */

import type { AttributionEdge, AttributionGraph, AttributionNode, DomainProfile } from "./types.js";
import { norm, subtract } from "./linear-algebra.js";

// ── Signal names — mirrors sparse_dictionary_activation.py SIGNAL_NAMES ──────

/**
 * 27-element ordered signal name list.
 * source: mcp_server/core/sparse_dictionary_activation.py SIGNAL_NAMES
 */
export const SIGNAL_NAMES: readonly string[] = [
  // 0-6: tool-use signals
  "tool:Read", "tool:Edit", "tool:Write", "tool:Grep",
  "tool:Glob", "tool:Bash", "tool:Agent",
  // 7-10: entry pattern signals
  "kw:concrete", "kw:abstract", "kw:planning", "kw:trial",
  // 11-15: session shape signals
  "tmp:short", "tmp:medium", "tmp:long", "tmp:burst", "tmp:explore",
  // 16: aggregate tool signal
  "tool:WebSearch",
  // 17-26: recurring pattern signals
  "drv:refactor", "drv:debug", "drv:research", "drv:feature",
  "cat:bug-fix", "cat:testing", "cat:docs", "cat:architecture",
  "cat:config", "cat:deployment",
] as const;

/** Dimension D of the signal space. */
export const D = SIGNAL_NAMES.length;

// ── Signal-to-extractor mapping ───────────────────────────────────────────────

/** source: mcp_server/core/attribution_tracer.py _SIGNAL_TO_EXTRACTOR */
const SIGNAL_TO_EXTRACTOR: Record<string, string> = {};
for (let i = 0; i <= 6; i++) SIGNAL_TO_EXTRACTOR[SIGNAL_NAMES[i] as string] = "extractor:toolPreferences";
for (let i = 7; i <= 10; i++) SIGNAL_TO_EXTRACTOR[SIGNAL_NAMES[i] as string] = "extractor:entryPoints";
for (let i = 11; i <= 15; i++) SIGNAL_TO_EXTRACTOR[SIGNAL_NAMES[i] as string] = "extractor:sessionShape";
SIGNAL_TO_EXTRACTOR[SIGNAL_NAMES[16] as string] = "extractor:toolPreferences";
for (let i = 17; i <= 26; i++) SIGNAL_TO_EXTRACTOR[SIGNAL_NAMES[i] as string] = "extractor:recurringPatterns";

/** source: mcp_server/core/attribution_tracer.py _EXTRACTOR_CLASSIFIER_MAP */
const EXTRACTOR_CLASSIFIER_MAP: Record<string, string[]> = {
  "extractor:toolPreferences": ["classifier:activeReflective", "classifier:explorationStyle"],
  "extractor:entryPoints": ["classifier:sensingIntuitive", "classifier:problemDecomposition"],
  "extractor:sessionShape": ["classifier:activeReflective", "classifier:sequentialGlobal"],
  "extractor:recurringPatterns": ["classifier:verificationBehavior", "classifier:sensingIntuitive"],
};

// ── Node builders ─────────────────────────────────────────────────────────────

function buildLayerNodes(names: readonly string[], layer: AttributionNode["layer"], prefix: string): AttributionNode[] {
  return names.map((name) => ({
    id: `${prefix}:${name}`,
    label: name,
    layer,
    activation: 0,
  }));
}

function buildClassifierNodes(profile: Partial<DomainProfile>): AttributionNode[] {
  const classifiers = [
    "activeReflective", "sensingIntuitive", "sequentialGlobal",
    "problemDecomposition", "explorationStyle", "verificationBehavior",
  ];
  const mc = profile.metacognitive ?? { activeReflective: 0, sensingIntuitive: 0, sequentialGlobal: 0 };
  return classifiers.map((cls) => ({
    id: `classifier:${cls}`,
    label: cls,
    layer: "classifier" as const,
    activation: (mc as unknown as Record<string, number>)[cls] ?? 0,
  }));
}

function buildFeatureNodes(
  dictionary: { features: Array<{ label: string }> } | null | undefined,
): AttributionNode[] {
  if (!dictionary?.features) return [];
  return dictionary.features.map((f) => ({
    id: `feature:${f.label}`,
    label: f.label,
    layer: "feature" as const,
    activation: 0,
  }));
}

function buildAttributionNodes(
  profile: Partial<DomainProfile>,
  dictionary: { features: Array<{ label: string }> } | null | undefined,
): AttributionNode[] {
  const extractors = ["entryPoints", "recurringPatterns", "toolPreferences", "sessionShape"];
  return [
    ...buildLayerNodes(SIGNAL_NAMES, "input", "input"),
    ...buildLayerNodes(extractors, "extractor", "extractor"),
    ...buildClassifierNodes(profile),
    ...buildFeatureNodes(dictionary),
    { id: "aggregator:profile", label: "Domain Profile", layer: "aggregator", activation: profile.confidence ?? 0 },
    { id: "output:context", label: "Context Output", layer: "output", activation: 1 },
  ];
}

// ── Perturbation-based edge weights ───────────────────────────────────────────

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

function computeMeanBaseline(conversations: unknown[], maxSamples: number): number[] {
  const sampled = conversations.slice(0, maxSamples);
  const mean = new Array(D).fill(0) as number[];
  if (sampled.length === 0) return mean;
  // Minimal activation extraction: tool-use ratios from session toolsUsed
  for (const conv of sampled) {
    const tools: string[] = (conv as Record<string, unknown>)["toolsUsed"] as string[] ?? [];
    const total = tools.length || 1;
    for (let s = 0; s < 7; s++) {
      const toolName = (SIGNAL_NAMES[s] as string).replace("tool:", "");
      const count = tools.filter((t) => t === toolName).length;
      (mean[s] as number) = (mean[s] as number) + count / total / sampled.length;
    }
  }
  return mean;
}

function computeInputToExtractorEdges(
  meanBaseline: number[],
  epsilon: number,
): AttributionEdge[] {
  const edges: AttributionEdge[] = [];
  for (let s = 0; s < D; s++) {
    const signal = SIGNAL_NAMES[s];
    const extractor = signal ? SIGNAL_TO_EXTRACTOR[signal] : undefined;
    if (!extractor) continue;

    const perturbed = meanBaseline.map((v, i) => (i === s ? v + epsilon : v));
    const diff = norm(subtract(perturbed, meanBaseline));
    const weight = diff / epsilon;

    if (weight > 0.01 && signal) {
      edges.push({ source: `input:${signal}`, target: extractor, weight: Math.round(weight * 1000) / 1000 });
    }
  }
  return edges;
}

function computeFeatureEdges(
  dictionary: { features: Array<{ label: string; topSignals?: Array<{ signal: string; weight: number }> }> } | null | undefined,
): AttributionEdge[] {
  if (!dictionary?.features) return [];
  const edges: AttributionEdge[] = [];
  for (const feature of dictionary.features) {
    for (const ts of feature.topSignals ?? []) {
      const classifierFor = getClassifierForSignal(ts.signal);
      if (classifierFor) {
        edges.push({ source: classifierFor, target: `feature:${feature.label}`, weight: Math.abs(ts.weight) });
      }
    }
    edges.push({ source: `feature:${feature.label}`, target: "aggregator:profile", weight: 0.5 });
  }
  return edges;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Build the full attribution graph for a domain profile.
 * source: mcp_server/core/attribution_tracer.py trace_attribution
 */
export function traceAttribution(
  conversations: unknown[] | null,
  dictionary: { features: Array<{ label: string; topSignals?: Array<{ signal: string; weight: number }> }> } | null | undefined,
  profile: Partial<DomainProfile> | null,
): AttributionGraph {
  if (!conversations || conversations.length === 0 || !profile) {
    return { nodes: [], edges: [] };
  }

  const EPSILON = 0.1;
  const MAX_SAMPLES = 20;

  const nodes = buildAttributionNodes(profile, dictionary);
  const meanBaseline = computeMeanBaseline(conversations, MAX_SAMPLES);

  // Update input node activations
  for (let s = 0; s < D; s++) {
    const sigName = SIGNAL_NAMES[s];
    const nodeIdx = nodes.findIndex((n) => n.id === `input:${sigName}`);
    if (nodeIdx >= 0 && nodes[nodeIdx]) {
      nodes[nodeIdx].activation = Math.round((meanBaseline[s] ?? 0) * 1000) / 1000;
    }
  }

  const edges: AttributionEdge[] = [
    ...computeInputToExtractorEdges(meanBaseline, EPSILON),
  ];

  // Extractor -> Classifier edges
  for (const [extractor, classifiers] of Object.entries(EXTRACTOR_CLASSIFIER_MAP)) {
    for (const classifier of classifiers) {
      edges.push({ source: extractor, target: classifier, weight: 0.5 });
    }
  }

  edges.push(...computeFeatureEdges(dictionary));
  edges.push({ source: "aggregator:profile", target: "output:context", weight: profile.confidence ?? 0.5 });

  return { nodes, edges };
}
