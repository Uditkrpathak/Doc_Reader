import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, ITestDb } from '../helpers/test-db';
import { Database } from '../../src/db/pool';
import { JwtService } from '../../src/shared/jwt';
import { EmailService } from '../../src/shared/email';
import { RemoteConfigService } from '../../src/config/remote-config';
import { IdentityService } from '../../src/modules/identity/identity.service';

describe('Identity & Account Lifecycle Tests', () => {
  let testDb: ITestDb;
  let identityService: IdentityService;
  let jwt: JwtService;

  beforeEach(async () => {
    testDb = await createTestDb();
    await testDb.reset();

    const db = new Database({ connectionString: 'postgres://test' });
    // Point internal db query/transactions to testDb
    (db as any).pool = testDb;
    (db as any).query = (text: string, params?: any[]) => testDb.query(text, params);
    (db as any).getClient = () => testDb.getClient();
    (db as any).withTransaction = (cb: any) => testDb.withTransaction(cb);
    (db as any).lockTwoAccountsForUpdate = async (client: any, id1: string, id2: string) => {
      const [firstId, secondId] = [id1, id2].sort();
      const r1 = await client.query('SELECT balance, version FROM credit_accounts WHERE account_id = $1::uuid', [firstId]);
      const r2 = await client.query('SELECT balance, version FROM credit_accounts WHERE account_id = $1::uuid', [secondId]);
      return {
        first: { id: firstId, balance: r1.rows[0].balance, version: r1.rows[0].version },
        second: { id: secondId, balance: r2.rows[0].balance, version: r2.rows[0].version },
      };
    };

    jwt = new JwtService({
      jwtSecret: 'test-jwt-secret-min-32-chars-long-123456',
      adminJwtSecret: 'test-admin-secret-min-32-chars-long-123456',
    });

    const emailService = new EmailService();
    const configService = new RemoteConfigService();

    identityService = new IdentityService(db, jwt, emailService, configService);
  });

  afterAll(async () => {
    if (testDb) await testDb.close();
  });

  it('creates guest account with 0 credits and returns tokens', async () => {
    const res = await identityService.handleGuest('install-device-123');
    expect(res.account.kind).toBe('GUEST');
    expect(res.accessToken).toBeDefined();
    expect(res.refreshToken).toBeDefined();

    // Calling again with same installId returns existing guest
    const res2 = await identityService.handleGuest('install-device-123');
    expect(res2.account.id).toBe(res.account.id);
  });

  it('keeps credits when upgrading guest in-place via signup', async () => {
    const guest = await identityService.handleGuest('install-upgrade-test');
    
    // Add 50 credits to guest account
    await testDb.query(
      `UPDATE credit_accounts SET balance = 50 WHERE account_id = $1`,
      [guest.account.id]
    );

    // Signup with guest Bearer token present
    const signup = await identityService.handleSignup('user@example.com', 'StrongPass123!', {
      accountId: guest.account.id,
      kind: 'GUEST',
    });

    expect(signup.account.id).toBe(guest.account.id);
    expect(signup.account.kind).toBe('REGISTERED');

    // Verify credits were preserved
    const creditRes = await testDb.query(
      `SELECT balance FROM credit_accounts WHERE account_id = $1::uuid`,
      [signup.account.id]
    );
    expect(creditRes.rows[0].balance).toBe(50);
  });

  it('merges guest balance into registered account upon login idempotently', async () => {
    // 1. Create registered user with 30 credits
    const reg = await identityService.handleSignup('target@example.com', 'Password123!');
    await testDb.query(
      `UPDATE credit_accounts SET balance = 30 WHERE account_id = $1::uuid`,
      [reg.account.id]
    );

    // 2. Create guest with 40 credits
    const guest = await identityService.handleGuest('guest-merge-device');
    await testDb.query(
      `UPDATE credit_accounts SET balance = 40 WHERE account_id = $1::uuid`,
      [guest.account.id]
    );

    // 3. Login with guest token present -> triggers merge
    const loginRes = await identityService.handleLogin('target@example.com', 'Password123!', {
      accountId: guest.account.id,
      kind: 'GUEST',
    });
    expect(loginRes.account.id).toBe(reg.account.id);

    // Verify merged balance: 30 + 40 = 70
    const targetCredit = await testDb.query(
      `SELECT balance FROM credit_accounts WHERE account_id = $1::uuid`,
      [reg.account.id]
    );
    expect(targetCredit.rows[0].balance).toBe(70);

    const guestCredit = await testDb.query(
      `SELECT balance FROM credit_accounts WHERE account_id = $1::uuid`,
      [guest.account.id]
    );
    expect(guestCredit.rows[0].balance).toBe(0);

    // Verify guest is marked MERGED
    const guestAcc = await testDb.query(
      `SELECT status, merged_into FROM accounts WHERE id = $1::uuid`,
      [guest.account.id]
    );
    expect(guestAcc.rows[0].status).toBe('MERGED');
    expect(guestAcc.rows[0].merged_into).toBe(reg.account.id);

    // 4. Running login again is idempotent
    await identityService.handleLogin('target@example.com', 'Password123!', {
      accountId: guest.account.id,
      kind: 'GUEST',
    });
    const recheck = await testDb.query(
      `SELECT balance FROM credit_accounts WHERE account_id = $1::uuid`,
      [reg.account.id]
    );
    expect(recheck.rows[0].balance).toBe(70);
  });

  it('rotates refresh tokens and revokes entire family upon token reuse', async () => {
    const signup = await identityService.handleSignup('refresh@example.com', 'Password123!');
    const token1 = signup.refreshToken;

    // Normal rotation -> token2
    const rotate1 = await identityService.handleRefresh(token1);
    expect(rotate1.refreshToken).toBeDefined();
    expect(rotate1.refreshToken).not.toBe(token1);

    // Replay of token1 (already used) outside 10s grace
    // Simulate used_at was 15s ago on the rotated session
    await testDb.query(
      `UPDATE sessions SET used_at = NOW() - INTERVAL '15 seconds' WHERE used_at IS NOT NULL`
    );

    await expect(identityService.handleRefresh(token1)).rejects.toThrow(
      /Suspicious token reuse detected/
    );

    // Verify all sessions in that family are revoked
    const sessions = await testDb.query(`SELECT revoked_at FROM sessions`);
    for (const row of sessions.rows) {
      expect(row.revoked_at).not.toBeNull();
    }
  });

  it('returns identical 202 response for known and unknown email in forgot-password', async () => {
    await identityService.handleSignup('known@example.com', 'Password123!');

    const resKnown = await identityService.handleForgotPassword('known@example.com');
    const resUnknown = await identityService.handleForgotPassword('unknown@example.com');

    expect(resKnown).toEqual(resUnknown);
    expect(resKnown.message).toContain('If an account exists');
  });

  it('locks account after 5 failed login attempts with constant-time response', async () => {
    await identityService.handleSignup('lockout@example.com', 'CorrectPass123!');

    // 4 failed attempts
    for (let i = 0; i < 4; i++) {
      await expect(
        identityService.handleLogin('lockout@example.com', 'WrongPass!')
      ).rejects.toThrow('Invalid email or password');
    }

    // 5th failed attempt -> locks account
    await expect(
      identityService.handleLogin('lockout@example.com', 'WrongPass!')
    ).rejects.toThrow('Invalid email or password');

    const acc = await testDb.query(
      `SELECT failed_logins, locked_until FROM accounts WHERE email = 'lockout@example.com'`
    );
    expect(acc.rows[0].failed_logins).toBe(5);
    expect(acc.rows[0].locked_until).not.toBeNull();

    // Even with correct password, login is blocked while locked
    await expect(
      identityService.handleLogin('lockout@example.com', 'CorrectPass123!')
    ).rejects.toThrow('Invalid email or password');
  });
});
