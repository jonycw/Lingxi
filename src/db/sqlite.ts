import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Db, Executor, SqlParams } from './executor.js';

type Statement = {
  get(...params: Array<string | number | bigint | null>): unknown;
  all(...params: Array<string | number | bigint | null>): unknown[];
  run(...params: Array<string | number | bigint | null>): { changes: number | bigint };
};

function bind(params: SqlParams = []): Array<string | number | bigint | null> {
  return params.map((value) => {
    if (value === undefined) {
      return null;
    }
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
    return value;
  });
}

function plain<T>(row: unknown): T | undefined {
  if (row === undefined || row === null) {
    return undefined;
  }
  return { ...(row as Record<string, unknown>) } as T;
}

export function openSqlite(filename: string): Db {
  if (filename !== ':memory:') {
    mkdirSync(path.dirname(filename), { recursive: true });
  }
  const raw = new DatabaseSync(filename);
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec('PRAGMA busy_timeout = 5000');
  raw.exec('PRAGMA journal_mode = WAL');

  const direct: Executor = {
    async exec(sql) {
      raw.exec(sql);
    },
    async get<T>(sql: string, params?: SqlParams) {
      const statement = raw.prepare(sql) as unknown as Statement;
      return plain<T>(statement.get(...bind(params)));
    },
    async all<T>(sql: string, params?: SqlParams) {
      const statement = raw.prepare(sql) as unknown as Statement;
      return statement.all(...bind(params)).map((row) => plain<T>(row) as T);
    },
    async run(sql, params) {
      const statement = raw.prepare(sql) as unknown as Statement;
      const result = statement.run(...bind(params));
      return { changes: Number(result.changes) };
    },
  };

  let queue: Promise<void> = Promise.resolve();
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  return {
    dialect: 'sqlite',
    exec: (sql) => enqueue(() => direct.exec(sql)),
    get: (sql, params) => enqueue(() => direct.get(sql, params)),
    all: (sql, params) => enqueue(() => direct.all(sql, params)),
    run: (sql, params) => enqueue(() => direct.run(sql, params)),
    transaction(fn) {
      return enqueue(async () => {
        raw.exec('BEGIN IMMEDIATE');
        try {
          const result = await fn(direct);
          raw.exec('COMMIT');
          return result;
        } catch (error) {
          try {
            raw.exec('ROLLBACK');
          } catch {
            // The original error is the one that matters.
          }
          throw error;
        }
      });
    },
    close() {
      return enqueue(async () => {
        raw.close();
      });
    },
  };
}
