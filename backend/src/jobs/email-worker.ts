import { Database } from '../db/pool.js';
import { EmailService } from '../shared/email.js';
import { logger } from '../shared/logger.js';

export const EMAIL_WORKER_LOCK_ID = 1001;

export class EmailWorker {
  constructor(
    private db: Database,
    private emailService: EmailService
  ) {}

  async processPendingEmails(): Promise<number> {
    const locked = await this.db.tryAdvisoryLock(EMAIL_WORKER_LOCK_ID);
    if (!locked) {
      return 0; // Another instance is currently processing
    }

    try {
      let processedCount = 0;

      // Select batch of pending emails
      const res = await this.db.query<{
        id: string;
        to_email: string;
        subject: string;
        body_text: string;
        attempts: number;
      }>(
        `SELECT id, to_email, subject, body_text, attempts
         FROM email_outbox
         WHERE status IN ('PENDING', 'PROCESSING')
           AND next_attempt_at <= NOW()
           AND attempts < 5
         ORDER BY created_at ASC
         LIMIT 20;`
      );

      for (const row of res.rows) {
        // Mark as PROCESSING
        await this.db.query(
          `UPDATE email_outbox SET status = 'PROCESSING' WHERE id = $1::uuid;`,
          [row.id]
        );

        try {
          await this.emailService.sendDirect(row.to_email, row.subject, row.body_text);

          // Mark as SENT
          await this.db.query(
            `UPDATE email_outbox SET status = 'SENT', last_error = NULL WHERE id = $1::uuid;`,
            [row.id]
          );
          processedCount++;
        } catch (err: any) {
          const nextAttempts = row.attempts + 1;
          const status = nextAttempts >= 5 ? 'FAILED' : 'PENDING';
          // Exponential backoff: 30s * 2^attempts
          const backoffSeconds = 30 * Math.pow(2, row.attempts);

          await this.db.query(
            `UPDATE email_outbox
             SET status = $1,
                 attempts = $2,
                 next_attempt_at = NOW() + ($3 || ' seconds')::interval,
                 last_error = $4
             WHERE id = $5::uuid;`,
            [status, nextAttempts, backoffSeconds, err.message, row.id]
          );

          logger.error({ err, emailId: row.id }, 'Email dispatch failed, scheduled backoff');
        }
      }

      return processedCount;
    } finally {
      await this.db.advisoryUnlock(EMAIL_WORKER_LOCK_ID);
    }
  }
}

