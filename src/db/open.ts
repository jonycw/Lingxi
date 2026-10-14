import type { AppConfig } from '../config.js';
import { resolveSqlitePath } from '../paths.js';
import type { Db } from './executor.js';
import { openPostgres } from './postgres.js';
import { openSqlite } from './sqlite.js';

export function openDatabase(config: Pick<AppConfig, 'databaseUrl'>): Db {
  const url = config.databaseUrl.trim();
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    return openPostgres(url);
  }
  return openSqlite(resolveSqlitePath(url));
}
