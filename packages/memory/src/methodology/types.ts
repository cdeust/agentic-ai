/**
 * Methodology subsystem type definitions.
 *
 * The persona vector is a fixed 12-dimensional space:
 *   Dims 1-3  (continuous): activeReflective, sensingIntuitive, sequentialGlobal
 *             Felder-Silverman cognitive style axes — all in [-1, 1]
 *   Dims 4-9  (continuous): thoroughness, autonomy, verbosity, riskTolerance,
 *             focusScope, iterationSpeed — all in [-1, 1]
 *   Dims 10-12 (categorical): problemDecomposition, explorationStyle,
 *             verificationBehavior — string labels
 *
 * The 9 numeric dimensions are the load-bearing signal surface for EMA updates
 * and parity tests (L2 distance tolerance). The 3 categorical dimensions are
 * majority-rule updated and tested for label-equality.
 *
 * source: CLAUDE.md global instructions ("12D per CLAUDE.md"); persona_vector.py
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** Total persona vector dimension count (9 numeric + 3 categorical). */
export const PERSONA_VECTOR_DIM = 12 as const;

/** Numeric persona dimensions — indices 0-8 of the 12D vector. */
export const PERSONA_NUMERIC_DIMENSIONS = [
  "activeReflective",
  "sensingIntuitive",
  "sequentialGlobal",
  "thoroughness",
  "autonomy",
  "verbosity",
  "riskTolerance",
  "focusScope",
  "iterationSpeed",
] as const;

/** Categorical persona dimensions — indices 9-11 of the 12D vector. */
export const PERSONA_CATEGORICAL_DIMENSIONS = [
  "problemDecomposition",
  "explorationStyle",
  "verificationBehavior",
] as const;

/** All 12 persona dimension names in order. */
export const PERSONA_DIMENSIONS = [
  ...PERSONA_NUMERIC_DIMENSIONS,
  ...PERSONA_CATEGORICAL_DIMENSIONS,
] as const;

export type PersonaNumericDim = typeof PERSONA_NUMERIC_DIMENSIONS[number];
export type PersonaCategoricalDim = typeof PERSONA_CATEGORICAL_DIMENSIONS[number];
export type PersonaDim = typeof PERSONA_DIMENSIONS[number];

// ── Felder-Silverman metacognitive style ─────────────────────────────────────

/** Continuous axes of Felder-Silverman cognitive style, clamped to [-1, 1]. */
export interface CognitiveStyle {
  /** Felder-Silverman active/reflective axis: 1=active, -1=reflective. */
  activeReflective: number;
  /** Felder-Silverman sensing/intuitive axis: 1=sensing, -1=intuitive. */
  sensingIntuitive: number;
  /** Felder-Silverman sequential/global axis: 1=sequential, -1=global. */
  sequentialGlobal: number;
  /** How the user decomposes problems. */
  problemDecomposition?: string;
  /** User exploration style label. */
  explorationStyle?: string;
  /** User verification behavior label. */
  verificationBehavior?: string;
}

// ── 9-dimensional numeric persona sub-vector ─────────────────────────────────

/** The nine numeric dimensions of the persona vector, all in [-1, 1]. */
export type PersonaNumericVector = {
  [K in PersonaNumericDim]: number;
};

/** Full 12-dimensional persona vector including categorical dimensions. */
export type PersonaVector = PersonaNumericVector & {
  [K in PersonaCategoricalDim]?: string;
};

// ── Session shape ─────────────────────────────────────────────────────────────

export interface SessionShape {
  avgDuration: number;
  avgTurns: number;
  avgMessages: number;
  burstRatio: number;
  explorationRatio: number;
  dominantMode: "burst" | "exploration" | "mixed";
}

// ── Tool preferences ─────────────────────────────────────────────────────────

export interface ToolStat {
  ratio: number;
  avgPerSession: number;
}

export type ToolPreferences = Record<string, ToolStat>;

// ── Blind spot ───────────────────────────────────────────────────────────────

export interface BlindSpot {
  type: "category" | "tool" | "pattern";
  value: string;
  severity: "high" | "medium" | "low";
  description: string;
  suggestion: string;
}

// ── Connection bridge ─────────────────────────────────────────────────────────

export interface ConnectionBridge {
  toDomain: string;
  pattern: string;
  weight: number;
  edgeCount: number;
  examples: Array<Record<string, string>>;
}

// ── Feature activation ────────────────────────────────────────────────────────

export interface FeatureActivation {
  index: number;
  label: string;
  description: string;
  topSignals: Array<{ signal: string; weight: number }>;
}

