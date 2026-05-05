/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * Memory system configuration — extends Cortex config with thermodynamic
 * memory settings.
 *
 * All settings are overridable via CORTEX_MEMORY_ env prefix.
 * Defaults tuned from production parameters.
 *
 * Layer: INFRASTRUCTURE (configuration — read-once at startup, frozen).
 * source: Cortex mcp_server/infrastructure/memory_config.py
 */

import * as path from "node:path";
import { METHODOLOGY_DIR } from "./config.js";

/** Runtime environment: "cli" | "cowork". */
type CortexRuntime = "cli" | "cowork";

/**
 * Detect runtime environment.
 *
 * source: Cortex mcp_server/infrastructure/memory_config.py:_detect_runtime
 */
function _detectRuntime(): CortexRuntime {
  const explicit = process.env["CORTEX_RUNTIME"] ?? "";
  if (explicit === "cli" || explicit === "cowork") return explicit;
  if (process.env["CLAUDE_ENVIRONMENT"] === "cowork") return "cowork";
  return "cli";
}

function _env(key: string): string | undefined {
  return process.env[`CORTEX_MEMORY_${key}`];
}

function _str(key: string, def: string): string {
  return _env(key) ?? def;
}

function _int(key: string, def: number): number {
  const v = _env(key);
  if (!v) return def;
  const n = parseInt(v, 10);
  return isFinite(n) ? n : def;
}

function _float(key: string, def: number): number {
  const v = _env(key);
  if (!v) return def;
  const n = parseFloat(v);
  return isFinite(n) ? n : def;
}

function _bool(key: string, def: boolean): boolean {
  const v = _env(key);
  if (!v) return def;
  const low = v.trim().toLowerCase();
  if (low === "true" || low === "1") return true;
  if (low === "false" || low === "0") return false;
  return def;
}

/** Thermodynamic memory configuration. */
export interface MemorySettings {
  // ── Runtime ──────────────────────────────────────────────────────────
  // source: Cortex mcp_server/infrastructure/memory_config.py — RUNTIME
  RUNTIME: CortexRuntime;

  // ── Storage ──────────────────────────────────────────────────────────
  // source: Cortex mcp_server/infrastructure/memory_config.py — DATABASE_URL
  DATABASE_URL: string;
  // source: Cortex mcp_server/infrastructure/memory_config.py — DB_PATH (deprecated)
  DB_PATH: string;
  // source: Cortex mcp_server/infrastructure/memory_config.py — SQLITE_FALLBACK_PATH
  SQLITE_FALLBACK_PATH: string;
  // source: Cortex mcp_server/infrastructure/memory_config.py — STORE_BACKEND
  STORE_BACKEND: string;
  // source: Cortex mcp_server/infrastructure/memory_config.py — SESSION_LOG_ROLLING_LIMIT
  SESSION_LOG_ROLLING_LIMIT: number;

  // ── Thermodynamics ────────────────────────────────────────────────────
  // source: Cortex mcp_server/infrastructure/memory_config.py — DECAY_FACTOR
  DECAY_FACTOR: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — IMPORTANCE_DECAY_FACTOR
  IMPORTANCE_DECAY_FACTOR: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — COLD_THRESHOLD
  COLD_THRESHOLD: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — HOT_THRESHOLD
  HOT_THRESHOLD: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — SURPRISE_BOOST
  SURPRISE_BOOST: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — EMOTIONAL_DECAY_RESISTANCE
  EMOTIONAL_DECAY_RESISTANCE: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — SYNAPTIC_WINDOW_MINUTES
  SYNAPTIC_WINDOW_MINUTES: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — SYNAPTIC_BOOST
  SYNAPTIC_BOOST: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — SESSION_COHERENCE_BONUS
  SESSION_COHERENCE_BONUS: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — SESSION_COHERENCE_WINDOW_HOURS
  SESSION_COHERENCE_WINDOW_HOURS: number;

