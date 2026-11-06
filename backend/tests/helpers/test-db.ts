import * as fs from 'fs';
import * as path from 'path';
import { Pool, PoolClient } from 'pg';
import { PGlite } from '@electric-sql/pglite';

export interface ITestDb {
  query: <T = any>(text: string, params?: any[]) => Promise<{ rows: T[]; rowCount: number }>;
  withTransaction: <T>(callback: (client: any) => Promise<T>) => Promise<T>;
  getClient: () => Promise<any>;
  close: () => Promise<void>;
  reset: () => Promise<void>;
  tryAdvisoryLock: (lockId: number) => Promise<boolean>;
  releaseAdvisoryLock: (lockId: number) => Promise<void>;
  advisoryUnlock: (lockId: number) => Promise<void>;
}

class AsyncMutex {
  private queue: Promise<void> = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.queue;
    this.queue = this.queue.then(() => wait);
    await prev;
    try {
      return await fn();
    } finally {
      release!();
    }
  }
}

class PGliteTestDb implements ITestDb {
  private db: PGlite;
  private mutex: AsyncMutex = new AsyncMutex();
  private locks: Set<number> = new Set();

  constructor() {
    this.db = new PGlite();
  }

  async init() {
    const migrationPath = path.resolve(__dirname, '../../migrations/001_init.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    await this.db.exec(sql);
  }

  async query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }> {
    const res = await this.db.query(text, params);
    return {
      rows: res.rows as T[],
      rowCount: (res as any).affectedRows ?? res.rows.length,
    };
  }

  async withTransaction<T>(callback: (client: any) => Promise<T>): Promise<T> {
    return this.mutex.runExclusive(async () => {
      await this.db.exec('BEGIN');
      try {
        const client = {
          query: (text: string, params?: any[]) => this.query(text, params),
        };
        const result = await callback(client);
        await this.db.exec('COMMIT');
        return result;
      } catch (err) {
        await this.db.exec('ROLLBACK');
        throw err;
      }
    });
  }

  async getClient(): Promise<any> {
    return {
      query: (text: string, params?: any[]) => this.query(text, params),
      release: () => {},
    };
  }

  async reset(): Promise<void> {
    // Truncate non-config tables
    await this.db.exec(`
      TRUNCATE TABLE 
        credit_ledger_entries,
        reward_claims,
        entitlements,
        purchase_records,
        processed_events,
        consent_records,
        privacy_requests,
        data_exports,
        ad_reports,
        problem_reports,
        support_tickets,
        email_outbox,
        admin_audit_log,
        sessions,
        auth_tokens,
        credit_accounts,
        accounts
      CASCADE;
    `);
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  async tryAdvisoryLock(lockId: number): Promise<boolean> {
    if (this.locks.has(lockId)) return false;
    this.locks.add(lockId);
    return true;
  }

  async releaseAdvisoryLock(lockId: number): Promise<void> {
    this.locks.delete(lockId);
  }

  async advisoryUnlock(lockId: number): Promise<void> {
    this.locks.delete(lockId);
  }
}

class PgPoolTestDb implements ITestDb {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async init() {
    const migrationPath = path.resolve(__dirname, '../../migrations/001_init.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    await this.pool.query(sql);
  }

  async query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }> {
    const res = await this.pool.query(text, params);
    return {
      rows: res.rows as T[],
      rowCount: res.rowCount ?? res.rows.length,
    };
  }

  async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async reset(): Promise<void> {
    await this.pool.query(`
      TRUNCATE TABLE 
        credit_ledger_entries,
        reward_claims,
        entitlements,
        purchase_records,
        processed_events,
        consent_records,
        privacy_requests,
        data_exports,
        ad_reports,
        problem_reports,
        support_tickets,
        email_outbox,
        admin_audit_log,
        sessions,
        auth_tokens,
        credit_accounts,
        accounts
      CASCADE;
    `);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async tryAdvisoryLock(lockId: number): Promise<boolean> {
    const res = await this.pool.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock($1) as locked`,
      [lockId]
    );
    return res.rows[0]?.locked === true;
  }

  async releaseAdvisoryLock(lockId: number): Promise<void> {
    await this.pool.query(`SELECT pg_advisory_unlock($1)`, [lockId]);
  }

  async advisoryUnlock(lockId: number): Promise<void> {
    await this.releaseAdvisoryLock(lockId);
  }
}

export async function createTestDb(): Promise<ITestDb> {
  const connStr = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (connStr && !connStr.includes('localhost:5432/docreader')) {
    try {
      const db = new PgPoolTestDb(connStr);
      await db.init();
      return db;
    } catch {
      // Fallback to PGlite
    }
  }

  const pgliteDb = new PGliteTestDb();
  await pgliteDb.init();
  return pgliteDb;
}
