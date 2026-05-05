/* eslint-disable @typescript-eslint/no-magic-numbers -- source: exact port of Python source; all numeric literals copied verbatim from cited Python file */
/**
 * Node construction helpers for the unified graph builder.
 *
 * Builds a 6-level hierarchy: root → category → project → agent → type-group → leaf.
 * Each function appends nodes (and direct parent-child edges) for one level.
 * Pure business logic — no I/O.
 *
 * Memory and entity node builders live in graph-builder-memory.ts (not yet ported).
 *
 * source: Cortex mcp_server/core/graph_builder_nodes.py
 */

export type Node = Record<string, unknown>;
export type Edge = Record<string, unknown>;
export type IdAllocator = (prefix: string) => string;

// ── Colors ───────────────────────────────────────────────────────────
// source: Cortex mcp_server/core/graph_builder_nodes.py — all hex values ported verbatim
// from the Python source; palette is Clément Deust's design, not from a paper.

export const ROOT_COLOR = "#FFFFFF"; // source: Cortex graph_builder_nodes.py::ROOT_COLOR
export const CATEGORY_COLOR = "#8B5CF6"; // source: Cortex graph_builder_nodes.py::CATEGORY_COLOR
export const DOMAIN_COLOR = "#E8B840"; // source: Cortex graph_builder_nodes.py::DOMAIN_COLOR
export const AGENT_COLOR = "#2DD4BF"; // source: Cortex graph_builder_nodes.py::AGENT_COLOR
export const TYPE_GROUP_COLOR = "#64748B"; // source: Cortex graph_builder_nodes.py::TYPE_GROUP_COLOR
export const ENTRY_COLOR = "#60D8F0"; // source: Cortex graph_builder_nodes.py::ENTRY_COLOR
export const PATTERN_COLOR = "#70D880"; // source: Cortex graph_builder_nodes.py::PATTERN_COLOR
export const TOOL_COLOR = "#E0A840"; // source: Cortex graph_builder_nodes.py::TOOL_COLOR
export const FEATURE_COLOR = "#B088E0"; // source: Cortex graph_builder_nodes.py::FEATURE_COLOR
export const MEMORY_COLORS: Record<string, string> = {
  episodic: "#58D888", // source: Cortex graph_builder_nodes.py::MEMORY_COLORS
  semantic: "#C070D0", // source: Cortex graph_builder_nodes.py::MEMORY_COLORS
};
export const ENTITY_COLORS: Record<string, string> = {
  function: "#50D0E8",   // source: Cortex graph_builder_nodes.py::ENTITY_COLORS
  dependency: "#60A0E0", // source: Cortex graph_builder_nodes.py::ENTITY_COLORS
  error: "#E07070",      // source: Cortex graph_builder_nodes.py::ENTITY_COLORS
  decision: "#E0C050",   // source: Cortex graph_builder_nodes.py::ENTITY_COLORS
  technology: "#9080D0", // source: Cortex graph_builder_nodes.py::ENTITY_COLORS
  file: "#7088D0",       // source: Cortex graph_builder_nodes.py::ENTITY_COLORS
  variable: "#50B8D0",   // source: Cortex graph_builder_nodes.py::ENTITY_COLORS
};

export const DISCUSSION_COLOR = "#F43F5E"; // source: Cortex graph_builder_nodes.py::DISCUSSION_COLOR

export const EDGE_COLORS: Record<string, string> = {
  "has-category": "#B0B0B0",       // source: Cortex graph_builder_nodes.py::EDGE_COLORS
  "has-project": "#8B5CF6",        // source: Cortex graph_builder_nodes.py::EDGE_COLORS
  "has-agent": "#2DD4BF",          // source: Cortex graph_builder_nodes.py::EDGE_COLORS
  "has-group": "#64748B",          // source: Cortex graph_builder_nodes.py::EDGE_COLORS
  groups: "#50C8E0",               // source: Cortex graph_builder_nodes.py::EDGE_COLORS
  bridge: "#FF00FF",               // source: Cortex graph_builder_nodes.py::EDGE_COLORS
  "persistent-feature": "#ec4899", // source: Cortex graph_builder_nodes.py::EDGE_COLORS
  "memory-entity": "#40A0B8",      // source: Cortex graph_builder_nodes.py::EDGE_COLORS
  "domain-entity": "#50B0C8",      // source: Cortex graph_builder_nodes.py::EDGE_COLORS
  "has-discussion": "#F43F5E60",   // source: Cortex graph_builder_nodes.py::EDGE_COLORS
  "domain-contains": "#06b6d4",    // source: Cortex graph_builder_nodes.py::EDGE_COLORS
  "topic-member": "#06b6d480",     // source: Cortex graph_builder_nodes.py::EDGE_COLORS
  "co-entity": "#a78bfa",          // source: Cortex graph_builder_nodes.py::EDGE_COLORS
};