  // ── Retrieval ─────────────────────────────────────────────────────────
  // source: Cortex mcp_server/infrastructure/memory_config.py — DEFAULT_RECALL_LIMIT
  DEFAULT_RECALL_LIMIT: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — WRRF_K = 60
  WRRF_K: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — WRRF_CANDIDATE_MULTIPLIER
  WRRF_CANDIDATE_MULTIPLIER: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — WRRF_VECTOR_WEIGHT
  WRRF_VECTOR_WEIGHT: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — WRRF_FTS_WEIGHT
  WRRF_FTS_WEIGHT: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — WRRF_HEAT_WEIGHT
  WRRF_HEAT_WEIGHT: number;

  // ── Hopfield ──────────────────────────────────────────────────────────
  // source: Cortex mcp_server/infrastructure/memory_config.py — HOPFIELD_BETA
  HOPFIELD_BETA: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — HOPFIELD_MAX_PATTERNS
  HOPFIELD_MAX_PATTERNS: number;

  // ── Spreading Activation (Collins & Loftus 1975) ─────────────────────
  // source: Cortex mcp_server/infrastructure/memory_config.py — SA_DECAY
  SA_DECAY: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — SA_THRESHOLD
  SA_THRESHOLD: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — SA_MAX_DEPTH
  SA_MAX_DEPTH: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — SA_MAX_NODES
  SA_MAX_NODES: number;

  // ── Write Gate (Predictive Coding) ────────────────────────────────────
  // source: Cortex mcp_server/infrastructure/memory_config.py — WRITE_GATE_THRESHOLD
  WRITE_GATE_THRESHOLD: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — WRITE_GATE_CONTINUITY_DISCOUNT
  WRITE_GATE_CONTINUITY_DISCOUNT: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — WRITE_GATE_CONTINUITY_WINDOW
  WRITE_GATE_CONTINUITY_WINDOW: number;

  // ── Reconsolidation ───────────────────────────────────────────────────
  // source: Cortex mcp_server/infrastructure/memory_config.py — RECONSOLIDATION_LOW_THRESHOLD
  RECONSOLIDATION_LOW_THRESHOLD: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — RECONSOLIDATION_HIGH_THRESHOLD
  RECONSOLIDATION_HIGH_THRESHOLD: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — PLASTICITY_SPIKE
  PLASTICITY_SPIKE: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — PLASTICITY_HALF_LIFE_HOURS
  PLASTICITY_HALF_LIFE_HOURS: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — STABILITY_INCREMENT
  STABILITY_INCREMENT: number;

  // ── Engram ────────────────────────────────────────────────────────────
  // source: Cortex mcp_server/infrastructure/memory_config.py — EXCITABILITY_HALF_LIFE_HOURS
  EXCITABILITY_HALF_LIFE_HOURS: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — EXCITABILITY_BOOST
  EXCITABILITY_BOOST: number;

  // ── Prospective ───────────────────────────────────────────────────────
  // source: Cortex mcp_server/infrastructure/memory_config.py — MAX_TRIGGER_FIRES
  MAX_TRIGGER_FIRES: number;

  // ── Hippocampal Replay ────────────────────────────────────────────────
  // source: Cortex mcp_server/infrastructure/memory_config.py — REPLAY_MAX_RESTORE_MEMORIES
  REPLAY_MAX_RESTORE_MEMORIES: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — REPLAY_ANCHOR_HEAT
  REPLAY_ANCHOR_HEAT: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — REPLAY_CHECKPOINT_AUTO_INTERVAL
  REPLAY_CHECKPOINT_AUTO_INTERVAL: number;

  // ── Compression ───────────────────────────────────────────────────────
  // source: Cortex mcp_server/infrastructure/memory_config.py — COMPRESSION_GIST_AGE_HOURS = 168.0 (7 days)
  COMPRESSION_GIST_AGE_HOURS: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — COMPRESSION_TAG_AGE_HOURS = 720.0 (30 days)
  COMPRESSION_TAG_AGE_HOURS: number;

  // ── Recency Boost ─────────────────────────────────────────────────────
  // source: Cortex mcp_server/infrastructure/memory_config.py — RECENCY_BOOST_MAX
  RECENCY_BOOST_MAX: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — RECENCY_BOOST_HALFLIFE_DAYS
  RECENCY_BOOST_HALFLIFE_DAYS: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — RECENCY_BOOST_CUTOFF_DAYS
  RECENCY_BOOST_CUTOFF_DAYS: number;

