// One SQLite file. Each plane creates its own tables in start(). Prepared statements are cached by SQL text.
import { DatabaseSync } from 'node:sqlite';
import type { StatementSync } from 'node:sqlite';
import type { Db } from './context.ts';

const STATEMENT_CACHE = 256;

export interface KernelDb extends Db {
  close(): void;
}

export function openDb(file: string): KernelDb {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const statements = new Map<string, StatementSync>();

  const prepare = (sql: string): StatementSync => {
    let statement = statements.get(sql);
    if (!statement) {
      if (statements.size >= STATEMENT_CACHE) statements.clear();
      statement = db.prepare(sql);
      statements.set(sql, statement);
    }
    return statement;
  };

  return {
    exec: (sql) => db.exec(sql),
    run(sql, ...params) {
      prepare(sql).run(...params);
    },
    get: <T>(sql: string, ...params: Parameters<Db['run']>[1][]) => prepare(sql).get(...params) as T | undefined,
    all: <T>(sql: string, ...params: Parameters<Db['run']>[1][]) => prepare(sql).all(...params) as T[],
    close() {
      statements.clear();
      db.close();
    },
  };
}
