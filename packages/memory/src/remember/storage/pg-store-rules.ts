/**
 * pg-store-rules.ts — Memory rule CRUD for PgMemoryStore.
 * source: cortex@ed33435 mcp_server/infrastructure/pg_store_rules.py
 */
import type { PoolClient } from "pg";

const ALLOWED = new Set(["rule_type","scope","scope_value","condition","action","priority","is_active"]);

export interface RuleData {
  rule_type?: string; scope?: string; scope_value?: string | null;
  condition: string; action: string; priority?: number; is_active?: boolean;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_rules.py:20-37
export async function insertRule(client: PoolClient, data: RuleData): Promise<number> {
  const result = await client.query<{ id: number }>(
    `INSERT INTO memory_rules (rule_type, scope, scope_value, condition, action, priority, is_active, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING id`,
    [data.rule_type ?? "soft", data.scope ?? "global", data.scope_value ?? null,
     data.condition, data.action, data.priority ?? 0, data.is_active ?? true]);
  const row = result.rows[0];
  if (row == null) throw new Error("insertRule: no id returned");
  return row.id;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_rules.py:39-45
export async function getRulesForScope(client: PoolClient, scope: string): Promise<Record<string, unknown>[]> {
  return (await client.query(
    "SELECT * FROM memory_rules WHERE scope = $1 AND is_active ORDER BY priority DESC", [scope])).rows as Record<string, unknown>[];
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_rules.py:47-51
export async function getAllActiveRules(client: PoolClient): Promise<Record<string, unknown>[]> {
  return (await client.query(
    "SELECT * FROM memory_rules WHERE is_active ORDER BY scope, priority DESC")).rows as Record<string, unknown>[];
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_rules.py:53-78
export async function updateRule(client: PoolClient, ruleId: number, updates: Partial<Record<string, unknown>>): Promise<void> {
  const setClauses: string[] = [];
  const vals: unknown[] = [];
  let idx = 1;
  for (const [k, v] of Object.entries(updates)) {
    if (ALLOWED.has(k)) { setClauses.push(`${k} = $${idx}`); vals.push(v); idx++; }
  }
  if (setClauses.length === 0) return;
  vals.push(ruleId);
  await client.query(`UPDATE memory_rules SET ${setClauses.join(", ")} WHERE id = $${idx}`, vals);
}