  // ── Strategic Ordering ("Lost in the Middle" mitigation) ─────────────
  // source: Cortex mcp_server/infrastructure/memory_config.py — STRATEGIC_ORDERING_ENABLED
  STRATEGIC_ORDERING_ENABLED: boolean;
  // source: Cortex mcp_server/infrastructure/memory_config.py — STRATEGIC_TOP_FRACTION = 0.3
  STRATEGIC_TOP_FRACTION: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — STRATEGIC_BOTTOM_FRACTION = 0.2
  STRATEGIC_BOTTOM_FRACTION: number;

  // ── Test-Time Learning (Titans, NeurIPS 2025) ─────────────────────────
  // source: Cortex mcp_server/infrastructure/memory_config.py — SURPRISE_MOMENTUM_ENABLED
  SURPRISE_MOMENTUM_ENABLED: boolean;
  // source: Cortex mcp_server/infrastructure/memory_config.py — SURPRISE_MOMENTUM_ETA = 0.7
  SURPRISE_MOMENTUM_ETA: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — SURPRISE_MOMENTUM_DELTA = 0.08
  SURPRISE_MOMENTUM_DELTA: number;

  // ── Adaptive Decay (Titans, NeurIPS 2025) ────────────────────────────
  // source: Cortex mcp_server/infrastructure/memory_config.py — ADAPTIVE_DECAY_ENABLED
  ADAPTIVE_DECAY_ENABLED: boolean;
  // source: Cortex mcp_server/infrastructure/memory_config.py — ADAPTIVE_DECAY_MIN_RATE = 0.90
  ADAPTIVE_DECAY_MIN_RATE: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — ADAPTIVE_DECAY_MAX_RATE = 0.999
  ADAPTIVE_DECAY_MAX_RATE: number;

  // ── Co-Activation (Dragon Hatchling, Pathway 2025) ───────────────────
  // source: Cortex mcp_server/infrastructure/memory_config.py — CO_ACTIVATION_ENABLED
  CO_ACTIVATION_ENABLED: boolean;
  // source: Cortex mcp_server/infrastructure/memory_config.py — CO_ACTIVATION_LEARNING_RATE = 0.1
  CO_ACTIVATION_LEARNING_RATE: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — CO_ACTIVATION_MIN_SCORE = 0.3
  CO_ACTIVATION_MIN_SCORE: number;

  // ── Embedding ─────────────────────────────────────────────────────────
  // source: Cortex mcp_server/infrastructure/memory_config.py — EMBEDDING_DIM = 384
  EMBEDDING_DIM: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — EMBEDDING_DEVICE = "cpu"
  EMBEDDING_DEVICE: string;

  // ── A3 lazy-heat (Phase 3 Scalability Program, v3.13.0) ───────────────
  // source: Cortex mcp_server/infrastructure/memory_config.py — A3_LAZY_HEAT = True
  A3_LAZY_HEAT: boolean;

  // ── Phase 5: ConnectionPool latency classes ───────────────────────────
  // source: docs/program/phase-5-pool-admission-design.md §1.1
  // source: Cortex mcp_server/infrastructure/memory_config.py — POOL_INTERACTIVE_MIN = 2
  POOL_INTERACTIVE_MIN: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — POOL_INTERACTIVE_MAX = 8
  POOL_INTERACTIVE_MAX: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — POOL_INTERACTIVE_TIMEOUT_S = 5.0
  POOL_INTERACTIVE_TIMEOUT_S: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — POOL_BATCH_MIN = 1
  POOL_BATCH_MIN: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — POOL_BATCH_MAX = 2
  POOL_BATCH_MAX: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — POOL_BATCH_TIMEOUT_S = 1800.0 (30 min)
  POOL_BATCH_TIMEOUT_S: number;
  // source: Cortex mcp_server/infrastructure/memory_config.py — POOL_DISABLED = False
  POOL_DISABLED: boolean;

  // ── automatised-pipeline (ADR-0046) ──────────────────────────────────
  // source: Cortex mcp_server/infrastructure/memory_config.py — AP_ENABLED = True
  AP_ENABLED: boolean;

