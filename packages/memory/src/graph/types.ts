/**
 * Graph-navigation types for the cognitive-map memory traversal subsystem.
 *
 * NAMING NOTE (ADR-0003 disambiguation): This module defines the COGNITIVE-MAP
 * graph — i.e. memory nodes connected by temporal co-access (Successor
 * Representation). This is distinct from the codebase symbol-graph
 * (packages/codebase/src/graph/). All types are prefixed with "Cognitive"
 * where ambiguity would otherwise arise.
 *
 * source: Dayan (1993) "Improving Generalization for Temporal Difference
 *   Learning" — Successor Representation motivation for the graph structure.
 * source: Stachenfeld et al. (2017) "The Hippocampus as a Predictive Map" —
 *   biological grounding for the temporal co-access model.
 * source: Collins & Loftus (1975) "A spreading-activation theory of semantic
 *   processing" — heat/activation propagation model.
 */

import { z } from "zod";

// ── Cognitive graph node ───────────────────────────────────────────────────

/**
 * A node in the cognitive-map SR graph.
 * Each node is a persisted memory with heat and access metadata.
 */
export const CognitiveGraphNodeSchema = z.object({
  id: z.number().int().positive(),
  content: z.string(),
  heat: z.number().min(0).max(1).default(0),
  domain: z.string().optional(),
  tags: z.array(z.string()).default([]),
  lastAccessed: z.string().optional(), // ISO 8601 timestamp
  accessCount: z.number().int().min(0).default(0),
});

export type CognitiveGraphNode = z.infer<typeof CognitiveGraphNodeSchema>;

// ── Graph edge ─────────────────────────────────────────────────────────────

/**
 * A directed, weighted edge in the SR graph.
 * Weight = temporal proximity score (0, 1].
 *
 * source: build_temporal_co_access in cognitive_map.py:
 *   proximity = 1.0 - (gap / window_secs)
 */
export const CognitiveGraphEdgeSchema = z.object({
  sourceId: z.number().int().positive(),
  targetId: z.number().int().positive(),
  weight: z.number().min(0).max(1),
});

export type CognitiveGraphEdge = z.infer<typeof CognitiveGraphEdgeSchema>;

// ── SR graph adjacency ─────────────────────────────────────────────────────

/**
 * Adjacency map: sourceId → { targetId → weight }.
 * This is the in-memory representation used by all traversal functions.
 * Corresponds to Python dict[int, dict[int, float]].
 */
export type SRGraph = Map<number, Map<number, number>>;

/**
 * Plain-object SR graph (serialisable). Used at handler boundaries.
 */
export type SRGraphRecord = Record<number, Record<number, number>>;

// ── Navigation request / response ──────────────────────────────────────────

export const NavigationRequestSchema = z.object({
  memoryId: z.number().int().positive(),
  maxDepth: z.number().int().min(1).max(4).default(2),
  include2dMap: z.boolean().default(false),
  windowHours: z.number().min(0.1).max(168).default(2.0),
});

export type NavigationRequest = z.infer<typeof NavigationRequestSchema>;

export const NavigationNeighborSchema = z.object({
  memoryId: z.number().int().positive(),
  srDistance: z.number().min(0).max(1),
  hops: z.number().int().min(1),
  path: z.array(z.number().int().positive()),
  content: z.string(),
  heat: z.number().min(0),
  domain: z.string().optional(),
  tags: z.array(z.string()),
});

export type NavigationNeighbor = z.infer<typeof NavigationNeighborSchema>;

export const NavigationResponseSchema = z.object({
  startMemoryId: z.number().int().positive(),
  startContent: z.string().optional(),
  neighbors: z.array(NavigationNeighborSchema),
  total: z.number().int().min(0),
  maxDepth: z.number().int().optional(),
  srGraphSize: z.number().int().min(0),
  reason: z.string().optional(),
  coordinates2d: z
    .record(z.string(), z.tuple([z.number(), z.number()]))
    .optional(),
});

export type NavigationResponse = z.infer<typeof NavigationResponseSchema>;

// ── Heat / spreading-activation config ────────────────────────────────────

/**
 * Configuration for spreading-activation heat propagation.
 *
 * source: Collins & Loftus (1975) — decay and threshold parameters.
 * source: spreading_activation.py defaults: decay=0.65, threshold=0.1,
 *   maxDepth=3, maxNodes=50.
 */
export const HeatPropagationConfigSchema = z.object({
  /**
   * Activation decay factor per hop (0 < decay < 1).
   * source: spreading_activation.py _DEFAULT_DECAY = 0.65
   */
  decay: z.number().min(0).max(1).default(0.65),

  /**
   * Minimum activation to continue propagation.
   * source: spreading_activation.py _DEFAULT_THRESHOLD = 0.1
   */
  threshold: z.number().min(0).default(0.1),

  /**
   * Maximum BFS depth for propagation.
   * source: spreading_activation.py _DEFAULT_MAX_DEPTH = 3
   */
  maxDepth: z.number().int().min(1).default(3),

  /**
   * Cap on total activated nodes (keep top by activation score).
   * source: spreading_activation.py _DEFAULT_MAX_NODES = 50
   */
  maxNodes: z.number().int().min(1).default(50),

  /**
   * Initial activation assigned to each seed entity.
   */
  initialActivation: z.number().min(0).default(1.0),
});

export type HeatPropagationConfig = z.infer<typeof HeatPropagationConfigSchema>;

// ── Entity graph for spreading activation ────────────────────────────────

/**
 * Adjacency list: entity_id → [(neighbor_id, edge_weight)].
 * Corresponds to Python type alias EntityGraph.
 */
export type EntityGraph = Map<number, Array<[number, number]>>;

// ── BFS navigation result ──────────────────────────────────────────────────

export interface BFSNodeResult {
  /** Cumulative SR distance from start: 1.0 - cumulativeWeight. */
  distance: number;
  hops: number;
  path: number[];
}

export type BFSNavigationResult = Map<number, BFSNodeResult>;

// ── 2D projection ──────────────────────────────────────────────────────────

export type Coordinates2D = Map<number, [number, number]>;
