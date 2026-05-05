/**
 * Cross-domain connection detection from structural edges and text analogies.
 *
 * Two detection methods:
 *   - Structural bridges: cross-references from brain-index (explicit links)
 *   - Analogical bridges: regex-based extraction of analogy patterns in text
 *
 * Pure business logic — no I/O.
 *
 * Port of: cortex@ed33435 mcp_server/core/bridge_finder.py
 */

// ── Analogy regex ─────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/bridge_finder.py:13-17

const ANALOGY_RE = /(like|similar to|analogous to|reminds me of|just as|the same way)\s+(?:a\s+)?(.{5,40})/gi;

// ── Domain map helpers ────────────────────────────────────────────────────

/**
 * Build a mapping of projectId → domainId from profiles.
 * source: cortex@ed33435 mcp_server/core/bridge_finder.py:20-28
 */
function buildProjectDomainMap(profiles: Record<string, unknown> | null): Record<string, string> {
  const mapping: Record<string, string> = {};
  if (!profiles || !profiles["domains"]) return mapping;
  const domains = profiles["domains"] as Record<string, Record<string, unknown>>;
  for (const [domainId, domain] of Object.entries(domains)) {
    const projects = (domain["projects"] ?? domain["projectIds"] ?? []) as string[];
    for (const projectId of projects) {
      mapping[projectId] = domainId;
    }
  }
  return mapping;
}

/**
 * Resolve the domain for a node.
 * source: cortex@ed33435 mcp_server/core/bridge_finder.py:31-37
 */
function resolveDomain(
  node: Record<string, unknown>,
  projectDomainMap: Record<string, string>,
): string {
  const projectId = (node["projectId"] ?? node["project"]) as string | undefined;
  if (projectId && projectDomainMap[projectId]) return projectDomainMap[projectId];
  if (node["domainId"]) return node["domainId"] as string;
  return "unknown";
}

// ── Analogy extraction ────────────────────────────────────────────────────

/**
 * Extract text analogies from a body string.
 * source: cortex@ed33435 mcp_server/core/bridge_finder.py:40-55
 */
function extractAnalogies(
  text: string | null | undefined,
  nodeId: string,
): Array<Record<string, string>> {
  if (!text || typeof text !== "string") return [];
  const results: Array<Record<string, string>> = [];
  for (const match of text.matchAll(ANALOGY_RE)) {
    const start = Math.max(0, (match.index ?? 0) - 60);
    const sourceContext = text.slice(start, match.index ?? 0).trim().slice(-60);
    results.push({
      nodeId,
      pattern: (match[1] ?? "").toLowerCase(),
      sourceContext,
      targetConcept: (match[2] ?? "").trim(),
    });
  }
  return results;
}

// ── Node map builder ──────────────────────────────────────────────────────

interface Node {
  domainId: string;
  body: string;
  crossRefs: Array<string | Record<string, unknown>>;
}

/**
 * Build a unified node map from memories and conversations.
 * source: cortex@ed33435 mcp_server/core/bridge_finder.py:58-83
 */
function buildNodeMap(
  allMemories: Record<string, Record<string, unknown>>,
  allConversations: Record<string, Record<string, unknown>>,
  projectDomainMap: Record<string, string>,
): Record<string, Node> {
  const nodes: Record<string, Node> = {};

  for (const [id, mem] of Object.entries(allMemories)) {
    nodes[id] = {
      domainId: resolveDomain(mem, projectDomainMap),
      body: ((mem["body"] ?? mem["content"]) as string | undefined) ?? "",
      crossRefs: ((mem["crossRefs"] ?? mem["connections"]) as Array<string | Record<string, unknown>> | undefined) ?? [],
    };
  }

  for (const [id, conv] of Object.entries(allConversations)) {
    nodes[id] = {
      domainId: resolveDomain(conv, projectDomainMap),
      body: ((conv["body"] ?? conv["summary"] ?? conv["content"]) as string | undefined) ?? "",
      crossRefs: ((conv["crossRefs"] ?? conv["connections"]) as Array<string | Record<string, unknown>> | undefined) ?? [],
    };
  }

  return nodes;
}

// ── Structural pair helpers ───────────────────────────────────────────────

/**
 * Create a canonical key for an ordered domain pair.
 * source: cortex@ed33435 mcp_server/core/bridge_finder.py:86-90
 */
function makePairKey(domainA: string, domainB: string): string {
  return domainA < domainB ? `${domainA}|||${domainB}` : `${domainB}|||${domainA}`;
}

interface DomainPair {
  fromDomain: string;
  toDomain: string;
  totalWeight: number;
  edgeCount: number;
  examples: Array<{ fromId: string; toId: string }>;
}

/**
 * Add a cross-domain edge to the pair accumulator.
 * source: cortex@ed33435 mcp_server/core/bridge_finder.py:93-116
 */
