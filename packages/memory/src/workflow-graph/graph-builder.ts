/* eslint-disable @typescript-eslint/no-magic-numbers -- source: exact port of Python source; all numeric literals copied verbatim from cited Python file */
/**
 * Graph data structures for 3D visualization.
 *
 * Transforms domain profiles into nodes and edges for a force-directed graph.
 *
 * source: Cortex mcp_server/core/graph_builder.py
 */

// ── Colors ──────────────────────────────────────────────────────────────

const FEATURE_COLOR = "#a855f7"; // source: Cortex graph_builder.py::FEATURE_COLOR
const PERSISTENT_COLOR = "#ec4899"; // source: Cortex graph_builder.py::PERSISTENT_COLOR

// ── Internal accumulator ─────────────────────────────────────────────────

type DomainNode = Record<string, unknown>;
type DomainEdge = Record<string, unknown>;

interface GraphAccumulator {
  nodes: DomainNode[];
  edges: DomainEdge[];
  blindSpotRegions: DomainNode[];
  nodeId: number;
}

function makeAccumulator(): GraphAccumulator {
  return { nodes: [], edges: [], blindSpotRegions: [], nodeId: 0 };
}

function nextId(acc: GraphAccumulator, prefix: string): string {
  const nid = `${prefix}_${acc.nodeId}`;
  acc.nodeId++;
  return nid;
}

// ── Private helpers ──────────────────────────────────────────────────────

function addDomainHub(
  acc: GraphAccumulator,
  domainId: string,
  dp: Record<string, unknown>,
): string {
  const hubId = nextId(acc, "domain");
  const sessionCount = Number(dp["sessionCount"] ?? 0);
  acc.nodes.push({
    id: hubId,
    type: "domain",
    label: dp["label"] ?? domainId,
    domain: domainId,
    confidence: Number(dp["confidence"] ?? 0),
    sessionCount,
    color: "#6366f1", // source: Cortex graph_builder.py::_add_domain_hub color
    size: Math.max(8, Math.min(30, (sessionCount || 1) * 0.5)),
  });
  return hubId;
}

function addEntryPoints(
  acc: GraphAccumulator,
  hubId: string,
  domainId: string,
  dp: Record<string, unknown>,
): void {
  for (const ep of ((dp["entryPoints"] as Record<string, unknown>[]) ?? [])) {
    const epId = nextId(acc, "entry");
    const freq = Number(ep["frequency"] ?? 0);
    acc.nodes.push({
      id: epId,
      type: "entry-point",
      label: String(ep["pattern"] ?? ""),
      domain: domainId,
      confidence: Number(ep["confidence"] ?? 0),
      frequency: freq,
      color: "#00d4ff",
      size: Math.max(4, Math.min(15, (freq || 1) * 2)),
    });
    acc.edges.push({
      source: hubId,
      target: epId,
      type: "has-entry",
      weight: Number(ep["confidence"] ?? 0.5),
    });
  }
}

function addRecurringPatterns(
  acc: GraphAccumulator,
  hubId: string,
  domainId: string,
  dp: Record<string, unknown>,
): void {
  for (const rp of ((dp["recurringPatterns"] as Record<string, unknown>[]) ?? [])) {
    const rpId = nextId(acc, "pattern");
    const freq = Number(rp["frequency"] ?? 0);
    acc.nodes.push({
      id: rpId,
      type: "recurring-pattern",
      label: String(rp["pattern"] ?? ""),
      domain: domainId,
      confidence: Number(rp["confidence"] ?? 0),
      frequency: freq,
      color: "#10b981", // source: Cortex graph_builder.py::_add_recurring_patterns color
      size: Math.max(4, Math.min(15, (freq || 1) * 1.5)),
    });
    acc.edges.push({
      source: hubId,
      target: rpId,
      type: "has-pattern",
      weight: Number(rp["confidence"] ?? 0.5),
    });
  }
}

function addToolPreferences(
  acc: GraphAccumulator,
  hubId: string,
  domainId: string,
  dp: Record<string, unknown>,
): void {
  const toolPrefs = (dp["toolPreferences"] as Record<string, Record<string, number>>) ?? {};
  const topTools = Object.entries(toolPrefs)
    .sort(([, a], [, b]) => (b["ratio"] ?? 0) - (a["ratio"] ?? 0))
    .slice(0, 5);
  for (const [tool, pref] of topTools) {
    const toolId = nextId(acc, "tool");
    const ratio = pref["ratio"] ?? 0;
    acc.nodes.push({
      id: toolId,
      type: "tool-preference",
      label: tool,
      domain: domainId,
      ratio,
      avgPerSession: pref["avgPerSession"] ?? 0,
      color: "#f59e0b", // source: Cortex graph_builder.py::_add_tool_preferences color
      size: Math.max(4, Math.min(12, ratio * 15)),
    });
    acc.edges.push({
      source: hubId,
      target: toolId,
      type: "uses-tool",
      weight: ratio,
    });
  }
}

