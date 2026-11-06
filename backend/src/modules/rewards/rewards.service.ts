import { Database } from '../../db/pool';
import { RemoteConfigService } from '../../config/remote-config';
import { AdMobSsvVerifier } from './admob-ssv';
import { AppError, ErrorCodes } from '../../shared/errors';
import { getServerTime, getIndiaDayBucket } from '../../shared/time';
import { UserContext } from '../../shared/types';
import { logger } from '../../shared/logger';

export class RewardsService {
  constructor(
    private db: Database,
    private configService: RemoteConfigService,
    private ssvVerifier: AdMobSsvVerifier
  ) {}

  /**
   * POST /v1/rewards/claims: Start a new reward claim under row lock
   */
  async createClaim(user: UserContext) {
    const cfg = await this.configService.get(this.db.getPool());

    if (cfg.killSwitches.rewardedAds) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Rewarded ads are currently disabled');
    }

    const dayBucket = getIndiaDayBucket();
    const claimTtlMs = cfg.claimTtlSeconds * 1000;
    const expiresAt = new Date(Date.now() + claimTtlMs);

    return this.db.withTransaction(async (client) => {
      // 1. Lock credit account row
      await client.query(
        `SELECT balance FROM credit_accounts WHERE account_id = $1::uuid FOR UPDATE`,
        [user.accountId]
      );

      // 2. Expire stale started claims
      await client.query(
        `UPDATE reward_claims
         SET status = 'EXPIRED', updated_at = NOW()
         WHERE account_id = $1::uuid AND status = 'STARTED' AND expires_at < NOW()`,
        [user.accountId]
      );

      // 3. Count today's CREDITED + unexpired STARTED claims
      const countRes = await client.query(
        `SELECT COUNT(*) as count
         FROM reward_claims
         WHERE account_id = $1::uuid
           AND day_bucket = $2
           AND (status = 'CREDITED' OR (status = 'STARTED' AND expires_at >= NOW()))`,
        [user.accountId, dayBucket]
      );

      const activeTodayCount = parseInt(countRes.rows[0]?.count || '0', 10);
      if (activeTodayCount >= cfg.dailyLimit) {
        throw new AppError(
          429,
          ErrorCodes.DAILY_LIMIT_REACHED,
          `Daily reward limit of ${cfg.dailyLimit} completed/pending ads reached for today`
        );
      }

      // 4. Create STARTED claim
      const claimIdRes = await client.query(`SELECT gen_random_uuid() as id`);
      const claimId = claimIdRes.rows[0].id;

      // customData encapsulates claimId and userId
      const customData = JSON.stringify({ claimId, userId: user.accountId });

      await client.query(
        `INSERT INTO reward_claims (id, account_id, status, day_bucket, custom_data, expires_at)
         VALUES ($1::uuid, $2::uuid, 'STARTED', $3, $4, $5)`,
        [claimId, user.accountId, dayBucket, customData, expiresAt]
      );

      return {
        claimId,
        userId: user.accountId,
        customData,
        expiresAt: expiresAt.toISOString(),
        serverTime: getServerTime(),
      };
    });
  }

  /**
   * GET /v1/rewards/claims/:id: Poll claim status
   */
  async getClaim(user: UserContext, claimId: string) {
    const res = await this.db.query(
      `SELECT r.id, r.status, r.credits_granted, r.expires_at, c.balance
       FROM reward_claims r
       JOIN credit_accounts c ON r.account_id = c.account_id
       WHERE r.id = $1::uuid AND r.account_id = $2::uuid`,
      [claimId, user.accountId]
    );

    const claim = res.rows[0];
    if (!claim) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, 'Reward claim not found');
    }

    return {
      claimId: claim.id,
      status: claim.status,
      balance: claim.balance,
      creditsGranted: claim.credits_granted || null,
      serverTime: getServerTime(),
    };
  }

  /**
   * GET /v1/webhooks/admob-ssv: Process AdMob Server-Side Verification callback
   */
  async handleAdMobWebhook(queryParams: Record<string, string>, rawUrl: string) {
    const {
      custom_data,
      transaction_id,
      user_id,
      signature,
      key_id,
      timestamp,
    } = queryParams;

    if (!transaction_id || !signature || !key_id || !user_id || !custom_data) {
      throw new AppError(400, ErrorCodes.BAD_REQUEST, 'Missing required SSV query parameters');
    }

    // 1. Extract raw query string up to &signature=
    const sigIdx = rawUrl.indexOf('&signature=');
    const questionIdx = rawUrl.indexOf('?');
    const rawContentToVerify =
      sigIdx !== -1 && questionIdx !== -1
        ? rawUrl.substring(questionIdx + 1, sigIdx)
        : rawUrl;

    // 2. Verify signature
    const isValid = await this.ssvVerifier.verifySignature(
      rawContentToVerify,
      key_id,
      signature
    );

    if (!isValid) {
      logger.warn({ key_id, transaction_id }, 'AdMob SSV signature verification failed');
      throw new AppError(400, ErrorCodes.INVALID_SIGNATURE, 'Invalid AdMob SSV signature');
    }

    // 3. Stale timestamp check (reject if older than 24h)
    if (timestamp) {
      const tsMs = parseInt(timestamp, 10);
      if (!isNaN(tsMs) && Date.now() - tsMs > 24 * 60 * 60 * 1000) {
        throw new AppError(400, ErrorCodes.BAD_REQUEST, 'Stale timestamp on reward callback');
      }
    }

    // 4. Parse customData
    let parsed: any;
    try {
      parsed = JSON.parse(custom_data);
    } catch {
      throw new AppError(400, ErrorCodes.BAD_REQUEST, 'Malformed custom_data');
    }

    if (parsed.userId && parsed.userId !== user_id) {
      throw new AppError(400, ErrorCodes.BAD_REQUEST, 'User ID mismatch in custom_data');
    }
    const parsedClaimId: string = parsed.claimId;

    const cfg = await this.configService.get(this.db.getPool());
    const creditAmount = cfg.creditsPerReward; // Credits come from CONFIG, never from callback!

    return this.db.withTransaction(async (client) => {
      // 5. Deduplication on transaction_id
      const existingTxn = await client.query(
        `SELECT id FROM reward_claims WHERE provider_txn_id = $1`,
        [transaction_id]
      );
      if (existingTxn.rows.length > 0) {
        logger.info({ transaction_id }, 'Duplicate AdMob SSV callback received; returning 200 without crediting');
        return { status: 'DUPLICATE_ACKNOWLEDGED' };
      }

      // 6. Look up claim
      const claimRes = await client.query(
        `SELECT r.id, r.account_id, r.status, r.day_bucket, a.status as account_status, a.merged_into
         FROM reward_claims r
         JOIN accounts a ON r.account_id = a.id
         WHERE r.id = $1::uuid AND r.account_id = $2::uuid`,
        [parsedClaimId, user_id]
      );

      const claim = claimRes.rows[0];
      if (!claim) {
        throw new AppError(404, ErrorCodes.NOT_FOUND, 'Reward claim not found for custom_data');
      }

      if (claim.status === 'CREDITED') {
        return { status: 'ALREADY_CREDITED' };
      }

      // If claim was EXPIRED: credit only if today's credited count is under cap
      if (claim.status === 'EXPIRED') {
        const todayCreditedRes = await client.query(
          `SELECT COUNT(*) as count FROM reward_claims 
           WHERE account_id = $1::uuid AND day_bucket = $2 AND status = 'CREDITED'`,
          [claim.account_id, getIndiaDayBucket()]
        );
        const todayCredited = parseInt(todayCreditedRes.rows[0]?.count || '0', 10);
        if (todayCredited >= cfg.dailyLimit) {
          logger.warn({ claimId: parsedClaimId }, 'Late callback on EXPIRED claim rejected due to daily cap');
          await client.query(
            `UPDATE reward_claims SET status = 'REJECTED', provider_txn_id = $1, updated_at = NOW() WHERE id = $2::uuid`,
            [transaction_id, parsedClaimId]
          );
          return { status: 'CAP_EXCEEDED_REJECTED' };
        }
      }

      // 7. Route to merged account if guest was merged
      const targetAccountId =
        claim.account_status === 'MERGED' && claim.merged_into
          ? claim.merged_into
          : claim.account_id;

      // 8. Lock target credit account
      const acc = await client.query(
        `SELECT balance FROM credit_accounts WHERE account_id = $1::uuid FOR UPDATE`,
        [targetAccountId]
      );
      const currentBalance = acc.rows[0]?.balance ?? 0;
      const newBalance = currentBalance + creditAmount;

      // 9. Update credit_accounts balance
      await client.query(
        `UPDATE credit_accounts SET balance = $1, version = version + 1 WHERE account_id = $2::uuid`,
        [newBalance, targetAccountId]
      );

      // 10. Insert credit_ledger_entries (idempotency_key = reward:<claimId>)
      const ledgerKey = `reward:${parsedClaimId}`;
      await client.query(
        `INSERT INTO credit_ledger_entries (account_id, idempotency_key, type, amount, balance_after, reference)
         VALUES ($1::uuid, $2, 'EARN_REWARD', $3, $4, $5)`,
        [
          targetAccountId,
          ledgerKey,
          creditAmount,
          newBalance,
          `AdMob Rewarded Ad (${transaction_id})`,
        ]
      );

      // 11. Mark claim CREDITED
      await client.query(
        `UPDATE reward_claims 
         SET status = 'CREDITED', provider_txn_id = $1, credits_granted = $2, updated_at = NOW()
         WHERE id = $3::uuid`,
        [transaction_id, creditAmount, parsedClaimId]
      );

      return {
        status: 'SUCCESS',
        claimId: parsedClaimId,
        creditedAccountId: targetAccountId,
        creditsGranted: creditAmount,
        newBalance,
      };
    });
  }
}
