import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, ITestDb } from '../helpers/test-db';
import { Database } from '../../src/db/pool';
import { JwtService } from '../../src/shared/jwt';
import { RemoteConfigService } from '../../src/config/remote-config';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import { UserContext } from '../../src/shared/types';

describe('Wallet Concurrency & Trigger Immutability Tests', () => {
  let testDb: ITestDb;
  let walletService: WalletService;
  let testUser: UserContext;

  beforeEach(async () => {
    testDb = await createTestDb();
    await testDb.reset();

    const db = new Database({ connectionString: 'postgres://test' });
    (db as any).pool = testDb;
    (db as any).query = (text: string, params?: any[]) => testDb.query(text, params);
    (db as any).getClient = () => testDb.getClient();
    (db as any).withTransaction = (cb: any) => testDb.withTransaction(cb);

    const jwt = new JwtService({
      jwtSecret: 'test-jwt-secret-min-32-chars-long-123456',
      adminJwtSecret: 'test-admin-secret-min-32-chars-long-123456',
    });

    const configService = new RemoteConfigService();
    walletService = new WalletService(db, configService, jwt);

    // Create test registered account with 100 credits
    const acc = await testDb.query(
      `INSERT INTO accounts (kind, status, email) VALUES ('REGISTERED', 'ACTIVE', 'wallet-test@example.com') RETURNING id`
    );
    const accountId = acc.rows[0].id;

    await testDb.query(
      `INSERT INTO credit_accounts (account_id, balance) VALUES ($1::uuid, 100)`,
      [accountId]
    );

    testUser = {
      accountId,
      kind: 'REGISTERED',
      email: 'wallet-test@example.com',
    };
  });

  afterAll(async () => {
    if (testDb) await testDb.close();
  });

  it('20 parallel redemptions with 100 credits and 60-credit cost: exactly one succeeds, balance 40', async () => {
    // 20 distinct keys representing 20 simultaneous redemption attempts for h24 (cost 60)
    const promises = Array.from({ length: 20 }, (_, i) =>
      walletService
        .redeemAdFree(testUser, 'h24', `key-unique-${i}`)
        .then(() => ({ success: true }))
        .catch((err) => ({ success: false, code: err.code }))
    );

    const results = await Promise.all(promises);

    const successCount = results.filter((r) => r.success).length;
    const failedCount = results.filter((r) => !r.success).length;

    expect(successCount).toBe(1);
    expect(failedCount).toBe(19);

    // Balance must be exactly 40 (100 - 60)
    const acc = await testDb.query(
      `SELECT balance FROM credit_accounts WHERE account_id = $1::uuid`,
      [testUser.accountId]
    );
    expect(acc.rows[0].balance).toBe(40);

    // Exactly one ledger row inserted
    const ledger = await testDb.query(
      `SELECT COUNT(*) as count FROM credit_ledger_entries WHERE account_id = $1::uuid`,
      [testUser.accountId]
    );
    expect(parseInt(ledger.rows[0].count, 10)).toBe(1);
  });

  it('10 parallel redemptions with the SAME key: charged once, remaining replay', async () => {
    const sameKey = 'idempotent-key-same-123';

    const promises = Array.from({ length: 10 }, () =>
      walletService.redeemAdFree(testUser, 'h24', sameKey)
    );

    const results = await Promise.all(promises);

    // All return success (first creates, remaining replay result)
    expect(results).toHaveLength(10);
    for (const res of results) {
      expect(res.success).toBe(true);
      expect(res.balance).toBe(40);
    }

    // Balance is charged only once: 100 - 60 = 40
    const acc = await testDb.query(
      `SELECT balance FROM credit_accounts WHERE account_id = $1::uuid`,
      [testUser.accountId]
    );
    expect(acc.rows[0].balance).toBe(40);

    // Exactly one ledger row inserted
    const ledger = await testDb.query(
      `SELECT COUNT(*) as count FROM credit_ledger_entries WHERE account_id = $1::uuid`,
      [testUser.accountId]
    );
    expect(parseInt(ledger.rows[0].count, 10)).toBe(1);
  });

  it('rejects same idempotency key when called with a different tier (422)', async () => {
    const key = 'test-diff-tier-key';
    await walletService.redeemAdFree(testUser, 'h1', key); // 20 coins, balance 80

    // Call again with h24 using same key
    await expect(walletService.redeemAdFree(testUser, 'h24', key)).rejects.toThrow(
      /Idempotency key was previously used with a different redemption tier/
    );
  });

  it('database trigger rejects UPDATE and DELETE on credit_ledger_entries', async () => {
    await walletService.redeemAdFree(testUser, 'h1', 'trigger-test-key');

    const entry = await testDb.query(
      `SELECT id FROM credit_ledger_entries WHERE account_id = $1::uuid`,
      [testUser.accountId]
    );
    const entryId = entry.rows[0].id;

    // Direct UPDATE attempt must fail via trigger
    await expect(
      testDb.query(
        `UPDATE credit_ledger_entries SET amount = -999 WHERE id = $1::uuid`,
        [entryId]
      )
    ).rejects.toThrow(/credit_ledger_entries is append-only/);

    // Direct DELETE attempt must fail via trigger
    await expect(
      testDb.query(
        `DELETE FROM credit_ledger_entries WHERE id = $1::uuid`,
        [entryId]
      )
    ).rejects.toThrow(/credit_ledger_entries is append-only/);
  });
});

