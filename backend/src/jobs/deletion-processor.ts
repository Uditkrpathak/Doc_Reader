import { Database } from '../db/pool.js';
import { logger } from '../shared/logger.js';

export const DELETION_PROCESSOR_LOCK_ID = 1002;

export class DeletionProcessor {
  constructor(private db: Database) {}

  async processPendingDeletions(): Promise<number> {
    const locked = await this.db.tryAdvisoryLock(DELETION_PROCESSOR_LOCK_ID);
    if (!locked) {
      return 0;
    }

    try {
      let processedCount = 0;

      // Find pending deletion requests
      const res = await this.db.query<{
        id: string;
        account_id: string;
      }>(
        `SELECT id, account_id
         FROM privacy_requests
         WHERE type = 'DELETE' AND status = 'PENDING'
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

          // 2. Anonymize account record (leave anonymous tombstone)
          await client.query(
            `UPDATE accounts
             SET status = 'DELETED',
                 email = NULL,
                 password_hash = 'DELETED',
                 install_hash = 'DELETED_' || gen_random_uuid(),
                 failed_logins = 0,
                 locked_until = NULL,
                 updated_at = NOW()
             WHERE id = $1::uuid;`,
            [req.account_id]
          );

          // 3. Revoke all active sessions
          await client.query(
            `UPDATE sessions
             SET revoked_at = NOW()
             WHERE account_id = $1::uuid AND revoked_at IS NULL;`,
            [req.account_id]
          );

          // 4. Scrub details in problem reports and ad reports
          await client.query(
            `UPDATE ad_reports
             SET details = NULL, ad_response_id = NULL
             WHERE account_id = $1::uuid;`,
            [req.account_id]
          );

          await client.query(
            `UPDATE problem_reports
             SET details = NULL, device_model = 'REDACTED'
             WHERE account_id = $1::uuid;`,
            [req.account_id]
          );

          // 5. Scrub support tickets
          await client.query(
            `UPDATE support_tickets
             SET email = 'deleted@privacy.local', message = '[REDACTED DUE TO ACCOUNT DELETION]'
             WHERE account_id = $1::uuid;`,
            [req.account_id]
          );

          // 6. Complete privacy request
          await client.query(
            `UPDATE privacy_requests
             SET status = 'COMPLETED', completed_at = NOW()
             WHERE id = $1::uuid;`,
            [req.id]
          );
        });

        processedCount++;
        logger.info({ accountId: req.account_id }, 'Processed account deletion tombstone');
      }

      return processedCount;
    } finally {
      await this.db.advisoryUnlock(DELETION_PROCESSOR_LOCK_ID);
    }
  }
}