// ── Technology category classification ───────────────────────────────

const _TECH_KEYWORDS: Record<string, ReadonlySet<string>> = {
  Backend: new Set([
    "api", "database", "server", "fastapi", "postgresql", "auth",
    "migration", "backend", "endpoint", "middleware", "sql", "redis",
    "graphql", "rest", "microservice", "celery", "django", "flask",
  ]),
  Frontend: new Set([
    "react", "typescript", "component", "ui", "android", "css",
    "rendering", "frontend", "html", "vue", "angular", "swift", "ios",
    "mobile", "widget", "layout", "animation", "navigation",
  ]),
  "AI/Research": new Set([
    "prd", "metaprompting", "orchestration", "research", "prompting",
    "rag", "strategy", "llm", "model", "embedding", "benchmark",
    "evaluation", "thinking", "cognitive", "neural", "memory",
    "thermodynamic", "cortex", "methodology",
  ]),
  DevOps: new Set([
    "deploy", "docker", "ci", "pipeline", "git", "homebrew", "compiler",
    "build", "infrastructure", "terraform", "kubernetes", "monitoring",
    "logging", "container", "certificate",
  ]),
};

/**
 * Classify a domain profile into a technology category.
 *
 * Uses topKeywords and tool names for signal. Returns the best-matching
 * category or 'General' as fallback.
 */
