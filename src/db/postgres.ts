import pg from 'pg';
import type { Db, Executor, SqlParams } from './executor.js';
import { toPostgresPlaceholders } from './placeholders.js';

type Queryable = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>;
};

let parsersReady = false;

function ensureParsers(): void {
  if (parsersReady) {
    return;
  }
  pg.types.setTypeParser(20, (value) => Number(value));
  parsersReady = true;
}

function createExecutor(queryable: Queryable): Executor {
  return {
    async exec(sql) {
      await queryable.query(sql);
    },
    async get<T>(sql: string, params?: SqlParams) {
      const result = await queryable.query(toPostgresPlaceholders(sql), params ? [...params] : []);
      return result.rows[0] as T | undefined;
    },
    async all<T>(sql: string, params?: SqlParams) {
      const result = await queryable.query(toPostgresPlaceholders(sql), params ? [...params] : []);
      return result.rows as T[];
    },
    async run(sql, params) {
      const result = await queryable.query(toPostgresPlaceholders(sql), params ? [...params] : []);
      return { changes: result.rowCount ?? 0 };
    },
  };
}

export function openPostgres(databaseUrl: string): Db {
  ensureParsers();
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
  });
  const pooled = createExecutor(pool);

  return {
    dialect: 'postgres',
    exec: (sql) => pooled.exec(sql),
    get: (sql, params) => pooled.get(sql, params),
    all: (sql, params) => pooled.all(sql, params),
    run: (sql, params) => pooled.run(sql, params),
    async transaction(fn) {
      const client = await pool.connect();
      const tx = createExecutor(client);
      try {
        await client.query('BEGIN');
        const result = await fn(tx);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Keep the original failure.
        }
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