export interface FeatureDictionary {
  K: number;
  D: number;
  sparsity: number;
  learnedFromSessions: number;
  features: FeatureActivation[];
  signalNames: string[];
}

// ── Domain profile ────────────────────────────────────────────────────────────

/**
 * A single cognitive domain profile — the Level-1 data structure.
 *
 * The Level-2 structure is the MethodologyEngine which governs HOW these
 * profiles are updated and queried. Bateson constraint: never flatten these
 * two levels — a profile update (L1) is NOT the same operation as the
 * methodology engine deciding which profile to update (L2).
 */
export interface DomainProfile {
  id: string;
  label: string;
  projects: string[];
  categories: Record<string, number>;
  topKeywords: string[];
  entryPoints: string[];
  recurringPatterns: string[];
  toolPreferences: ToolPreferences;
  sessionShape: SessionShape;
  connectionBridges: ConnectionBridge[];
  blindSpots: BlindSpot[];
  metacognitive: CognitiveStyle;
  confidence: number;
  sessionCount: number;
  lastUpdated: string | null;
  firstSeen: string | null;
  featureActivations?: Record<string, number>;
  personaVector?: PersonaVector;
  categoryDistribution?: Record<string, number>;
}

// ── Profiles store ────────────────────────────────────────────────────────────

export interface ProfilesStore {
  domains: Record<string, DomainProfile>;
  globalStyle?: CognitiveStyle & { confidence: number; sessionCount: number };
  featureDictionary?: FeatureDictionary;
  persistentFeatures?: PersistentFeature[];
  updatedAt?: string;
}

// ── Cross-domain features ─────────────────────────────────────────────────────

export interface PersistentFeature {
  label: string;
  /** Fraction of domains where this feature is active [0, 1]. */
  persistence: number;
  /** Standard deviation of activation values across active domains. */
  consistency: number;
  domains: string[];
}

// ── Detection result ──────────────────────────────────────────────────────────

export interface DomainDetectionResult {
  coldStart: boolean;
  domain: string | null;
  confidence: number;
  isNew: boolean;
  alternativeDomains: Array<{ id: string; confidence: number }>;
  context?: string;
}

// ── Methodology query / response ──────────────────────────────────────────────

export interface MethodologyQuery {
  cwd?: string;
  project?: string;
  firstMessage?: string;
}

export interface HotMemory {
  content: string;
  heat: number;
  domain: string;
  tags: string[];
  importance: number;
  createdAt: string;
}

export interface FiredTrigger {
  content: string;
  triggerType: string;
  triggerCondition: string;
  triggeredCount: number;
}

export interface MethodologyResponse {
  domain: string | null;
  confidence: number;
  coldStart: boolean;
  context: string;
  style: CognitiveStyle | null;
  entryPoints: string[];
  recurringPatterns: string[];
  toolPreferences: ToolPreferences;
  blindSpots: BlindSpot[];
  connectionBridges: ConnectionBridge[];
  sessionCount: number;
  lastActive: string | null;
  alternativeDomains?: Array<{ id: string; confidence: number }>;
  hotMemories: HotMemory[];
  firedTriggers: FiredTrigger[];
}

// ── Domain context (for detect_domain handler) ────────────────────────────────

export interface DomainContext {
  cwd?: string;
  project?: string;
  firstMessage?: string;
}

// ── Attribution graph ─────────────────────────────────────────────────────────

export interface AttributionNode {
  id: string;
  label: string;
  layer: "input" | "extractor" | "classifier" | "feature" | "aggregator" | "output";
  activation: number;
}

export interface AttributionEdge {
  source: string;
  target: string;
  weight: number;
}

export interface AttributionGraph {
  nodes: AttributionNode[];
  edges: AttributionEdge[];
}

// ── Session data (for incremental EMA update) ─────────────────────────────────

export interface SessionData {
  sessionId: string;
  domain?: string;
  cwd?: string;
  project?: string;
  toolsUsed?: string[];
  duration?: number;
  turnCount?: number;
  keywords?: string[];
}

// ── Session log entry ─────────────────────────────────────────────────────────

export interface SessionLogEntry {
  sessionId: string;
  domain: string;
  timestamp: string;
  project: string | null;
  cwd: string | null;
  duration: number | null;
  turnCount: number;
  toolsUsed: string[];
  category: string;
  entryKeywords: string[];
}

export interface SessionLog {
  sessions: SessionLogEntry[];
}

// ── Critique ──────────────────────────────────────────────────────────────────

export interface CritiqueResult {
  overallScore: number;
  topSuggestions: string[];
  critiqueText?: string;
}