export function classifyTechCategory(dp: Record<string, unknown>): string {
  const keywords = new Set<string>(
    ((dp["topKeywords"] as string[]) ?? []).map((k) => k.toLowerCase()),
  );
  // Add tool names as signal
  for (const toolName of Object.keys((dp["toolPreferences"] as Record<string, unknown>) ?? {})) {
    keywords.add(toolName.toLowerCase());
  }

  let bestCat = "General";
  let bestScore = 0;
  for (const [cat, catKeywords] of Object.entries(_TECH_KEYWORDS)) {
    let score = 0;
    for (const k of keywords) {
      if (catKeywords.has(k)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCat = cat;
    }
  }
  return bestCat;
}

// ── Level 0: Root node ───────────────────────────────────────────────

/** Create the single root node. Returns its id. */
export function addRootNode(nextId: IdAllocator, nodes: Node[]): string {
  const nid = nextId("root");
  nodes.push({
    id: nid,
    type: "root",
    label: "Cortex",
    domain: "",
    color: ROOT_COLOR,
    size: 30,
    group: "_root",
    content: "Cortex — cognitive profiling & persistent memory",
  });
  return nid;
}

// ── Level 1: Category nodes ─────────────────────────────────────────

/** Create a technology category node linked to root. Returns its id. */
export function addCategoryNode(
  name: string,
  rootId: string,
  nextId: IdAllocator,
  nodes: Node[],
  edges: Edge[],
): string {
  const nid = nextId("cat");
  nodes.push({
    id: nid,
    type: "category",
    label: name,
    domain: "",
    color: CATEGORY_COLOR,
    size: 12,
    group: "_categories",
    content: `Technology category: ${name}`,
  });
  edges.push({
    source: rootId,
    target: nid,
    type: "has-category",
    weight: 0.8,
    color: EDGE_COLORS["has-category"],
  });
  return nid;
}

// ── Level 2: Project (domain) nodes ─────────────────────────────────

/** Create a project/domain hub node linked to its category. Returns its id. */
export function addDomainHub(
  dp: Record<string, unknown>,
  domainKey: string,
  categoryId: string,
  nextId: IdAllocator,
  nodes: Node[],
  edges: Edge[],
): string {
  const hubId = nextId("dom");
  const sessionCount = Number(dp["sessionCount"] ?? 0);
  const confidence = Number(dp["confidence"] ?? 0);
  nodes.push({
    id: hubId,
    type: "domain",
    label: dp["label"] ?? domainKey,
    domain: domainKey,
    color: DOMAIN_COLOR,
    size: Math.max(6, Math.min(25, Math.sqrt(sessionCount || 1) * 2)),
    group: domainKey,
    sessionCount,
    confidence,
    content: `${dp["label"] ?? domainKey} — ${sessionCount} sessions, confidence ${(confidence * 100).toFixed(0)}%`, // source: Cortex graph_builder_nodes.py::add_domain_hub content format
  });
  edges.push({
    source: categoryId,
    target: hubId,
    type: "has-project",
    weight: 0.7,
    color: EDGE_COLORS["has-project"],
  });
  return hubId;
}

// ── Level 3: Agent nodes ────────────────────────────────────────────

/** Create an agent node linked to its project. Returns its id. */
export function addAgentNode(
  agent: Record<string, unknown>,
  domainKey: string,
  hubId: string,
  nextId: IdAllocator,
  nodes: Node[],
  edges: Edge[],
): string {
  const nid = nextId("agent");
  nodes.push({
    id: nid,
    type: "agent",
    label: agent["name"],
    domain: domainKey,
    color: AGENT_COLOR,
    size: 6,
    group: domainKey,
    content: agent["description"] ?? agent["name"],
    toolCount: ((agent["tools"] as unknown[]) ?? []).length,
  });
  edges.push({
    source: hubId,
    target: nid,
    type: "has-agent",
    weight: 0.6,
    color: EDGE_COLORS["has-agent"],
  });
  return nid;
}

// ── Level 4: Type-group nodes ───────────────────────────────────────

export const TYPE_GROUP_LABELS = [
  "Entry Points",
  "Patterns",
  "Tools",
  "Features",
  "Memories",
  "Discussions",
];

/**
 * Create type-group nodes under a parent (agent or hub).
 * Returns {label: nid}.
 */
export function addTypeGroupNodes(
  parentId: string,
  domainKey: string,
  nextId: IdAllocator,
  nodes: Node[],
  edges: Edge[],
  labels: string[] = TYPE_GROUP_LABELS,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const label of labels) {
    const nid = nextId("tg");
    nodes.push({
      id: nid,
      type: "type-group",
      label,
      domain: domainKey,
      color: TYPE_GROUP_COLOR,
      size: 3,
      group: domainKey,
      content: `${label} for ${domainKey}`,
    });
    edges.push({
      source: parentId,
      target: nid,
      type: "has-group",
      weight: 0.5,
      color: EDGE_COLORS["has-group"],
    });
    result[label] = nid;
  }
  return result;
}

// ── Level 5: Leaf node builders ──────────────────────────────────────

