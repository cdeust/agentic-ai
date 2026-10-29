import pg from 'pg';
import type { SqlExecutor } from './sql-store.js';

/** The only module of the repository that imports `pg`. */
export interface PgConnection extends SqlExecutor {
  end(): Promise<void>;
}

type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

function executor(target: Queryable): Pick<SqlExecutor, 'query'> {
  return {
    query: async (text, params) => {
      const result = await target.query(text, [...params]);
      return { rows: result.rows as Record<string, unknown>[] };
    },
  };
}

export function connectPostgres(connectionString: string): PgConnection {
  const pool = new pg.Pool({ connectionString });
  return {
    ...executor(pool),
    transaction: async (work) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tx: SqlExecutor = {
          ...executor(client),
          transaction: (inner) => inner(tx),
        };
        const value = await work(tx);
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    end: () => pool.end(),
  };
}
