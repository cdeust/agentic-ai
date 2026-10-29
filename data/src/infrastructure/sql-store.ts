import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_OP_NAMES, type DataOpInput, type DataOpName } from '@agentic-ai/contracts';
import { z } from 'zod';
import { DataError } from '../domain/errors.js';
import type { DataStore } from '../domain/ports.js';

/** Minimal query surface the store and the migrator need. The pg pool adapter lives in pg-pool.ts. */
export interface SqlExecutor {
  query(text: string, params: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  /** Runs `work` on one connection inside BEGIN/COMMIT, ROLLBACK on error. */
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

/** Schema of sql/operations.json: which SQL file serves which operation, with which parameters. */
const TableSchema = z.strictObject({
  /** SQLSTATE to the named failure it means (e.g. 23503 foreign key violation: unknown run). */
  errors: z.record(z.string().regex(/^[0-9A-Z]{5}$/), z.enum(['NOT_FOUND', 'INVALID_OPERATION'])),
  statements: z.array(
    z.strictObject({
      op: z.enum(DATA_OP_NAMES as [DataOpName, ...DataOpName[]]),
      /** Optional input field: the statement applies only when that field is present. */
      when: z.string().optional(),
      file: z.string().regex(/^[a-z][a-z0-9.-]*\.sql$/),
      /** Input fields bound to $1..$n in order; the suffix `:json` sends the value as JSON text (jsonb, vector). */
      params: z.array(z.string().regex(/^[a-z_]+(:json)?$/)),
      /** row: the first row (none is NOT_FOUND); rows: every row; value: the `value` column of the first row. */
      returns: z.enum(['row', 'rows', 'value']),
    }),
  ),
});
type Statement = z.infer<typeof TableSchema>['statements'][number] & { text: string };

export interface StatementTable {
  errors: Record<string, 'NOT_FOUND' | 'INVALID_OPERATION'>;
  statements: Statement[];
}

/**
 * Loads sql/operations.json and the SQL files it names, and rejects a table that does not serve
 * exactly the contract operations or whose parameter list does not match the placeholders of its SQL.
 */
export function loadStatementTable(directory: string): StatementTable {
  const table = TableSchema.parse(JSON.parse(readFileSync(join(directory, 'operations.json'), 'utf8')));
  const statements = table.statements.map((statement) => {
    const text = readFileSync(join(directory, statement.file), 'utf8');
    const highest = Math.max(0, ...[...text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    if (highest !== statement.params.length) {
      throw new Error(
        `${statement.file}: uses $1..$${highest} but declares ${statement.params.length} params`,
      );
    }
    return { ...statement, text };
  });
  for (const op of DATA_OP_NAMES) {
    const forOp = statements.filter((s) => s.op === op);
    if (forOp.length === 0 || forOp.at(-1)?.when !== undefined) {
      throw new Error(`operation ${op} needs a statement without "when" as its last entry`);
    }
  }
  return { errors: table.errors, statements };
}

function bind(input: Record<string, unknown>, param: string): unknown {
  const [field = '', encoding] = param.split(':');
  const value = input[field];
  if (encoding !== 'json') return value ?? null;
  return value === undefined ? null : JSON.stringify(value);
}

/** Rows as the contracts expect them: timestamps as ISO strings, SQL NULL as an absent field. */
function normalize(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([, value]) => value !== null)
      .map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
  );
}

/** One generic executor for every data operation, driven by the statement table. */
export class SqlDataStore implements DataStore {
  constructor(
    private readonly sql: SqlExecutor,
    private readonly table: StatementTable,
  ) {}

  async execute<Op extends DataOpName>(op: Op, input: DataOpInput<Op>): Promise<unknown> {
    const fields = input as Record<string, unknown>;
    const statement = this.table.statements.find(
      (s) => s.op === op && (s.when === undefined || fields[s.when] !== undefined),
    ) as Statement;
    let rows: Record<string, unknown>[];
    try {
      rows = (
        await this.sql.query(
          statement.text,
          statement.params.map((p) => bind(fields, p)),
        )
      ).rows;
    } catch (error) {
      const named = this.table.errors[(error as { code?: string }).code ?? ''];
      // The database message names tables and constraints: it is not forwarded to callers.
      if (named !== undefined) throw new DataError(named, `${op}: ${named.toLowerCase().replace('_', ' ')}`);
      throw error;
    }
    if (statement.returns === 'rows') return rows.map(normalize);
    const first = rows[0];
    if (first === undefined) throw new DataError('NOT_FOUND', `${op}: no such record`);
    return statement.returns === 'row' ? normalize(first) : first['value'];
  }
}
