/**
 * Cross-domain connection detection from structural edges and text analogies.
 *
 * Two detection methods:
 *   - Structural bridges: cross-references from brain-index (explicit links)
 *   - Analogical bridges: regex-based extraction of analogy patterns in text
 *
 * Port of: mcp_server/core/bridge_finder.py
 * source: cortex@ed33435 mcp_server/core/bridge_finder.py
 */

// ── Constants ──────────────────────────────────────────────────────────────

// source: cortex@ed33435 mcp_server/core/bridge_finder.py:13
const ANALOGY_RE =
  /(like|similar to|analogous to|reminds me of|just as|the same way)\s+(?:a\s+)?(.{5,40})/gi;

// ── Types ──────────────────────────────────────────────────────────────────

export interface BridgeEntry {
  toDomain: string;
  weight: number;
  examples: Array<{ fromId?: string; toId?: string; nodeId?: string; sourceContext?: string; targetConcept?: string }>;
  edgeCount: number;
  pattern: string;
}

export interface ProfilesInput {
  domains?: Record<
    string,
    {
      projects?: string[];
      projectIds?: string[];
      [k: string]: unknown;
    }
  >;
  [k: string]: unknown;
}

export interface BrainIndexInput {
  memories?: Record<string, Record<string, unknown>>;
  conversations?: Record<string, Record<string, unknown>>;
  [k: string]: unknown;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build project → domain_id mapping.
 * Port of: mcp_server/core/bridge_finder.py::_build_project_domain_map
 * source: cortex@ed33435 mcp_server/core/bridge_finder.py:20
 */
function buildProjectDomainMap(profiles: ProfilesInput | null | undefined): Record<string, string> {
  const mapping: Record<string, string> = {};
  if (!profiles?.domains) return mapping;
  for (const [domainId, domain] of Object.entries(profiles.domains)) {
    const projects = domain.projects ?? domain.projectIds ?? [];
    for (const projectId of projects) {
      mapping[projectId] = domainId;
    }
  }
  return mapping;
}

/**
 * Resolve domain for a node.
 * Port of: mcp_server/core/bridge_finder.py::_resolve_domain
 * source: cortex@ed33435 mcp_server/core/bridge_finder.py:31
 */
function resolveDomain(
  node: Record<string, unknown>,
  projectDomainMap: Record<string, string>,
): string {
  const projectId = String(node["projectId"] ?? node["project"] ?? "");
  if (projectId && projectId in projectDomainMap) {
    return projectDomainMap[projectId] as string;
  }
  if (node["domainId"]) return String(node["domainId"]);
  return "unknown";
}

/**
 * Extract analogy patterns from text.
 * Port of: mcp_server/core/bridge_finder.py::_extract_analogies
 * source: cortex@ed33435 mcp_server/core/bridge_finder.py:40
 */
function extractAnalogies(
  text: string | null | undefined,
  nodeId: string,
): Array<{ nodeId: string; pattern: string; sourceContext: string; targetConcept: string }> {
  if (!text || typeof text !== "string") return [];
  const results: Array<{
    nodeId: string;
    pattern: string;
    sourceContext: string;
    targetConcept: string;
  }> = [];

  const regex = new RegExp(ANALOGY_RE.source, ANALOGY_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const start = Math.max(0, match.index - 60); // source: cortex@ed33435 bridge_finder.py:45
    const sourceContext = text.slice(start, match.index).trim().slice(-60);
    results.push({
      nodeId,
      pattern: (match[1] ?? "").toLowerCase(),
      sourceContext,
      targetConcept: (match[2] ?? "").trim(),
    });
  }
  return results;
}

/**
 * Build a unified node map from memories and conversations.
 * Port of: mcp_server/core/bridge_finder.py::_build_node_map
 * source: cortex@ed33435 mcp_server/core/bridge_finder.py:58
 */
function buildNodeMap(
  allMemories: Record<string, Record<string, unknown>>,
  allConversations: Record<string, Record<string, unknown>>,
  projectDomainMap: Record<string, string>,
): Record<string, { domainId: string; body: string; crossRefs: unknown[] }> {
  const nodes: Record<string, { domainId: string; body: string; crossRefs: unknown[] }> = {};

  for (const [id, mem] of Object.entries(allMemories)) {
    nodes[id] = {
      domainId: resolveDomain(mem, projectDomainMap),
      body: String(mem["body"] ?? mem["content"] ?? ""),
      crossRefs: (mem["crossRefs"] ?? mem["connections"] ?? []) as unknown[],
    };
  }

  for (const [id, conv] of Object.entries(allConversations)) {
    nodes[id] = {
      domainId: resolveDomain(conv, projectDomainMap),
      body: String(conv["body"] ?? conv["summary"] ?? conv["content"] ?? ""),
      crossRefs: (conv["crossRefs"] ?? conv["connections"] ?? []) as unknown[],
    };
  }

  return nodes;
}

/**
 * Create a canonical key for an ordered domain pair.
 * Port of: mcp_server/core/bridge_finder.py::_make_pair_key
 * source: cortex@ed33435 mcp_server/core/bridge_finder.py:86
 */
function makePairKey(domainA: string, domainB: string): string {
  return domainA < domainB ? `${domainA}|||${domainB}` : `${domainB}|||${domainA}`;
}

/**
 * Add a cross-domain edge to the pair accumulator.
 * Port of: mcp_server/core/bridge_finder.py::_accumulate_edge
 * source: cortex@ed33435 mcp_server/core/bridge_finder.py:93
 */
function accumulateEdge(
  pairs: Record<string, {
    fromDomain: string;
    toDomain: string;
    totalWeight: number;
    edgeCount: number;
    examples: Array<{ fromId: string; toId: string }>;
  }>,
  fromDomain: string,
  toDomain: string,
  weight: number,
  fromId: string,
  toId: string,
): void {
  const pairKey = makePairKey(fromDomain, toDomain);
  if (!(pairKey in pairs)) {
    const parts = pairKey.split("|||");
    pairs[pairKey] = {
      fromDomain: parts[0] ?? "",
      toDomain: parts[1] ?? "",
      totalWeight: 0,
      edgeCount: 0,
      examples: [],
    };
  }
  const pair = pairs[pairKey]!;
  pair.totalWeight += weight;
  pair.edgeCount += 1;
  if (pair.examples.length < 5) { // source: cortex@ed33435 bridge_finder.py:116
    pair.examples.push({ fromId, toId });
  }
}

/**
 * Find cross-domain structural edges and aggregate by domain pair.
 * Port of: mcp_server/core/bridge_finder.py::_collect_structural_pairs
 * source: cortex@ed33435 mcp_server/core/bridge_finder.py:119
 */
function collectStructuralPairs(
  nodes: Record<string, { domainId: string; body: string; crossRefs: unknown[] }>,
): Record<string, {
  fromDomain: string;
  toDomain: string;
  totalWeight: number;
  edgeCount: number;
  examples: Array<{ fromId: string; toId: string }>;
}> {
  const pairs: Record<string, {
    fromDomain: string;
    toDomain: string;
    totalWeight: number;
    edgeCount: number;
    examples: Array<{ fromId: string; toId: string }>;
  }> = {};

  for (const [id, node] of Object.entries(nodes)) {
    const fromDomain = node.domainId;
    for (const ref of node.crossRefs) {
      let targetId: string;
      let weight: number;
      if (typeof ref === "string") {
        targetId = ref;
        weight = 1;
      } else if (typeof ref === "object" && ref !== null) {
        const r = ref as Record<string, unknown>;
        targetId = String(r["id"] ?? r["target"] ?? "");
        weight = Number(r["weight"] ?? 1);
      } else {
        continue;
      }

      const targetNode = nodes[targetId];
      if (!targetNode) continue;
      const toDomain = targetNode.domainId;
      if (fromDomain === toDomain) continue;

      accumulateEdge(pairs, fromDomain, toDomain, weight, id, targetId);
    }
  }

  return pairs;
}

/**
 * Extract text analogies from all nodes, grouped by domain.
 * Port of: mcp_server/core/bridge_finder.py::_collect_analogies_by_domain
 * source: cortex@ed33435 mcp_server/core/bridge_finder.py:144
 */
function collectAnalogiesByDomain(
  nodes: Record<string, { domainId: string; body: string; crossRefs: unknown[] }>,
): Record<
  string,
  Array<{ nodeId: string; pattern: string; sourceContext: string; targetConcept: string }>
> {
  const result: Record<
    string,
    Array<{ nodeId: string; pattern: string; sourceContext: string; targetConcept: string }>
  > = {};

  for (const [id, node] of Object.entries(nodes)) {
    const analogies = extractAnalogies(node.body, id);
    if (analogies.length === 0) continue;
    const domainId = node.domainId;
    if (!(domainId in result)) result[domainId] = [];
    (result[domainId] as Array<{ nodeId: string; pattern: string; sourceContext: string; targetConcept: string }>).push(...analogies);
  }

  return result;
}

/**
 * Add structural bridge entries (both directions) into result.
 * Port of: mcp_server/core/bridge_finder.py::_merge_structural_bridges
 * source: cortex@ed33435 mcp_server/core/bridge_finder.py:162
 */
function mergeStructuralBridges(
  structuralPairs: Record<string, {
    fromDomain: string;
    toDomain: string;
    totalWeight: number;
    edgeCount: number;
    examples: Array<{ fromId: string; toId: string }>;
  }>,
  result: Record<string, BridgeEntry[]>,
): void {
  for (const pair of Object.values(structuralPairs)) {
    const avgWeight =
      pair.edgeCount > 0 ? pair.totalWeight / pair.edgeCount : 0;
    const shared = {
      weight: avgWeight,
      examples: pair.examples,
      edgeCount: pair.edgeCount,
      pattern: "structural-edge",
    };

    if (!(pair.fromDomain in result)) result[pair.fromDomain] = [];
    (result[pair.fromDomain] as BridgeEntry[]).push({ ...shared, toDomain: pair.toDomain });

    if (!(pair.toDomain in result)) result[pair.toDomain] = [];
    (result[pair.toDomain] as BridgeEntry[]).push({ ...shared, toDomain: pair.fromDomain });
  }
}

/**
 * Add analogical bridge entries into result.
 * Port of: mcp_server/core/bridge_finder.py::_merge_analogical_bridges
 * source: cortex@ed33435 mcp_server/core/bridge_finder.py:186
 */
function mergeAnalogicalBridges(
  analogiesByDomain: Record<
    string,
    Array<{ nodeId: string; pattern: string; sourceContext: string; targetConcept: string }>
  >,
  result: Record<string, BridgeEntry[]>,
): void {
  for (const [domainId, analogies] of Object.entries(analogiesByDomain)) {
    const byPattern: Record<
      string,
      Array<{ nodeId: string; pattern: string; sourceContext: string; targetConcept: string }>
    > = {};
    for (const a of analogies) {
      if (!(a.pattern in byPattern)) byPattern[a.pattern] = [];
      (byPattern[a.pattern] as typeof byPattern[string]).push(a);
    }

    if (!(domainId in result)) result[domainId] = [];
    for (const [pattern, items] of Object.entries(byPattern)) {
      (result[domainId] as BridgeEntry[]).push({
        toDomain: "text-analogy",
        pattern,
        weight: items.length,
        examples: items.slice(0, 5).map((i) => ({ // source: cortex@ed33435 bridge_finder.py:208
          nodeId: i.nodeId,
          sourceContext: i.sourceContext,
          targetConcept: i.targetConcept,
        })),
        edgeCount: items.length,
      });
    }
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Find cross-domain bridges from structural edges and analogical text.
 *
 * precondition: profiles may be null; brainIndex may be null; memories dict may be null.
 * postcondition: returns domain_id → [bridge_entry] map;
 *   empty map when no cross-domain connections found.
 *
 * Port of: mcp_server/core/bridge_finder.py::find_bridges
 * source: cortex@ed33435 mcp_server/core/bridge_finder.py:215
 */
export function findBridges(
  profiles: ProfilesInput | null | undefined,
  brainIndex: BrainIndexInput | null | undefined,
  memories: Record<string, Record<string, unknown>> | null | undefined,
): Record<string, BridgeEntry[]> {
  const allMemories: Record<string, Record<string, unknown>> = {};
  if (brainIndex?.memories) Object.assign(allMemories, brainIndex.memories);
  if (memories) Object.assign(allMemories, memories);

  const allConversations = brainIndex?.conversations ?? {};
  const projectDomainMap = buildProjectDomainMap(profiles);

  const nodes = buildNodeMap(allMemories, allConversations, projectDomainMap);
  const structuralPairs = collectStructuralPairs(nodes);
  const analogiesByDomain = collectAnalogiesByDomain(nodes);

  const result: Record<string, BridgeEntry[]> = {};
  mergeStructuralBridges(structuralPairs, result);
  mergeAnalogicalBridges(analogiesByDomain, result);

  return result;
}
