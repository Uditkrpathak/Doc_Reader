import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, ITestDb } from '../helpers/test-db.js';
import { LedgerReconciler } from '../../src/jobs/reconciliation.js';
import { ClaimExpirer } from '../../src/jobs/claim-expirer.js';
import { DeletionProcessor } from '../../src/jobs/deletion-processor.js';
import { ExportBuilder } from '../../src/jobs/export-builder.js';
import { RemoteConfigService } from '../../src/config/remote-config.js';

describe('Background Jobs & Ledger Reconciliation Integration Tests', () => {
  let db: ITestDb;
  let remoteConfigService: RemoteConfigService;

  beforeEach(async () => {
    db = await createTestDb();
    remoteConfigService = new RemoteConfigService();
  });

  describe('Ledger Integrity Reconciliation', () => {
    it('verifies 100% integrity when balances match ledger entries exactly', async () => {
      // Create 3 accounts with ledger history
      for (let i = 1; i <= 3; i++) {
        const accRes = await db.query<{ id: string }>(
          `INSERT INTO accounts (kind, status, install_hash)
           VALUES ('GUEST', 'ACTIVE', 'recon_inst_${i}')
           RETURNING id;`
        );
        const accId = accRes.rows[0]!.id;

        // Account balance 30
        await db.query(
          `INSERT INTO credit_accounts (account_id, balance, version)
           VALUES ($1::uuid, 30, 1);`,
          [accId]
        );

        // Ledger: +20, +10 = 30
        await db.query(
          `INSERT INTO credit_ledger_entries (account_id, amount, balance_after, type, idempotency_key)
           VALUES ($1::uuid, 20, 20, 'EARN_REWARD', 'key_${i}_1'),
                  ($1::uuid, 10, 30, 'EARN_REWARD', 'key_${i}_2');`,
          [accId]
        );
      }

      const reconciler = new LedgerReconciler(db as any);
      const report = await reconciler.reconcile();

      expect(report.totalAccountsChecked).toBe(3);
      expect(report.healthyCount).toBe(3);
      expect(report.discrepancies).toHaveLength(0);
    });

    it('detects discrepancies if an account balance does not equal sum of ledger', async () => {
      const accRes = await db.query<{ id: string }>(
        `INSERT INTO accounts (kind, status, install_hash)
         VALUES ('GUEST', 'ACTIVE', 'recon_inst_corrupt')
         RETURNING id;`
      );
      const accId = accRes.rows[0]!.id;

      // Stored balance is 50, but ledger sum is only 20!
      await db.query(
        `INSERT INTO credit_accounts (account_id, balance, version)
         VALUES ($1::uuid, 50, 1);`,
        [accId]
      );
      await db.query(
        `INSERT INTO credit_ledger_entries (account_id, amount, balance_after, type, idempotency_key)
         VALUES ($1::uuid, 20, 20, 'EARN_REWARD', 'corrupt_key');`,
        [accId]
      );

      const reconciler = new LedgerReconciler(db as any);
      const report = await reconciler.reconcile();

      expect(report.discrepancies).toHaveLength(1);
      const disc = report.discrepancies[0]!;
      expect(disc.accountId).toBe(accId);
      expect(disc.storedBalance).toBe(50);
      expect(disc.calculatedBalance).toBe(20);
      expect(disc.diff).toBe(30);
    });
  });

  describe('Claim Expirer Worker', () => {
    it('marks stale started claims as EXPIRED based on TTL', async () => {
      const accRes = await db.query<{ id: string }>(
        `INSERT INTO accounts (kind, status, install_hash)
         VALUES ('GUEST', 'ACTIVE', 'expirer_inst')
         RETURNING id;`
      );
      const accId = accRes.rows[0]!.id;

      // 1. Stale claim started 20 minutes ago (past 600s TTL)
      await db.query(
        `INSERT INTO reward_claims (account_id, day_bucket, status, custom_data, expires_at)
         VALUES ($1::uuid, '2026-11-05', 'STARTED', '{"test":1}', NOW() - INTERVAL '20 minutes');`,
        [accId]
      );

      // 2. Fresh claim started 1 minute ago
      await db.query(
        `INSERT INTO reward_claims (account_id, day_bucket, status, custom_data, expires_at)
         VALUES ($1::uuid, '2026-11-05', 'STARTED', '{"test":2}', NOW() + INTERVAL '9 minutes');`,
        [accId]
      );

      const expirer = new ClaimExpirer(db as any, remoteConfigService);
      const expiredCount = await expirer.expireStaleClaims();

      expect(expiredCount).toBe(1);

      const claims = await db.query<{ status: string }>(
        `SELECT status FROM reward_claims WHERE account_id = $1::uuid ORDER BY created_at ASC;`,
        [accId]
      );
      expect(claims.rows[0]!.status).toBe('EXPIRED');
      expect(claims.rows[1]!.status).toBe('STARTED');
    });
  });

  describe('Deletion Processor & Export Builder', () => {
    it('processes account deletion and anonymizes records into tombstone', async () => {
      const accRes = await db.query<{ id: string }>(
        `INSERT INTO accounts (kind, status, install_hash, email, password_hash)
         VALUES ('REGISTERED', 'PENDING_DELETION', 'del_inst_hash', 'user@privacy.org', 'SecretHash123')
         RETURNING id;`
      );
      const accId = accRes.rows[0]!.id;

      // Add privacy deletion request
      await db.query<{ id: string }>(
        `INSERT INTO privacy_requests (account_id, type, status, due_at)
         VALUES ($1::uuid, 'DELETE', 'PENDING', NOW() + INTERVAL '30 days')
         RETURNING id;`,
        [accId]
      );

      // Add session & support ticket
      await db.query(
        `INSERT INTO sessions (account_id, family_id, refresh_hash, expires_at)
         VALUES ($1::uuid, gen_random_uuid(), 'hash1', NOW() + INTERVAL '30 days');`,
        [accId]
      );
      await db.query(
        `INSERT INTO support_tickets (ticket_number, account_id, email, category, message, status)
         VALUES ('TICK-DEL-1', $1::uuid, 'user@privacy.org', 'HELP', 'Secret user data', 'OPEN');`,
        [accId]
      );

      const processor = new DeletionProcessor(db as any);
      const processed = await processor.processPendingDeletions();
      expect(processed).toBe(1);

      // Verify account anonymized
      const accAfter = await db.query<{ email: string | null; status: string }>(
        `SELECT email, status FROM accounts WHERE id = $1::uuid;`,
        [accId]
      );
      expect(accAfter.rows[0]!.status).toBe('DELETED');
      expect(accAfter.rows[0]!.email).toBeNull();

      // Verify sessions revoked
      const sessAfter = await db.query<{ revoked_at: Date | null }>(
        `SELECT revoked_at FROM sessions WHERE account_id = $1::uuid;`,
        [accId]
      );
      expect(sessAfter.rows[0]!.revoked_at).not.toBeNull();

      // Verify support ticket message scrubbed
      const tickAfter = await db.query<{ email: string; message: string }>(
        `SELECT email, message FROM support_tickets WHERE account_id = $1::uuid;`,
        [accId]
      );
      expect(tickAfter.rows[0]!.email).toBe('deleted@privacy.local');
      expect(tickAfter.rows[0]!.message).toContain('[REDACTED DUE TO ACCOUNT DELETION]');
    });

    it('builds JSON export with 24h expiration and creates single-use download', async () => {
      const accRes = await db.query<{ id: string }>(
        `INSERT INTO accounts (kind, status, install_hash, email)
         VALUES ('REGISTERED', 'ACTIVE', 'export_inst_hash', 'export_user@example.com')
         RETURNING id;`
      );
      const accId = accRes.rows[0]!.id;
      await db.query(
        `INSERT INTO credit_accounts (account_id, balance, version)
         VALUES ($1::uuid, 80, 1);`,
        [accId]
      );

      await db.query(
        `INSERT INTO privacy_requests (account_id, type, status, due_at)
         VALUES ($1::uuid, 'EXPORT', 'PENDING', NOW() + INTERVAL '30 days');`,
        [accId]
      );

      const builder = new ExportBuilder(db as any);
      const processed = await builder.processPendingExports();
      expect(processed).toBe(1);

      // Verify data_exports has been created
      const expRes = await db.query<{ payload: any; expires_at: Date }>(
        `SELECT payload, expires_at FROM data_exports WHERE account_id = $1::uuid;`,
        [accId]
      );
      expect(expRes.rows).toHaveLength(1);
      expect(expRes.rows[0]!.payload.wallet.balance).toBe(80);
      expect(new Date(expRes.rows[0]!.expires_at).getTime()).toBeGreaterThan(Date.now());
    });
  });
});