/** Filter out nonsensical n-gram patterns (hashes, random word combos). */
function isReadablePattern(pattern: string): boolean {
  if (!pattern || pattern.length < 3) return false;
  const parts = pattern.replace(/\//g, " ").split(/\s+/).map((p) => p.trim());
  for (const p of parts) {
    if (p.length > 8 && /^[0-9a-f]+$/.test(p)) return false;
  }
  const stopwords = new Set([
    "json", "general", "against", "through", "already", "instead",
    "context", "updates", "meaning", "continue", "connect", "acceptable",
    "violating", "interactive", "verified", "updated", "internal", "background",
  ]);
  const meaningful = parts.filter((p) => p.length > 2 && !stopwords.has(p.toLowerCase()));
  return meaningful.length >= 1;
}

/** Add entry-point leaf nodes linked to a type-group parent. */
export function addEntryPoints(
  dp: Record<string, unknown>,
  domainKey: string,
  parentId: string,
  nextId: IdAllocator,
  nodes: Node[],
  edges: Edge[],
): void {
  for (const ep of ((dp["entryPoints"] as Record<string, unknown>[]) ?? [])) {
    const pattern = String(ep["pattern"] ?? "");
    if (!isReadablePattern(pattern)) continue;
    const label = pattern.replace(/ \/ /g, ", ");
    const nid = nextId("entry");
    const freq = Number(ep["frequency"] ?? 0);
    nodes.push({
      id: nid,
      type: "entry-point",
      label,
      domain: domainKey,
      color: ENTRY_COLOR,
      size: Math.max(3, Math.min(12, (freq || 1) * 1.5)),
      group: domainKey,
      confidence: Number(ep["confidence"] ?? 0),
      frequency: freq,
      content: pattern,
    });
    edges.push({
      source: parentId,
      target: nid,
      type: "groups",
      weight: Number(ep["confidence"] ?? 0.5),
      color: EDGE_COLORS["groups"],
    });
  }
}

/** Add recurring-pattern leaf nodes linked to a type-group parent. */
export function addRecurringPatterns(
  dp: Record<string, unknown>,
  domainKey: string,
  parentId: string,
  nextId: IdAllocator,
  nodes: Node[],
  edges: Edge[],
): void {
  for (const rp of ((dp["recurringPatterns"] as Record<string, unknown>[]) ?? [])) {
    const nid = nextId("pat");
    const freq = Number(rp["frequency"] ?? 0);
    nodes.push({
      id: nid,
      type: "recurring-pattern",
      label: String(rp["pattern"] ?? ""),
      domain: domainKey,
      color: PATTERN_COLOR,
      size: Math.max(3, Math.min(12, (freq || 1) * 1.2)),
      group: domainKey,
      confidence: Number(rp["confidence"] ?? 0),
      frequency: freq,
      content: String(rp["pattern"] ?? ""),
    });
    edges.push({
      source: parentId,
      target: nid,
      type: "groups",
      weight: Number(rp["confidence"] ?? 0.5),
      color: EDGE_COLORS["groups"],
    });
  }
}

/** Add top-5 tool-preference leaf nodes linked to a type-group parent. */
export function addToolPreferences(
  dp: Record<string, unknown>,
  domainKey: string,
  parentId: string,
  nextId: IdAllocator,
  nodes: Node[],
  edges: Edge[],
): void {
  const toolPrefs = (dp["toolPreferences"] as Record<string, Record<string, number>>) ?? {};
  const topTools = Object.entries(toolPrefs)
    .sort(([, a], [, b]) => (b["ratio"] ?? 0) - (a["ratio"] ?? 0))
    .slice(0, 5);
  for (const [toolName, pref] of topTools) {
    const nid = nextId("tool");
    const ratio = pref["ratio"] ?? 0;
    const avgPerSession = pref["avgPerSession"] ?? 0;
    nodes.push({
      id: nid,
      type: "tool-preference",
      label: toolName,
      domain: domainKey,
      color: TOOL_COLOR,
      size: Math.max(3, Math.min(10, ratio * 10)),
      group: domainKey,
      ratio,
      avgPerSession,
      content: `${toolName} (usage: ${(ratio * 100).toFixed(0)}%, avg/session: ${avgPerSession})`, // source: Cortex graph_builder_nodes.py::add_tool_preferences content format
    });
    edges.push({
      source: parentId,
      target: nid,
      type: "groups",
      weight: ratio,
      color: EDGE_COLORS["groups"],
    });
  }
}

/** Add behavioral-feature leaf nodes linked to a type-group parent. */
export function addBehavioralFeatures(
  dp: Record<string, unknown>,
  domainKey: string,
  parentId: string,
  nextId: IdAllocator,
  nodes: Node[],
  edges: Edge[],
): void {
  for (const [featLabel, weight] of Object.entries(
    (dp["featureActivations"] as Record<string, number>) ?? {},
  )) {
    if (Math.abs(weight) < 0.05) continue; // source: Cortex graph_builder_nodes.py::add_behavioral_features minimum activation threshold
    const nid = nextId("feat");
    nodes.push({
      id: nid,
      type: "behavioral-feature",
      label: featLabel,
      domain: domainKey,
      color: FEATURE_COLOR,
      size: Math.max(2, Math.min(8, Math.abs(weight) * 10)),
      group: domainKey,
      activation: weight,
      content: `${featLabel} (activation: ${weight >= 0 ? "+" : ""}${weight.toFixed(3)})`,
    });
    edges.push({
      source: parentId,
      target: nid,
      type: "groups",
      weight: Math.abs(weight),
      color: EDGE_COLORS["groups"],
    });
  }
}
