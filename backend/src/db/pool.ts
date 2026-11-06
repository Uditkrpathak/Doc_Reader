import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { logger } from '../shared/logger';

export interface DatabaseConfig {
  connectionString?: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

export class Database {
  private pool: Pool;

  constructor(configOrPool?: DatabaseConfig | Pool) {
    if (configOrPool && 'connect' in configOrPool) {
      this.pool = configOrPool as Pool;
    } else {
      const config = (configOrPool as DatabaseConfig) || {};
      this.pool = new Pool({
        connectionString: config.connectionString || process.env.DATABASE_URL,
        max: config.max ?? 20,
        idleTimeoutMillis: config.idleTimeoutMillis ?? 30000,
        connectionTimeoutMillis: config.connectionTimeoutMillis ?? 5000,
      });
    }

    this.pool.on('error', (err) => {
      logger.error({ err }, 'Unexpected idle PostgreSQL client error');
    });
  }

  getPool(): Pool {
    return this.pool;
  }

  async query<R extends QueryResultRow = any, I extends any[] = any[]>(
    text: string,
    params?: I
  ): Promise<QueryResult<R>> {
    return this.pool.query<R>(text, params);
  }

  async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  /**
   * Run operations inside a single database transaction with automatic rollback on error
   */
  async withTransaction<T>(
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.getClient();
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

  /**
   * Lock a single credit_accounts row with SELECT ... FOR UPDATE
   */
  async lockAccountForUpdate(client: PoolClient, accountId: string): Promise<{ balance: number; version: number }> {
    const res = await client.query(
      `SELECT balance, version FROM credit_accounts WHERE account_id = $1 FOR UPDATE`,
      [accountId]
    );
    if (res.rows.length === 0) {
      throw new Error(`Credit account not found for account: ${accountId}`);
    }
    return {
      balance: res.rows[0].balance,
      version: res.rows[0].version,
    };
  }

  /**
   * Lock two accounts strictly in lexicographical ID order to prevent deadlock in concurrent merges/transfers
   */
  async lockTwoAccountsForUpdate(
    client: PoolClient,
    id1: string,
    id2: string
  ): Promise<{
    first: { id: string; balance: number; version: number };
    second: { id: string; balance: number; version: number };
  }> {
    if (id1 === id2) {
      const acc = await this.lockAccountForUpdate(client, id1);
      return {
        first: { id: id1, ...acc },
        second: { id: id2, ...acc },
      };
    }

    const [firstId, secondId] = [id1, id2].sort() as [string, string];
    const acc1 = await this.lockAccountForUpdate(client, firstId);
    const acc2 = await this.lockAccountForUpdate(client, secondId);

    return {
      first: { id: firstId, ...acc1 },
      second: { id: secondId, ...acc2 },
    };
  }

  /**
   * Run background job protected by PostgreSQL advisory lock (pg_try_advisory_lock)
   */
  async tryAdvisoryLock(lockId: number): Promise<boolean> {
    const res = await this.pool.query(`SELECT pg_try_advisory_lock($1) as locked`, [lockId]);
    return res.rows[0]?.locked === true;
  }

  async releaseAdvisoryLock(lockId: number): Promise<void> {
    await this.pool.query(`SELECT pg_advisory_unlock($1)`, [lockId]);
  }

  async advisoryUnlock(lockId: number): Promise<void> {
    return this.releaseAdvisoryLock(lockId);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export const db = new Database(pool);
