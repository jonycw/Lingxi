export type SqlParam = string | number | bigint | boolean | null;
export type SqlParams = readonly SqlParam[];

export interface Executor {
  exec(sql: string): Promise<void>;
  get<T>(sql: string, params?: SqlParams): Promise<T | undefined>;
  all<T>(sql: string, params?: SqlParams): Promise<T[]>;
  run(sql: string, params?: SqlParams): Promise<{ changes: number }>;
}

export interface Db extends Executor {
  readonly dialect: 'sqlite' | 'postgres';
  transaction<T>(fn: (tx: Executor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
