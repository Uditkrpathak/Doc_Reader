import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as crypto from 'crypto';
import { createTestDb, ITestDb } from '../helpers/test-db';
import { Database } from '../../src/db/pool';
import { RemoteConfigService } from '../../src/config/remote-config';
import { AdMobSsvVerifier } from '../../src/modules/rewards/admob-ssv';
import { RewardsService } from '../../src/modules/rewards/rewards.service';
import { UserContext } from '../../src/shared/types';
import { getIndiaDayBucket } from '../../src/shared/time';

describe('Rewarded Ads & AdMob SSV Tests', () => {
  let testDb: ITestDb;
  let rewardsService: RewardsService;
  let ssvVerifier: AdMobSsvVerifier;
  let testUser: UserContext;

  // Generate test EC P-256 keypair for signing SSV callbacks
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const testKeyId = '999999';

  beforeEach(async () => {
    testDb = await createTestDb();
    await testDb.reset();

    const db = new Database({ connectionString: 'postgres://test' });
    (db as any).pool = testDb;
    (db as any).query = (text: string, params?: any[]) => testDb.query(text, params);
    (db as any).getClient = () => testDb.getClient();
    (db as any).withTransaction = (cb: any) => testDb.withTransaction(cb);

    const configService = new RemoteConfigService();
    ssvVerifier = new AdMobSsvVerifier();
    ssvVerifier.setTestKey(testKeyId, publicKey);

    rewardsService = new RewardsService(db, configService, ssvVerifier);

    // Create test registered account with 0 credits
    const acc = await testDb.query(
      `INSERT INTO accounts (kind, status, email) VALUES ('REGISTERED', 'ACTIVE', 'ssv-test@example.com') RETURNING id`
    );
    const accountId = acc.rows[0].id;

    await testDb.query(
      `INSERT INTO credit_accounts (account_id, balance) VALUES ($1::uuid, 0)`,
      [accountId]
    );

    testUser = {
      accountId,
      kind: 'REGISTERED',
      email: 'ssv-test@example.com',
    };
  });

  afterAll(async () => {
    if (testDb) await testDb.close();
  });

  // Helper to generate a signed AdMob SSV query string
  function generateSignedSsvUrl(params: Record<string, string>): {
    params: Record<string, string>;
    rawUrl: string;
  } {
    const queryParts = Object.entries(params)
      .filter(([k]) => k !== 'signature')
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');

    const signer = crypto.createSign('SHA256');
    signer.update(queryParts);
    signer.end();
    const signatureDer = signer.sign(privateKey);
    const signatureBase64 = signatureDer.toString('base64');

    const fullParams = { ...params, signature: signatureBase64 };
    const rawUrl = `/v1/webhooks/admob-ssv?${queryParts}&signature=${encodeURIComponent(signatureBase64)}`;

    return { params: fullParams, rawUrl };
  }

  it('10 parallel claim creations at cap 5: exactly 5 succeed, 5 rejected with DAILY_LIMIT_REACHED', async () => {
    const promises = Array.from({ length: 10 }, () =>
      rewardsService
        .createClaim(testUser)
        .then(() => ({ success: true }))
        .catch((err) => ({ success: false, code: err.code }))
    );

    const results = await Promise.all(promises);

    const successCount = results.filter((r) => r.success).length;
    const failedCount = results.filter((r) => !r.success).length;

    expect(successCount).toBe(5);
    expect(failedCount).toBe(5);

    // Exactly 5 claims in database
    const claims = await testDb.query(
      `SELECT COUNT(*) as count FROM reward_claims WHERE account_id = $1::uuid`,
      [testUser.accountId]
    );
    expect(parseInt(claims.rows[0].count, 10)).toBe(5);
  });

  it('SSV: valid signature credits once, duplicate returns 200 without extra credit', async () => {
    // 1. Create a claim
    const claim = await rewardsService.createClaim(testUser);

    // 2. Prepare signed SSV callback
    const baseParams = {
      ad_network: '5450213213286189855',
      ad_unit: '1234567890',
      custom_data: claim.customData,
      reward_amount: '1', // Client sends 1, but server uses CONFIG (10)
      reward_item: 'coins',
      timestamp: Date.now().toString(),
      transaction_id: 'txn-admob-unique-001',
      user_id: testUser.accountId,
      key_id: testKeyId,
    };

    const { params, rawUrl } = generateSignedSsvUrl(baseParams);

    // 3. Process webhook
    const res1 = await rewardsService.handleAdMobWebhook(params, rawUrl);
    expect(res1.status).toBe('SUCCESS');
    expect(res1.creditsGranted).toBe(10); // From config, NOT from reward_amount

    // Verify balance is 10
    const acc1 = await testDb.query(
      `SELECT balance FROM credit_accounts WHERE account_id = $1::uuid`,
      [testUser.accountId]
    );
    expect(acc1.rows[0].balance).toBe(10);

    // 4. Same callback twice: returns 200 without duplicate credit
    const res2 = await rewardsService.handleAdMobWebhook(params, rawUrl);
    expect(res2.status).toBe('DUPLICATE_ACKNOWLEDGED');

    // Balance remains 10
    const acc2 = await testDb.query(
      `SELECT balance FROM credit_accounts WHERE account_id = $1::uuid`,
      [testUser.accountId]
    );
    expect(acc2.rows[0].balance).toBe(10);
  });

  it('SSV: rejects forged signature, tampered query, unknown key, unknown claim, wrong user', async () => {
    const claim = await rewardsService.createClaim(testUser);

    const baseParams = {
      ad_network: '5450213213286189855',
      ad_unit: '1234567890',
      custom_data: claim.customData,
      reward_amount: '1',
      reward_item: 'coins',
      timestamp: Date.now().toString(),
      transaction_id: 'txn-admob-test-errors',
      user_id: testUser.accountId,
      key_id: testKeyId,
    };

    const { params, rawUrl } = generateSignedSsvUrl(baseParams);

    // 1. Forged signature
    const forgedParams = { ...params, signature: 'invalidsignaturebase64==' };
    await expect(rewardsService.handleAdMobWebhook(forgedParams, rawUrl)).rejects.toThrow(
      /Invalid AdMob SSV signature/
    );

    // 2. Tampered query parameter (e.g. changed transaction_id after signing in raw query)
    const tamperedUrl = rawUrl.replace('txn-admob-test-errors', 'tampered-txn');
    const tamperedParams = { ...params, transaction_id: 'tampered-txn' };
    await expect(rewardsService.handleAdMobWebhook(tamperedParams, tamperedUrl)).rejects.toThrow(
      /Invalid AdMob SSV signature/
    );

    // 3. Unknown key_id
    const unknownKeyParams = { ...params, key_id: '888888' };
    const { rawUrl: unknownKeyUrl } = generateSignedSsvUrl(unknownKeyParams);
    await expect(rewardsService.handleAdMobWebhook(unknownKeyParams, unknownKeyUrl)).rejects.toThrow(
      /Invalid AdMob SSV signature/
    );

    // 4. Unknown claim
    const unknownClaimParams = {
      ...baseParams,
      custom_data: JSON.stringify({ claimId: '00000000-0000-0000-0000-000000000000', userId: testUser.accountId }),
      transaction_id: 'txn-unknown-claim',
    };
    const { params: ucParams, rawUrl: ucUrl } = generateSignedSsvUrl(unknownClaimParams);
    await expect(rewardsService.handleAdMobWebhook(ucParams, ucUrl)).rejects.toThrow(
      /Reward claim not found/
    );

    // 5. Wrong user
    const wrongUserParams = {
      ...baseParams,
      user_id: '00000000-0000-0000-0000-111111111111',
      transaction_id: 'txn-wrong-user',
    };
    const { params: wuParams, rawUrl: wuUrl } = generateSignedSsvUrl(wrongUserParams);
    await expect(rewardsService.handleAdMobWebhook(wuParams, wuUrl)).rejects.toThrow(
      /User ID mismatch/
    );
  });

  it('SSV: late callback on an EXPIRED claim respects the daily cap', async () => {
    // 1. Create a claim and artificially expire it
    const claim = await rewardsService.createClaim(testUser);
    await testDb.query(
      `UPDATE reward_claims SET status = 'EXPIRED' WHERE id = $1::uuid`,
      [claim.claimId]
    );

    // 2. Artificially fill today's daily cap with 5 CREDITED claims
    const dayBucket = getIndiaDayBucket();
    for (let i = 0; i < 5; i++) {
      await testDb.query(
        `INSERT INTO reward_claims (account_id, status, day_bucket, custom_data, provider_txn_id, credits_granted, expires_at)
         VALUES ($1::uuid, 'CREDITED', $2, 'dummy', $3, 10, NOW())`,
        [testUser.accountId, dayBucket, `txn-dummy-${i}`]
      );
    }

    // 3. Late callback for the expired claim
    const baseParams = {
      ad_network: '5450213213286189855',
      ad_unit: '1234567890',
      custom_data: claim.customData,
      reward_amount: '1',
      reward_item: 'coins',
      timestamp: Date.now().toString(),
      transaction_id: 'txn-late-expired-claim',
      user_id: testUser.accountId,
      key_id: testKeyId,
    };
    const { params, rawUrl } = generateSignedSsvUrl(baseParams);

    const res = await rewardsService.handleAdMobWebhook(params, rawUrl);
    expect(res.status).toBe('CAP_EXCEEDED_REJECTED');

    // Balance should still be 0 (no credits awarded for late claim exceeding cap)
    const acc = await testDb.query(
      `SELECT balance FROM credit_accounts WHERE account_id = $1::uuid`,
      [testUser.accountId]
    );
    expect(acc.rows[0].balance).toBe(0);
  });
});