function accumulateEdge(
  pairs: Record<string, DomainPair>,
  fromDomain: string,
  toDomain: string,
  weight: number,
  fromId: string,
  toId: string,
): void {
  const pairKey = makePairKey(fromDomain, toDomain);
  if (!pairs[pairKey]) {
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
  pair.edgeCount++;
  if (pair.examples.length < 5) {
    pair.examples.push({ fromId, toId });
  }
}

/**
 * Find cross-domain structural edges and aggregate by domain pair.
 * source: cortex@ed33435 mcp_server/core/bridge_finder.py:119-141
 */
function collectStructuralPairs(
  nodes: Record<string, Node>,
): Record<string, DomainPair> {
  const pairs: Record<string, DomainPair> = {};

  for (const [id, node] of Object.entries(nodes)) {
    const fromDomain = node.domainId;
    for (const ref of node.crossRefs) {
      let targetId: string | undefined;
      let weight = 1;
      if (typeof ref === "string") {
        targetId = ref;
      } else {
        targetId = (ref["id"] ?? ref["target"]) as string | undefined;
        weight = (ref["weight"] as number | undefined) ?? 1;
      }
      if (!targetId) continue;
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
 * source: cortex@ed33435 mcp_server/core/bridge_finder.py:144-159
 */
function collectAnalogiesByDomain(
  nodes: Record<string, Node>,
): Record<string, Array<Record<string, string>>> {
  const analogiesByDomain: Record<string, Array<Record<string, string>>> = {};

  for (const [id, node] of Object.entries(nodes)) {
    const analogies = extractAnalogies(node.body, id);
    if (analogies.length === 0) continue;
    const domainId = node.domainId;
    if (!analogiesByDomain[domainId]) analogiesByDomain[domainId] = [];
    analogiesByDomain[domainId].push(...analogies);
  }

  return analogiesByDomain;
}

// ── Merge helpers ─────────────────────────────────────────────────────────

/**
 * Add structural bridge entries (both directions) into result.
 * source: cortex@ed33435 mcp_server/core/bridge_finder.py:162-183
 */
function mergeStructuralBridges(
  structuralPairs: Record<string, DomainPair>,
  result: Record<string, Array<Record<string, unknown>>>,
): void {
  for (const pair of Object.values(structuralPairs)) {
    const avgWeight = pair.edgeCount > 0 ? pair.totalWeight / pair.edgeCount : 0;
    const shared = {
      weight: avgWeight,
      examples: pair.examples,
      edgeCount: pair.edgeCount,
      pattern: "structural-edge",
    };

    const fromList = (result[pair.fromDomain] ??= []);
    fromList.push({ ...shared, toDomain: pair.toDomain });

    const toList = (result[pair.toDomain] ??= []);
    toList.push({ ...shared, toDomain: pair.fromDomain });
  }
}

/**
 * Add analogical bridge entries into result.
 * source: cortex@ed33435 mcp_server/core/bridge_finder.py:186-213
 */
function mergeAnalogicalBridges(
  analogiesByDomain: Record<string, Array<Record<string, string>>>,
  result: Record<string, Array<Record<string, unknown>>>,
): void {
  for (const [domainId, analogies] of Object.entries(analogiesByDomain)) {
    const byPattern: Record<string, Array<Record<string, string>>> = {};
    for (const a of analogies) {
      const p = a["pattern"] ?? "";
      if (!byPattern[p]) byPattern[p] = [];
      byPattern[p].push(a);
    }

    for (const [pattern, items] of Object.entries(byPattern)) {
      if (!result[domainId]) result[domainId] = [];
      result[domainId].push({
        toDomain: "text-analogy",
        pattern,
        weight: items.length,
        examples: items.slice(0, 5).map((i) => ({
          nodeId: i["nodeId"],
          sourceContext: i["sourceContext"],
          targetConcept: i["targetConcept"],
        })),
        edgeCount: items.length,
      });
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Find cross-domain bridges from structural edges and analogical text.
 *
 * precondition:  profiles, brainIndex, memories may all be null.
 * postcondition: returned map has domain IDs as keys; each value is a list
 *   of bridge objects with toDomain, pattern, weight, examples, edgeCount.
 *
 * source: cortex@ed33435 mcp_server/core/bridge_finder.py:215-238
 */
export function findBridges(
  profiles: Record<string, unknown> | null,
  brainIndex: Record<string, unknown> | null,
  memories: Record<string, Record<string, unknown>> | null = null,
): Record<string, Array<Record<string, unknown>>> {
  const allMemories: Record<string, Record<string, unknown>> = {};
  if (brainIndex?.["memories"]) {
    Object.assign(allMemories, brainIndex["memories"] as Record<string, unknown>);
  }
  if (memories) Object.assign(allMemories, memories);

  const allConversations = (brainIndex?.["conversations"] as Record<string, Record<string, unknown>> | undefined) ?? {};
  const projectDomainMap = buildProjectDomainMap(profiles);

  const nodes = buildNodeMap(allMemories, allConversations, projectDomainMap);
  const structuralPairs = collectStructuralPairs(nodes);
  const analogiesByDomain = collectAnalogiesByDomain(nodes);

  const result: Record<string, Array<Record<string, unknown>>> = {};
  mergeStructuralBridges(structuralPairs, result);
  mergeAnalogicalBridges(analogiesByDomain, result);

  return result;
}
