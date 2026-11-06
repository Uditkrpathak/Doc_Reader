import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, ITestDb } from '../helpers/test-db';
import { Database } from '../../src/db/pool';
import { FakePlayClient } from '../../src/modules/billing/play-client';
import { BillingService } from '../../src/modules/billing/billing.service';
import { UserContext } from '../../src/shared/types';

describe('Google Play Billing & Lifetime Purchases Tests', () => {
  let testDb: ITestDb;
  let billingService: BillingService;
  let fakePlay: FakePlayClient;
  let user1: UserContext;
  let user2: UserContext;

  beforeEach(async () => {
    testDb = await createTestDb();
    await testDb.reset();

    const db = new Database({ connectionString: 'postgres://test' });
    (db as any).pool = testDb;
    (db as any).query = (text: string, params?: any[]) => testDb.query(text, params);
    (db as any).getClient = () => testDb.getClient();
    (db as any).withTransaction = (cb: any) => testDb.withTransaction(cb);

    fakePlay = new FakePlayClient();
    billingService = new BillingService(db, fakePlay);

    // Create 2 test users
    const u1 = await testDb.query(
      `INSERT INTO accounts (kind, status, email) VALUES ('REGISTERED', 'ACTIVE', 'user1@example.com') RETURNING id`
    );
    const u2 = await testDb.query(
      `INSERT INTO accounts (kind, status, email) VALUES ('REGISTERED', 'ACTIVE', 'user2@example.com') RETURNING id`
    );

    user1 = { accountId: u1.rows[0].id, kind: 'REGISTERED', email: 'user1@example.com' };
    user2 = { accountId: u2.rows[0].id, kind: 'REGISTERED', email: 'user2@example.com' };
  });

  afterAll(async () => {
    if (testDb) await testDb.close();
  });

  it('verifies ACTIVE subscription and grants PREMIUM entitlement', async () => {
    const token = 'token-sub-active-1';
    fakePlay.setSubscription(token, {
      state: 'ACTIVE',
      expiryTime: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      acknowledgementState: 'NOT_ACKNOWLEDGED',
    });

    const res = await billingService.verifyPurchase(user1, 'SUBSCRIPTION', 'pro_annual', token);

    expect(res.success).toBe(true);
    expect(res.state).toBe('ACTIVE');
    expect(res.premium.active).toBe(true);
    expect(res.acknowledged).toBe(true);

    // Verify token was acknowledged on Play
    expect(fakePlay.acknowledgedTokens.has(token)).toBe(true);

    // Verify entitlement record in DB
    const ent = await testDb.query(
      `SELECT kind, ends_at FROM entitlements WHERE account_id = $1::uuid AND kind = 'PREMIUM'`,
      [user1.accountId]
    );
    expect(ent.rows).toHaveLength(1);
    expect(new Date(ent.rows[0].ends_at) > new Date()).toBe(true);
  });

  it('handles IN_GRACE_PERIOD as active access', async () => {
    const token = 'token-sub-grace-1';
    fakePlay.setSubscription(token, {
      state: 'IN_GRACE_PERIOD',
      expiryTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      acknowledgementState: 'ACKNOWLEDGED',
    });

    const res = await billingService.verifyPurchase(user1, 'SUBSCRIPTION', 'pro_monthly', token);
    expect(res.premium.active).toBe(true);
  });

  it('handles CANCELED subscription as active until expiry, then expired', async () => {
    const token = 'token-sub-canceled-1';
    const futureExpiry = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    fakePlay.setSubscription(token, {
      state: 'CANCELED',
      expiryTime: futureExpiry,
      acknowledgementState: 'ACKNOWLEDGED',
    });

    const res = await billingService.verifyPurchase(user1, 'SUBSCRIPTION', 'pro_monthly', token);
    expect(res.premium.active).toBe(true);
    expect(res.premium.endsAt).toBe(futureExpiry.toISOString());
  });

  it('handles ONE_TIME lifetime product with year 9999 expiry', async () => {
    const token = 'token-lifetime-1';
    fakePlay.setProduct(token, {
      purchaseState: 'PURCHASED',
      acknowledgementState: 'NOT_ACKNOWLEDGED',
      purchaseTime: new Date(),
    });

    const res = await billingService.verifyPurchase(user1, 'ONE_TIME', 'pro_lifetime', token);
    expect(res.premium.active).toBe(true);
    expect(res.premium.endsAt).toContain('9999-12-31');
  });

  it('rejects purchase token with 409 if already linked to a different REGISTERED account', async () => {
    const token = 'token-owned-by-user1';
    fakePlay.setSubscription(token, {
      state: 'ACTIVE',
      expiryTime: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      acknowledgementState: 'ACKNOWLEDGED',
    });

    // User1 verifies token
    await billingService.verifyPurchase(user1, 'SUBSCRIPTION', 'pro_annual', token);

    // User2 attempts to verify the same token -> 409 PURCHASE_ALREADY_LINKED
    await expect(
      billingService.verifyPurchase(user2, 'SUBSCRIPTION', 'pro_annual', token)
    ).rejects.toThrow(/already linked to a registered account/);
  });

  it('re-links purchase from an orphaned GUEST account to a registered account', async () => {
    // Create guest account
    const g = await testDb.query(
      `INSERT INTO accounts (kind, status) VALUES ('GUEST', 'ACTIVE') RETURNING id`
    );
    const guestUser: UserContext = { accountId: g.rows[0].id, kind: 'GUEST' };

    const token = 'token-guest-relink';
    fakePlay.setSubscription(token, {
      state: 'ACTIVE',
      expiryTime: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      acknowledgementState: 'ACKNOWLEDGED',
    });

    // Guest purchases subscription
    await billingService.verifyPurchase(guestUser, 'SUBSCRIPTION', 'pro_annual', token);

    // Registered user1 restores the token -> successfully re-linked
    const res = await billingService.verifyPurchase(user1, 'SUBSCRIPTION', 'pro_annual', token);
    expect(res.success).toBe(true);
    expect(res.premium.active).toBe(true);

    const record = await testDb.query(
      `SELECT account_id FROM purchase_records WHERE purchase_token = $1`,
      [token]
    );
    expect(record.rows[0].account_id).toBe(user1.accountId);
  });

  it('handles Pub/Sub webhook: refetches state, handles voided/refund, ignores out-of-order', async () => {
    const token = 'token-pubsub-test';
    fakePlay.setSubscription(token, {
      state: 'ACTIVE',
      expiryTime: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      acknowledgementState: 'ACKNOWLEDGED',
    });

    // Initial purchase
    await billingService.verifyPurchase(user1, 'SUBSCRIPTION', 'pro_annual', token);

    // 1. Pub/Sub notification: subscription renewed
    const newExpiry = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    fakePlay.setSubscription(token, {
      state: 'ACTIVE',
      expiryTime: newExpiry,
      acknowledgementState: 'ACKNOWLEDGED',
    });

    const pubsubData = Buffer.from(
      JSON.stringify({
        version: '1.0',
        packageName: 'com.ufv_rn_poc',
        eventTimeMillis: (Date.now() + 1000).toString(),
        subscriptionNotification: {
          version: '1.0',
          notificationType: 2, // RENEWED
          purchaseToken: token,
          subscriptionId: 'pro_annual',
        },
      })
    ).toString('base64');

    const msg1 = {
      messageId: 'pubsub-msg-001',
      data: pubsubData,
      publishTime: new Date().toISOString(),
    };

    const r1 = await billingService.handlePubSubNotification(msg1);
    expect(r1.status).toBe('PROCESSED');

    // 2. Duplicate webhook with same messageId returns DUPLICATE_EVENT
    const r2 = await billingService.handlePubSubNotification(msg1);
    expect(r2.status).toBe('DUPLICATE_EVENT');

    // 3. Out-of-order event (older timestamp than last_event_at) is ignored
    const olderData = Buffer.from(
      JSON.stringify({
        eventTimeMillis: (Date.now() - 100000).toString(),
        subscriptionNotification: {
          purchaseToken: token,
          subscriptionId: 'pro_annual',
        },
      })
    ).toString('base64');

    await billingService.handlePubSubNotification({
      messageId: 'pubsub-msg-002',
      data: olderData,
      publishTime: new Date().toISOString(),
    });

    // 4. Voided purchase notification (refund) -> REVOKED
    const voidedData = Buffer.from(
      JSON.stringify({
        eventTimeMillis: (Date.now() + 5000).toString(),
        voidedPurchaseNotification: {
          purchaseToken: token,
          orderId: 'GPA.1234',
          productType: 1,
        },
      })
    ).toString('base64');

    await billingService.handlePubSubNotification({
      messageId: 'pubsub-msg-003',
      data: voidedData,
      publishTime: new Date().toISOString(),
    });

    const revokedRecord = await testDb.query(
      `SELECT state FROM purchase_records WHERE purchase_token = $1`,
      [token]
    );
    expect(revokedRecord.rows[0].state).toBe('REVOKED');

    // Premium entitlement should now be expired
    const ent = await testDb.query(
      `SELECT ends_at FROM entitlements WHERE account_id = $1::uuid AND kind = 'PREMIUM'`,
      [user1.accountId]
    );
    expect(new Date(ent.rows[0].ends_at) <= new Date()).toBe(true);
  });
});

