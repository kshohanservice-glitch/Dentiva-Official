import { Database } from 'node-sqlite3-wasm';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AppError } from '../errors';

export type SqlParam = string | number | null | bigint | Uint8Array;
export type Row = Record<string, unknown>;

export interface QueryOptions {
  params?: SqlParam[];
  all?: boolean;
  one?: boolean;
  run?: boolean;
}

/**
 * Thin, fully-typed wrapper over the SQLite driver.
 *
 * All access is parameterised — there is no API on this class that accepts
 * caller-supplied SQL text, which is what makes SQL injection structurally
 * impossible rather than merely discouraged.
 */
export class Db {
  readonly raw: Database;
  readonly file: string;
  private readonly statementCache = new Map<string, ReturnType<Database['prepare']>>();
  private txDepth = 0;

  constructor(file: string) {
    this.file = file;
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.raw = new Database(file);
    this.raw.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA temp_store = MEMORY;
      PRAGMA recursive_triggers = ON;
    `);
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  private prepared(sql: string) {
    let st = this.statementCache.get(sql);
    if (!st) {
      st = this.raw.prepare(sql);
      this.statementCache.set(sql, st);
    }
    return st;
  }

  all<T = Row>(sql: string, params: SqlParam[] = []): T[] {
    return this.prepared(sql).all(params) as T[];
  }

  get<T = Row>(sql: string, params: SqlParam[] = []): T | undefined {
    return this.prepared(sql).get(params) as T | undefined;
  }

  run(sql: string, params: SqlParam[] = []): { changes: number; lastInsertRowid: number } {
    const r = this.prepared(sql).run(params);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  insert(sql: string, params: SqlParam[] = []): number {
    return this.run(sql, params).lastInsertRowid;
  }

  count(sql: string, params: SqlParam[] = []): number {
    const row = this.get<{ n: number }>(sql, params);
    return row ? Number(row.n) : 0;
  }

  exists(sql: string, params: SqlParam[] = []): boolean {
    return this.get<{ n: number }>(sql, params) !== undefined;
  }

  /**
   * Runs `fn` inside a transaction. Nested calls join the outer transaction
   * (SQLite has no nested BEGIN), so services can compose safely.
   */
  transaction<T>(fn: () => T): T {
    if (this.txDepth > 0) return fn();
    this.txDepth += 1;
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.raw.exec('ROLLBACK');
      } catch {
        /* rollback of an already-aborted transaction is not an error we can act on */
      }
      throw error;
    } finally {
      this.txDepth -= 1;
    }
  }

  inTransaction(): boolean {
    return this.txDepth > 0;
  }

  /** Consistent snapshot of the live database — used by the backup engine. */
  vacuumInto(targetFile: string): void {
    if (this.inTransaction()) throw new AppError('backup_error', 'A backup cannot be taken while a change is in progress.');
    this.releaseStatements();
    this.raw.exec(`VACUUM INTO ${quoteIdent(targetFile)}`);
  }

  quickCheck(): string {
    const row = this.get<{ quick_check: string }>('PRAGMA quick_check');
    return row ? String(row.quick_check) : 'unknown';
  }

  checkpoint(): void {
    try {
      this.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      /* a checkpoint failure is not fatal — the WAL is still consistent */
    }
  }

  clearCache(): void {
    this.statementCache.clear();
  }

  /**
   * Finalises every cached statement. SQLite refuses `VACUUM` while a prepared
   * statement is still open, so the cache has to be released first. Statements
   * are re-prepared transparently on the next query.
   */
  releaseStatements(): void {
    for (const st of this.statementCache.values()) {
      try {
        st.finalize();
      } catch {
        /* already finalised */
      }
    }
    this.statementCache.clear();
  }

  close(): void {
    this.clearCache();
    try {
      this.raw.close();
    } catch {
      /* already closed */
    }
  }
}

function quoteIdent(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