  /** Resolved DB path. */
  db_path_resolved: string;
}

/**
 * Build MemorySettings from environment variables.
 *
 * All values are read from process.env at call time.
 * The returned object is a frozen plain record.
 *
 * precondition:  none (missing env vars fall back to defaults).
 * postcondition: every field is set to a value of the correct type;
 *   RUNTIME is detected from CORTEX_RUNTIME / CLAUDE_ENVIRONMENT.
 *
 * source: Cortex mcp_server/infrastructure/memory_config.py:MemorySettings
 */
function _buildSettings(): MemorySettings {
  const dbPath = _str("DB_PATH", path.join(METHODOLOGY_DIR, "memory.db"));
  const runtime = (_env("RUNTIME") as CortexRuntime | undefined) ?? _detectRuntime();

  const s: MemorySettings = {
    RUNTIME: runtime,

    // source: Cortex mcp_server/infrastructure/memory_config.py — DATABASE_URL default
    DATABASE_URL: _str("DATABASE_URL", "postgresql://localhost:5432/cortex"),
    DB_PATH: dbPath,
    SQLITE_FALLBACK_PATH: _str(
      "SQLITE_FALLBACK_PATH",
      path.join(METHODOLOGY_DIR, "memory.db"),
    ),
    STORE_BACKEND: _str("STORE_BACKEND", "auto"),
    // source: Cortex mcp_server/infrastructure/memory_config.py — SESSION_LOG_ROLLING_LIMIT = 1000
    SESSION_LOG_ROLLING_LIMIT: _int("SESSION_LOG_ROLLING_LIMIT", 1000),

    // source: Cortex mcp_server/infrastructure/memory_config.py — DECAY_FACTOR = 0.95
    DECAY_FACTOR: _float("DECAY_FACTOR", 0.95),
    // source: Cortex mcp_server/infrastructure/memory_config.py — IMPORTANCE_DECAY_FACTOR = 0.998
    IMPORTANCE_DECAY_FACTOR: _float("IMPORTANCE_DECAY_FACTOR", 0.998),
    // source: Cortex mcp_server/infrastructure/memory_config.py — COLD_THRESHOLD = 0.05
    COLD_THRESHOLD: _float("COLD_THRESHOLD", 0.05),
    HOT_THRESHOLD: _float("HOT_THRESHOLD", 0.7),
    SURPRISE_BOOST: _float("SURPRISE_BOOST", 0.3),
    EMOTIONAL_DECAY_RESISTANCE: _float("EMOTIONAL_DECAY_RESISTANCE", 0.5),
    SYNAPTIC_WINDOW_MINUTES: _int("SYNAPTIC_WINDOW_MINUTES", 30),
    SYNAPTIC_BOOST: _float("SYNAPTIC_BOOST", 0.2),
    SESSION_COHERENCE_BONUS: _float("SESSION_COHERENCE_BONUS", 0.2),
    SESSION_COHERENCE_WINDOW_HOURS: _float("SESSION_COHERENCE_WINDOW_HOURS", 4.0),

    DEFAULT_RECALL_LIMIT: _int("DEFAULT_RECALL_LIMIT", 10),
    // source: Cortex mcp_server/infrastructure/memory_config.py — WRRF_K = 60
    WRRF_K: _int("WRRF_K", 60),
    // source: Cortex mcp_server/infrastructure/memory_config.py — WRRF_CANDIDATE_MULTIPLIER = 10
    WRRF_CANDIDATE_MULTIPLIER: _int("WRRF_CANDIDATE_MULTIPLIER", 10),
    WRRF_VECTOR_WEIGHT: _float("WRRF_VECTOR_WEIGHT", 1.0),
    WRRF_FTS_WEIGHT: _float("WRRF_FTS_WEIGHT", 0.5),
    WRRF_HEAT_WEIGHT: _float("WRRF_HEAT_WEIGHT", 0.3),

    HOPFIELD_BETA: _float("HOPFIELD_BETA", 8.0),
    // source: Cortex mcp_server/infrastructure/memory_config.py — HOPFIELD_MAX_PATTERNS = 5000
    HOPFIELD_MAX_PATTERNS: _int("HOPFIELD_MAX_PATTERNS", 5000),

    // source: Cortex mcp_server/infrastructure/memory_config.py — SA_DECAY = 0.65 (Collins & Loftus 1975)
    SA_DECAY: _float("SA_DECAY", 0.65),
    SA_THRESHOLD: _float("SA_THRESHOLD", 0.1),
    SA_MAX_DEPTH: _int("SA_MAX_DEPTH", 3),
    SA_MAX_NODES: _int("SA_MAX_NODES", 50),

    WRITE_GATE_THRESHOLD: _float("WRITE_GATE_THRESHOLD", 0.4),
    // source: Cortex mcp_server/infrastructure/memory_config.py — WRITE_GATE_CONTINUITY_DISCOUNT = 0.15
    WRITE_GATE_CONTINUITY_DISCOUNT: _float("WRITE_GATE_CONTINUITY_DISCOUNT", 0.15),
    WRITE_GATE_CONTINUITY_WINDOW: _int("WRITE_GATE_CONTINUITY_WINDOW", 10),

    RECONSOLIDATION_LOW_THRESHOLD: _float("RECONSOLIDATION_LOW_THRESHOLD", 0.3),
    RECONSOLIDATION_HIGH_THRESHOLD: _float("RECONSOLIDATION_HIGH_THRESHOLD", 0.7),
    PLASTICITY_SPIKE: _float("PLASTICITY_SPIKE", 0.3),
    PLASTICITY_HALF_LIFE_HOURS: _float("PLASTICITY_HALF_LIFE_HOURS", 6.0),
    STABILITY_INCREMENT: _float("STABILITY_INCREMENT", 0.1),

    EXCITABILITY_HALF_LIFE_HOURS: _float("EXCITABILITY_HALF_LIFE_HOURS", 6.0),
    EXCITABILITY_BOOST: _float("EXCITABILITY_BOOST", 0.5),

    MAX_TRIGGER_FIRES: _int("MAX_TRIGGER_FIRES", 5),

    REPLAY_MAX_RESTORE_MEMORIES: _int("REPLAY_MAX_RESTORE_MEMORIES", 8),
    REPLAY_ANCHOR_HEAT: _float("REPLAY_ANCHOR_HEAT", 1.0),
    REPLAY_CHECKPOINT_AUTO_INTERVAL: _int("REPLAY_CHECKPOINT_AUTO_INTERVAL", 50),

    // source: Cortex mcp_server/infrastructure/memory_config.py — COMPRESSION_GIST_AGE_HOURS = 168.0 (7 days)
    COMPRESSION_GIST_AGE_HOURS: _float("COMPRESSION_GIST_AGE_HOURS", 168.0),
    // source: Cortex mcp_server/infrastructure/memory_config.py — COMPRESSION_TAG_AGE_HOURS = 720.0 (30 days)
    COMPRESSION_TAG_AGE_HOURS: _float("COMPRESSION_TAG_AGE_HOURS", 720.0),

    // source: Cortex mcp_server/infrastructure/memory_config.py — RECENCY_BOOST_MAX = 0.15
    RECENCY_BOOST_MAX: _float("RECENCY_BOOST_MAX", 0.15),
    // source: Cortex mcp_server/infrastructure/memory_config.py — RECENCY_BOOST_HALFLIFE_DAYS = 30.0
    RECENCY_BOOST_HALFLIFE_DAYS: _float("RECENCY_BOOST_HALFLIFE_DAYS", 30.0),
    // source: Cortex mcp_server/infrastructure/memory_config.py — RECENCY_BOOST_CUTOFF_DAYS = 90.0
    RECENCY_BOOST_CUTOFF_DAYS: _float("RECENCY_BOOST_CUTOFF_DAYS", 90.0),

    STRATEGIC_ORDERING_ENABLED: _bool("STRATEGIC_ORDERING_ENABLED", true),
    STRATEGIC_TOP_FRACTION: _float("STRATEGIC_TOP_FRACTION", 0.3),
    STRATEGIC_BOTTOM_FRACTION: _float("STRATEGIC_BOTTOM_FRACTION", 0.2),

    SURPRISE_MOMENTUM_ENABLED: _bool("SURPRISE_MOMENTUM_ENABLED", true),
    SURPRISE_MOMENTUM_ETA: _float("SURPRISE_MOMENTUM_ETA", 0.7),
    // source: Cortex mcp_server/infrastructure/memory_config.py — SURPRISE_MOMENTUM_DELTA = 0.08 (Titans, NeurIPS 2025)
    SURPRISE_MOMENTUM_DELTA: _float("SURPRISE_MOMENTUM_DELTA", 0.08),

    ADAPTIVE_DECAY_ENABLED: _bool("ADAPTIVE_DECAY_ENABLED", true),
    // source: Cortex mcp_server/infrastructure/memory_config.py — ADAPTIVE_DECAY_MIN_RATE = 0.90 (Titans, NeurIPS 2025)
    ADAPTIVE_DECAY_MIN_RATE: _float("ADAPTIVE_DECAY_MIN_RATE", 0.90),
    // source: Cortex mcp_server/infrastructure/memory_config.py — ADAPTIVE_DECAY_MAX_RATE = 0.999 (Titans, NeurIPS 2025)
    ADAPTIVE_DECAY_MAX_RATE: _float("ADAPTIVE_DECAY_MAX_RATE", 0.999),

    CO_ACTIVATION_ENABLED: _bool("CO_ACTIVATION_ENABLED", true),
    CO_ACTIVATION_LEARNING_RATE: _float("CO_ACTIVATION_LEARNING_RATE", 0.1),
    CO_ACTIVATION_MIN_SCORE: _float("CO_ACTIVATION_MIN_SCORE", 0.3),

    // source: Cortex mcp_server/infrastructure/memory_config.py — EMBEDDING_DIM = 384 (all-MiniLM-L6-v2 hidden size)
    EMBEDDING_DIM: _int("EMBEDDING_DIM", 384),
    EMBEDDING_DEVICE: _str("EMBEDDING_DEVICE", "cpu"),

    A3_LAZY_HEAT: _bool("A3_LAZY_HEAT", true),

    POOL_INTERACTIVE_MIN: _int("POOL_INTERACTIVE_MIN", 2),
    POOL_INTERACTIVE_MAX: _int("POOL_INTERACTIVE_MAX", 8),
    POOL_INTERACTIVE_TIMEOUT_S: _float("POOL_INTERACTIVE_TIMEOUT_S", 5.0),
    POOL_BATCH_MIN: _int("POOL_BATCH_MIN", 1),
    POOL_BATCH_MAX: _int("POOL_BATCH_MAX", 2),
    // source: Cortex mcp_server/infrastructure/memory_config.py — POOL_BATCH_TIMEOUT_S = 1800.0 (30 min for consolidate)
    POOL_BATCH_TIMEOUT_S: _float("POOL_BATCH_TIMEOUT_S", 1800.0),
    POOL_DISABLED: _bool("POOL_DISABLED", false),

    AP_ENABLED: _bool("AP_ENABLED", true),

    get db_path_resolved(): string {
      return path.resolve(dbPath);
    },
  };

  return s;
}

// ── Process-wide singleton ────────────────────────────────────────────────

// Singleton MemorySettings instance. Read-once at first call. Frozen after.
// source: Cortex mcp_server/infrastructure/memory_config.py:get_memory_settings (lru_cache maxsize=1)
let _instance: MemorySettings | null = null;

/**
 * Singleton memory settings instance.
 *
 * precondition:  none.
 * postcondition: returns the same MemorySettings object on every call;
 *   the object is built from environment variables at first call.
 * invariant:     the returned object is frozen — no mutation after first access.
 *
 * source: Cortex mcp_server/infrastructure/memory_config.py:get_memory_settings
 */
export function getMemorySettings(): MemorySettings {
  if (_instance === null) {
    _instance = Object.freeze(_buildSettings()) as MemorySettings;
  }
  return _instance;
}

/**
 * Reset singleton (for testing only).
 *
 * source: Cortex mcp_server/infrastructure/embedding_engine.py:reset_embedding_engine pattern
 */
export function _resetMemorySettings(): void {
  _instance = null;
}
