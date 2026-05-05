/* eslint-disable @typescript-eslint/no-magic-numbers -- all numeric defaults are literal ports from cortex@ed33435 */
/**
 * sqlite-store-search.ts — Search and retrieval mixin for SqliteMemoryStore.
 *
 * Implements client-side WRRF fusion, FTS5 search, vector search,
 * and spread activation — replacing PL/pgSQL stored procedures.
 *
 * Ports: infrastructure/sqlite_store_search.py (lines 1-373)
 *
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py
 */

import type { Database as DatabaseType } from "better-sqlite3";

export interface WrrfWeights {
  vector?: number;
  fts?: number;
  heat?: number;
  recency?: number;
}

export interface RecallResult {
  memory_id: number;
  content: string;
  score: number;
  heat: number;
  domain: string;
  created_at: string;
  store_type: string;
  tags: string;
  importance: number;
  surprise_score: number;
}

/**
 * Search operations on SQLite with client-side WRRF fusion.
 *
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:15-373
 */
export class SqliteSearchMixin {
  protected _rawConn!: DatabaseType;
  protected _hasVec = false;

  /** Provided by SqliteMemoryStore. */
  protected _bytesToVector(_emb: Buffer | null): Float32Array | null {
    return null;
  }

  /**
   * Client-side WRRF fusion: vector + FTS5 + heat + recency.
   *
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:39-61
   */
  recallMemories(
    queryText: string,
    queryEmbedding: Buffer | null,
    intent = "general",
    domain: string | null = null,
    directory: string | null = null,
    agentTopic: string | null = null,
    minHeat = 0.05, // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:46
    maxResults = 10,
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:46 — wrrf_k default 60
    wrfK = 60, // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:46
    weights: WrrfWeights | null = null,
    includeGlobals = true,
  ): RecallResult[] {
    void intent;
    void includeGlobals;
    const w = weights ?? {};
    const wVector = w.vector ?? 1.0;
    const wFts = w.fts ?? 0.5;
    const wHeat = w.heat ?? 0.3;
    const wRecency = w.recency ?? 0.0;
    const pool = maxResults * 10;
    const scores: Map<number, number> = new Map();

    this._signalVector(scores, queryEmbedding, wVector, wrfK, pool);
    this._signalFts(scores, queryText, wFts, wrfK, pool);
    this._signalHeat(scores, wHeat, wrfK, pool, minHeat, domain, directory);
    this._signalRecency(scores, wRecency, wrfK, pool, minHeat, domain, directory);
    this._applyAgentBoost(scores, agentTopic, wVector, wrfK);

    if (scores.size === 0) return [];
    return this._fetchRankedResults(scores, maxResults, minHeat, domain, directory);
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:63-85
   */
  private _signalVector(
    scores: Map<number, number>,
    queryEmbedding: Buffer | null,
    weight: number,
    k: number,
    pool: number,
  ): void {
    if (!this._hasVec || queryEmbedding == null || weight <= 0) return;
    const vec = this._bytesToVector(queryEmbedding);
    if (vec == null) return;
    try {
      const rows = this._rawConn
        .prepare(
          "SELECT rowid, distance FROM memories_vec " +
            "WHERE embedding MATCH ? ORDER BY distance LIMIT ?",
        )
        .all(Buffer.from(vec.buffer), pool) as Array<{
        rowid: number;
        distance: number;
      }>;
      rows.forEach((r, rank) => {
        scores.set(r.rowid, (scores.get(r.rowid) ?? 0) + weight / (k + rank + 1));
      });
    } catch {
      // sqlite-vec not available or query failed
    }
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:87-106
   */
  private _signalFts(
    scores: Map<number, number>,
    queryText: string,
    weight: number,
    k: number,
    pool: number,
  ): void {
    if (!queryText || weight <= 0) return;
    try {
      const rows = this._rawConn
        .prepare(
          "SELECT rowid, rank FROM memories_fts " +
            "WHERE memories_fts MATCH ? ORDER BY rank LIMIT ?",
        )
        .all(queryText, pool) as Array<{ rowid: number; rank: number }>;
      rows.forEach((r, rank) => {
        scores.set(r.rowid, (scores.get(r.rowid) ?? 0) + weight / (k + rank + 1));
      });
    } catch {
      // FTS query failed
    }
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:108-128
   */
  private _signalHeat(
    scores: Map<number, number>,
    weight: number,
    k: number,
    pool: number,
    minHeat: number,
    domain: string | null,
    directory: string | null,
  ): void {
    if (weight <= 0) return;
    const { conds, params } = this._buildFilter(minHeat, domain, directory);
    params.push(pool);
    const rows = this._rawConn
      .prepare(
        `SELECT id FROM memories WHERE ${conds.join(" AND ")} ` +
          `ORDER BY heat_base DESC LIMIT ?`,
      )
      .all(...params) as Array<{ id: number }>;
    rows.forEach((r, rank) => {
      scores.set(r.id, (scores.get(r.id) ?? 0) + weight / (k + rank + 1));
    });
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:130-151
   */
  private _signalRecency(
    scores: Map<number, number>,
    weight: number,
    k: number,
    pool: number,
    minHeat: number,
    domain: string | null,
    directory: string | null,
  ): void {
    if (weight <= 0) return;
    const { conds, params } = this._buildFilter(minHeat, domain, directory);
    params.push(pool);
    const rows = this._rawConn
      .prepare(
        `SELECT id FROM memories WHERE ${conds.join(" AND ")} ` +
          `ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...params) as Array<{ id: number }>;
    rows.forEach((r, rank) => {
      scores.set(r.id, (scores.get(r.id) ?? 0) + weight / (k + rank + 1));
    });
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:152-166
   */
  private _buildFilter(
    minHeat: number,
    domain: string | null,
    directory: string | null,
  ): { conds: string[]; params: unknown[] } {
    const conds = ["heat_base >= ?", "NOT is_stale"];
    const params: unknown[] = [minHeat];
    if (domain) {
      conds.push("(domain = ? OR is_global = 1)");
      params.push(domain);
    }
    if (directory) {
      conds.push("(directory_context = ? OR is_global = 1)");
      params.push(directory);
    }
    return { conds, params };
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:168-186
   */
  private _applyAgentBoost(
    scores: Map<number, number>,
    agentTopic: string | null,
    wVector: number,
    wrfK: number,
  ): void {
    if (!agentTopic || scores.size === 0) return;
    const boost = 0.3 * (wVector / wrfK);
    const ids = [...scores.keys()];
    const placeholders = ids.map(() => "?").join(",");
    const rows = this._rawConn
      .prepare(
        `SELECT id FROM memories WHERE id IN (${placeholders}) ` +
          `AND agent_context = ?`,
      )
      .all(...ids, agentTopic) as Array<{ id: number }>;
    for (const r of rows) {
      scores.set(r.id, (scores.get(r.id) ?? 0) + boost);
    }
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:188-230
   */
  private _fetchRankedResults(
    scores: Map<number, number>,
    maxResults: number,
    minHeat: number,
    domain: string | null,
    directory: string | null,
  ): RecallResult[] {
    const topIds = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxResults * 3)
      .map(([id]) => id);

    if (topIds.length === 0) return [];
    const placeholders = topIds.map(() => "?").join(",");
    const rows = this._rawConn
      .prepare(`SELECT * FROM memories WHERE id IN (${placeholders})`)
      .all(...topIds) as Array<Record<string, unknown>>;

    const rowMap = new Map(rows.map((r) => [r["id"] as number, r]));

    const results: RecallResult[] = [];
    for (const mid of topIds) {
      const row = rowMap.get(mid);
      if (row == null) continue;
      const heat = (row["heat_base"] as number) ?? (row["heat"] as number) ?? 0;
      if (heat < minHeat || row["is_stale"]) continue;
      const isGlobal = Boolean(row["is_global"]);
      if (domain && row["domain"] !== domain && !isGlobal) continue;
      if (directory && row["directory_context"] !== directory && !isGlobal) continue;
      results.push({
        memory_id: mid,
        content: row["content"] as string,
        score: scores.get(mid) ?? 0,
        heat: (row["heat_base"] as number) ?? (row["heat"] as number) ?? 0,
        domain: (row["domain"] as string) ?? "",
        created_at: row["created_at"] as string,
        store_type: (row["store_type"] as string) ?? "episodic",
        tags: row["tags"] as string,
        importance: (row["importance"] as number) ?? 0,
        surprise_score: (row["surprise_score"] as number) ?? 0,
      });
    }
    return results;
  }

  /**
   * Full-text search via FTS5. Returns (memory_id, score) pairs.
   *
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:232-242
   */
  searchFts(query: string, limit = 20): Array<[number, number]> {
    try {
      const rows = this._rawConn
        .prepare(
          "SELECT rowid, rank FROM memories_fts " +
            "WHERE memories_fts MATCH ? ORDER BY rank LIMIT ?",
        )
        .all(query, limit) as Array<{ rowid: number; rank: number }>;
      return rows.map((r) => [r.rowid, -r.rank]);
    } catch {
      return [];
    }
  }

  /**
   * Vector KNN search via sqlite-vec. Returns (memory_id, distance) pairs.
   *
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:244-261
   */
  searchVectors(
    queryEmbedding: Buffer,
    topK = 10,
    _minHeat = 0.0,
  ): Array<[number, number]> {
    if (!this._hasVec) return [];
    const vec = this._bytesToVector(queryEmbedding);
    if (vec == null) return [];
    try {
      const rows = this._rawConn
        .prepare(
          "SELECT rowid, distance FROM memories_vec " +
            "WHERE embedding MATCH ? ORDER BY distance LIMIT ?",
        )
        .all(Buffer.from(vec.buffer), topK) as Array<{
        rowid: number;
        distance: number;
      }>;
      return rows.map((r) => [r.rowid, r.distance]);
    } catch {
      return [];
    }
  }

  /**
   * Client-side spread activation: query terms -> entities -> memories.
   *
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:263-279
   */
  spreadActivationMemories(
    queryTerms: string[],
    decay = 0.65, // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:265
    threshold = 0.1, // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:266
    maxDepth = 3,
    maxResults = 50,
    minHeat = 0.05, // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:269
  ): Array<[number, number]> {
    const seedEntities = this._resolveSeedEntities(queryTerms, minHeat);
    if (seedEntities.size === 0) return [];
    const activated = this._propagateActivation(seedEntities, decay, threshold, maxDepth);
    return this._mapEntitiesToMemories(activated, minHeat, maxResults);
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:281-292
   */
  private _resolveSeedEntities(
    queryTerms: string[],
    minHeat: number,
  ): Map<number, number> {
    const seeds: Map<number, number> = new Map();
    for (const term of queryTerms) {
      const rows = this._rawConn
        .prepare(
          "SELECT id FROM entities " +
            "WHERE LOWER(name) = LOWER(?) AND heat >= ? AND NOT archived",
        )
        .all(term, minHeat) as Array<{ id: number }>;
      for (const r of rows) {
        seeds.set(r.id, 1.0);
      }
    }
    return seeds;
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:294-327
   */
  private _propagateActivation(
    seeds: Map<number, number>,
    decay: number,
    threshold: number,
    maxDepth: number,
  ): Map<number, number> {
    const activated = new Map(seeds);
    let frontier = new Map(seeds);
    // invariant: frontier shrinks or stays empty each iteration; terminates in maxDepth steps
    for (let depth = 0; depth < maxDepth; depth++) {
      const nextFrontier: Map<number, number> = new Map();
      for (const [eid, act] of frontier) {
        const rels = this._rawConn
          .prepare(
            "SELECT source_entity_id, target_entity_id, weight, confidence " +
              "FROM relationships " +
              "WHERE source_entity_id = ? OR target_entity_id = ?",
          )
          .all(eid, eid) as Array<{
          source_entity_id: number;
          target_entity_id: number;
          weight: number;
          confidence: number;
        }>;
        for (const r of rels) {
          const neighbor =
            r.source_entity_id === eid ? r.target_entity_id : r.source_entity_id;
          const newAct = act * decay * r.weight * r.confidence;
          if (newAct >= threshold) {
            if (!activated.has(neighbor) || newAct > (activated.get(neighbor) ?? 0)) {
              activated.set(neighbor, newAct);
              nextFrontier.set(neighbor, newAct);
            }
          }
        }
      }
      frontier = nextFrontier;
      if (frontier.size === 0) break;
    }
    return activated;
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:329-354
   */
  private _mapEntitiesToMemories(
    activated: Map<number, number>,
    minHeat: number,
    maxResults: number,
  ): Array<[number, number]> {
    const memoryActs: Map<number, number> = new Map();
    for (const [eid, act] of activated) {
      const entity = this._rawConn
        .prepare(
          "SELECT name FROM entities WHERE id = ? AND heat >= ? AND NOT archived",
        )
        .get(eid, minHeat) as { name: string } | undefined;
      if (entity == null) continue;
      const name = entity.name;
      const memRows = this._rawConn
        .prepare(
          "SELECT id FROM memories WHERE content LIKE ? " +
            "AND heat >= ? AND NOT is_stale LIMIT 20",
        )
        .all(`%${name}%`, minHeat) as Array<{ id: number }>;
      for (const mr of memRows) {
        const mid = mr.id;
        if (!memoryActs.has(mid) || act > (memoryActs.get(mid) ?? 0)) {
          memoryActs.set(mid, act);
        }
      }
    }
    const sorted = [...memoryActs.entries()].sort((a, b) => b[1] - a[1]);
    return sorted.slice(0, maxResults).map(([id, score]) => [id, score]);
  }

  /**
   * Stub — sqlite-vec does not support efficient batch embedding fetch.
   *
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:356-363
   */
  getHotEmbeddings(
    _minHeat = 0.05, // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:358
    _domain: string | null = null,
    _limit = 500, // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:360
  ): Array<[number, unknown, number]> {
    return [];
  }

  /**
   * Stub — temporal co-access requires PG window functions.
   *
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:365-372
   */
  getTemporalCoAccess(
    _windowHours = 2.0, // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:366
    _minAccess = 1,
    _limit = 100, // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:368
  ): Array<[number, number, number]> {
    return [];
  }
}
