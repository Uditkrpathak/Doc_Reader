import crypto from 'node:crypto';
import { Database } from '../db/pool.js';
import { sha256Hex } from '../shared/crypto.js';
import { queueEmail } from '../shared/email.js';
import { logger } from '../shared/logger.js';

export const EXPORT_BUILDER_LOCK_ID = 1003;

export class ExportBuilder {
  constructor(private db: Database) {}

  async processPendingExports(baseUrl: string = 'https://api.docreader.app'): Promise<number> {
    const locked = await this.db.tryAdvisoryLock(EXPORT_BUILDER_LOCK_ID);
    if (!locked) {
      return 0;
    }

    try {
      let processedCount = 0;

      const res = await this.db.query<{
        id: string;
        account_id: string;
      }>(
        `SELECT id, account_id
         FROM privacy_requests
         WHERE type = 'EXPORT' AND status = 'PENDING'
         ORDER BY created_at ASC
         LIMIT 10;`
      );

      for (const req of res.rows) {
        await this.db.withTransaction(async (client) => {
          // 1. Mark request PROCESSING
          await client.query(
            `UPDATE privacy_requests SET status = 'PROCESSING' WHERE id = $1::uuid;`,
            [req.id]
          );

          // 2. Gather account data
          const accRes = await client.query<{
            kind: string;
            status: string;
            email: string | null;
            created_at: Date;
          }>(
            `SELECT kind, status, email, created_at FROM accounts WHERE id = $1::uuid;`,
            [req.account_id]
          );
          const account = accRes.rows[0];

          // Wallet & ledger
          const walletRes = await client.query<{ balance: number }>(
            `SELECT balance FROM credit_accounts WHERE account_id = $1::uuid;`,
            [req.account_id]
          );
          const ledgerRes = await client.query<{
            amount: number;
            type: string;
            balance_after: number;
            created_at: Date;
          }>(
            `SELECT amount, type, balance_after, created_at
             FROM credit_ledger_entries
             WHERE account_id = $1::uuid
             ORDER BY created_at DESC;`,
            [req.account_id]
          );

          // Entitlements
          const entRes = await client.query<{ kind: string; ends_at: Date | null }>(
            `SELECT kind, ends_at FROM entitlements WHERE account_id = $1::uuid;`,
            [req.account_id]
          );

          // Consents
          const consentRes = await client.query<{
            purpose: string;
            granted: boolean;
            policy_version: string;
            source: string;
            created_at: Date;
          }>(
            `SELECT purpose, granted, policy_version, source, created_at
             FROM consent_records
             WHERE account_id = $1::uuid
             ORDER BY created_at DESC;`,
            [req.account_id]
          );

          const payload = {
            exportVersion: '1.0',
            exportedAt: new Date().toISOString(),
            account: {
              id: req.account_id,
              kind: account?.kind,
              status: account?.status,
              email: account?.email,
              createdAt: account?.created_at?.toISOString(),
            },
            wallet: {
              balance: walletRes.rows[0]?.balance ?? 0,
              ledger: ledgerRes.rows,
            },
            entitlements: entRes.rows,
            consents: consentRes.rows,
          };

          // Generate single-use 24-hour token
          const rawToken = crypto.randomBytes(32).toString('hex');
          const tokenHash = sha256Hex(rawToken);
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

          await client.query(
            `INSERT INTO data_exports (account_id, privacy_request_id, token_hash, payload, expires_at)
             VALUES ($1::uuid, $2::uuid, $3, $4, $5);`,
            [req.account_id, req.id, tokenHash, JSON.stringify(payload), expiresAt]
          );

          // Mark request COMPLETED
          await client.query(
            `UPDATE privacy_requests
             SET status = 'COMPLETED', completed_at = NOW()
             WHERE id = $1::uuid;`,
            [req.id]
          );

          // If email exists, queue download notification
          if (account?.email) {
            const downloadUrl = `${baseUrl}/v1/privacy/exports/${rawToken}`;
            await queueEmail(
              client,
              account.email,
              'Your Data Export is Ready',
              `Hello,\n\nYour requested data export is ready. You can download it using the link below:\n\n${downloadUrl}\n\nPlease note: This link will expire in 24 hours and can only be downloaded once.\n\nUniversal File Viewer Team`
            );
          }
        });

        processedCount++;
        logger.info({ accountId: req.account_id }, 'Completed user data export generation');
      }

      return processedCount;
    } finally {
      await this.db.advisoryUnlock(EXPORT_BUILDER_LOCK_ID);
    }
  }
}

