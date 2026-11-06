import { Database } from '../../db/pool.js';
import { AppError } from '../../shared/errors.js';
import { sha256Hex } from '../../shared/crypto.js';
import { getServerTime } from '../../shared/time.js';

export interface ConsentItem {
  purpose: 'USAGE_ANALYTICS' | 'PERSONALISED_CONTENT' | 'PERSONALISED_ADS' | 'CRASH_DIAGNOSTICS';
  granted: boolean;
}

export class PrivacyService {
  constructor(private db: Database) {}

  async getConsents(accountId: string) {
    const res = await this.db.query<{
      purpose: string;
      granted: boolean;
      policy_version: string;
      source: string;
      created_at: Date;
    }>(
      `SELECT DISTINCT ON (purpose) purpose, granted, policy_version, source, created_at
       FROM consent_records
       WHERE account_id = $1::uuid
       ORDER BY purpose, created_at DESC;`,
      [accountId]
    );

    return {
      consents: res.rows.map((r) => ({
        purpose: r.purpose,
        granted: r.granted,
        policyVersion: r.policy_version,
        source: r.source,
        updatedAt: r.created_at.toISOString(),
      })),
      serverTime: getServerTime(),
    };
  }

  async putConsents(
    accountId: string,
    consents: ConsentItem[],
    policyVersion: string,
    source: string
  ) {
    await this.db.withTransaction(async (client) => {
      for (const item of consents) {
        await client.query(
          `INSERT INTO consent_records (account_id, purpose, granted, policy_version, source)
           VALUES ($1::uuid, $2, $3, $4, $5);`,
          [accountId, item.purpose, item.granted, policyVersion, source]
        );
      }
    });

    return this.getConsents(accountId);
  }

  async createPrivacyRequest(accountId: string, type: 'EXPORT' | 'DELETE') {
    // DPDP Act 2023: 30 days due date for compliance requests
    const dueAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    try {
      const res = await this.db.query<{
        id: string;
        type: string;
        status: string;
        due_at: Date;
        created_at: Date;
      }>(
        `INSERT INTO privacy_requests (account_id, type, status, due_at)
         VALUES ($1::uuid, $2, 'PENDING', $3)
         RETURNING id, type, status, due_at, created_at;`,
        [accountId, type, dueAt]
      );

      const row = res.rows[0]!;

      // If DELETE request, mark account status PENDING_DELETION
      if (type === 'DELETE') {
        await this.db.query(
          `UPDATE accounts SET status = 'PENDING_DELETION' WHERE id = $1::uuid;`,
          [accountId]
        );
      }

      return {
        id: row.id,
        type: row.type,
        status: row.status,
        dueAt: row.due_at.toISOString(),
        createdAt: row.created_at.toISOString(),
        serverTime: getServerTime(),
      };
    } catch (err: any) {
      if (err.code === '23505') {
        // Unique violation on partial index uq_open_privacy_request
        throw new AppError(409, `An open ${type} request already exists for this account.`);
      }
      throw err;
    }
  }

  async downloadExport(token: string) {
    const tokenHash = sha256Hex(token);

    const res = await this.db.query<{
      id: string;
      payload: any;
      expires_at: Date;
      downloaded_at: Date | null;
    }>(
      `SELECT id, payload, expires_at, downloaded_at
       FROM data_exports
       WHERE token_hash = $1;`,
      [tokenHash]
    );

    if (res.rows.length === 0 || !res.rows[0]) {
      throw new AppError(404, 'Export download token not found.');
    }

    const exportRow = res.rows[0];

    if (exportRow.downloaded_at) {
      throw new AppError(410, 'This single-use export has already been downloaded.');
    }

    if (new Date() > new Date(exportRow.expires_at)) {
      throw new AppError(410, 'This export download link has expired.');
    }

    // Mark as downloaded (single-use guarantee)
    await this.db.query(
      `UPDATE data_exports SET downloaded_at = NOW() WHERE id = $1::uuid;`,
      [exportRow.id]
    );

    return exportRow.payload;
  }
}