function addBridges(
  acc: GraphAccumulator,
  hubId: string,
  dp: Record<string, unknown>,
  domainsToRender: Record<string, unknown>,
  domainKeys: string[],
): void {
  for (const bridge of ((dp["connectionBridges"] as Record<string, unknown>[]) ?? [])) {
    const toDomain = bridge["toDomain"] as string | undefined;
    if (!toDomain || !(toDomain in domainsToRender)) continue;
    const targetIdx = domainKeys.indexOf(toDomain);
    if (targetIdx >= 0) {
      acc.edges.push({
        source: hubId,
        target: `domain_${targetIdx}`,
        type: "bridge",
        weight: Number(bridge["weight"] ?? 0.5),
        label: bridge["pattern"],
      });
    }
  }
}

function addBlindSpots(
  acc: GraphAccumulator,
  domainId: string,
  dp: Record<string, unknown>,
): void {
  for (const bs of ((dp["blindSpots"] as Record<string, unknown>[]) ?? [])) {
    acc.blindSpotRegions.push({
      domain: domainId,
      type: bs["type"],
      value: bs["value"],
      severity: bs["severity"],
      description: bs["description"],
      suggestion: bs["suggestion"],
    });
  }
}

function findDomainHub(
  nodes: DomainNode[],
  domainId: string,
): DomainNode | undefined {
  return nodes.find((n) => n["type"] === "domain" && n["domain"] === domainId);
}

function addBehavioralFeatures(
  acc: GraphAccumulator,
  domainsToRender: Record<string, unknown>,
): void {
  for (const [domainId, dp] of Object.entries(domainsToRender)) {
    if (!dp) continue;
    const dpObj = dp as Record<string, unknown>;
    if (!dpObj["featureActivations"]) continue;

    const hubNode = findDomainHub(acc.nodes, domainId);
    if (!hubNode) continue;

    for (const [label, weight] of Object.entries(
      dpObj["featureActivations"] as Record<string, number>,
    )) {
      if (Math.abs(weight) < 0.05) continue; // source: Cortex graph_builder.py::_add_behavioral_features minimum activation threshold
      const featureId = nextId(acc, "feature");
      acc.nodes.push({
        id: featureId,
        type: "behavioral-feature",
        label,
        domain: domainId,
        activation: weight,
        color: FEATURE_COLOR,
        size: Math.max(3, Math.min(10, Math.abs(weight) * 12)),
      });
      acc.edges.push({
        source: hubNode["id"],
        target: featureId,
        type: "has-feature",
        weight: Math.abs(weight),
      });
    }
  }
}

function addPersistentFeatureEdges(
  acc: GraphAccumulator,
  profiles: Record<string, unknown>,
): void {
  for (const pf of ((profiles["persistentFeatures"] as Record<string, unknown>[]) ?? [])) {
    const pfDomains = (pf["domains"] as string[]) ?? [];
    if (pfDomains.length < 2) continue;
    for (let i = 0; i < pfDomains.length; i++) {
      for (let j = i + 1; j < pfDomains.length; j++) {
        const domI = pfDomains[i];
        const domJ = pfDomains[j];
        if (domI === undefined || domJ === undefined) continue;
        const sourceHub = findDomainHub(acc.nodes, domI);
        const targetHub = findDomainHub(acc.nodes, domJ);
        if (sourceHub && targetHub) {
          acc.edges.push({
            source: sourceHub["id"],
            target: targetHub["id"],
            type: "persistent-feature",
            weight: Number(pf["persistence"] ?? 0),
            label: pf["label"],
            color: PERSISTENT_COLOR,
          });
        }
      }
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────────

export interface DomainGraph {
  nodes: DomainNode[];
  edges: DomainEdge[];
  blindSpotRegions: DomainNode[];
}

/** Build a force-directed graph from domain profiles. */
export function buildGraph(
  profiles: Record<string, unknown>,
  filterDomain?: string,
): DomainGraph {
  const acc = makeAccumulator();

  const allDomains = (profiles["domains"] as Record<string, unknown>) ?? {};
  let domainsToRender: Record<string, unknown>;
  if (filterDomain) {
    domainsToRender = { [filterDomain]: allDomains[filterDomain] };
  } else {
    domainsToRender = { ...allDomains };
  }

  const domainKeys = Object.keys(domainsToRender);

  for (const [domainId, dp] of Object.entries(domainsToRender)) {
    if (!dp) continue;
    const dpObj = dp as Record<string, unknown>;

    const hubId = addDomainHub(acc, domainId, dpObj);
    addEntryPoints(acc, hubId, domainId, dpObj);
    addRecurringPatterns(acc, hubId, domainId, dpObj);
    addToolPreferences(acc, hubId, domainId, dpObj);
    addBridges(acc, hubId, dpObj, domainsToRender, domainKeys);
    addBlindSpots(acc, domainId, dpObj);
  }

  addBehavioralFeatures(acc, domainsToRender);
  addPersistentFeatureEdges(acc, profiles);

  return {
    nodes: acc.nodes,
    edges: acc.edges,
    blindSpotRegions: acc.blindSpotRegions,
  };
}
