import { Database } from '../../db/pool';
import { RemoteConfigService } from '../../config/remote-config';
import { JwtService } from '../../shared/jwt';
import { AppError, ErrorCodes } from '../../shared/errors';
import { getServerTime, getIndiaDayBucket, getNextIndiaMidnight } from '../../shared/time';
import { UserContext } from '../../shared/types';

export class WalletService {
  constructor(
    private db: Database,
    private configService: RemoteConfigService,
    private jwt: JwtService
  ) {}

  /**
   * GET /v1/wallet
   */
  async getWallet(user: UserContext) {
    const cfg = await this.configService.get(this.db.getPool());
    const dayBucket = getIndiaDayBucket();

    // Query balance and today's credited rewards count
    const [balanceRes, rewardsRes] = await Promise.all([
      this.db.query(
        `SELECT balance FROM credit_accounts WHERE account_id = $1::uuid`,
        [user.accountId]
      ),
      this.db.query(
        `SELECT COUNT(*) as count 
         FROM reward_claims 
         WHERE account_id = $1::uuid AND day_bucket = $2 AND status = 'CREDITED'`,
        [user.accountId, dayBucket]
      ),
    ]);

    const balance = balanceRes.rows[0]?.balance ?? 0;
    const rewardsToday = parseInt(rewardsRes.rows[0]?.count || '0', 10);
    const nextResetAt = getNextIndiaMidnight().toISOString();

    return {
      balance,
      rewardsToday,
      dailyLimit: cfg.dailyLimit,
      nextResetAt,
      creditsPerReward: cfg.creditsPerReward,
      serverTime: getServerTime(),
    };
  }

  /**
   * GET /v1/wallet/ledger
   */
  async getLedger(user: UserContext, type: 'all' | 'earned' | 'redeemed', cursor?: string, limit: number = 20) {
    let typeClause = '';
    const params: any[] = [user.accountId];

    if (type === 'earned') {
      typeClause = " AND type IN ('EARN_REWARD', 'WELCOME_BONUS', 'ADMIN_ADJUST')";
    } else if (type === 'redeemed') {
      typeClause = " AND type = 'REDEEM_ADFREE'";
    }

    let cursorClause = '';
    if (cursor) {
      try {
        const decoded = Buffer.from(cursor, 'base64').toString('utf8');
        const [cursorCreatedAt, cursorId] = decoded.split('|');
        if (cursorCreatedAt && cursorId) {
          params.push(cursorCreatedAt, cursorId);
          cursorClause = ` AND (created_at, id) < ($${params.length - 1}, $${params.length}::uuid)`;
        }
      } catch {
        // Ignore invalid cursor
      }
    }

    params.push(limit + 1);
    const limitParamIdx = params.length;

    const query = `
      SELECT id, idempotency_key, type, amount, balance_after, reference, created_at
      FROM credit_ledger_entries
      WHERE account_id = $1::uuid ${typeClause} ${cursorClause}
      ORDER BY created_at DESC, id DESC
      LIMIT $${limitParamIdx}
    `;

    const res = await this.db.query(query, params);
    const rows = res.rows;
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1];
      nextCursor = Buffer.from(`${last.created_at.toISOString()}|${last.id}`).toString('base64');
    }

    return {
      items,
      nextCursor,
      serverTime: getServerTime(),
    };
  }

  /**
   * GET /v1/adfree/options
   */
  async getAdFreeOptions(user: UserContext) {
    const cfg = await this.configService.get(this.db.getPool());
    const balanceRes = await this.db.query(
      `SELECT balance FROM credit_accounts WHERE account_id = $1::uuid`,
      [user.accountId]
    );
    const balance = balanceRes.rows[0]?.balance ?? 0;

    const entRes = await this.db.query(
      `SELECT kind, ends_at FROM entitlements WHERE account_id = $1::uuid AND ends_at > NOW()`,
      [user.accountId]
    );

    let activeAdFreeEnd: string | null = null;
    let isPremium = false;

    for (const row of entRes.rows) {
      if (row.kind === 'PREMIUM') {
        isPremium = true;
        activeAdFreeEnd = row.ends_at.toISOString();
      } else if (row.kind === 'ADFREE_CREDIT' && !isPremium) {
        activeAdFreeEnd = row.ends_at.toISOString();
      }
    }

    const tiers = Object.entries(cfg.adFreeTiers).map(([tierId, t]) => ({
      tierId,
      label: t.label,
      durationHours: t.durationHours,
      cost: t.cost,
      canAfford: balance >= t.cost,
    }));

    return {
      balance,
      isPremium,
      activeAdFreeEnd,
      tiers,
      serverTime: getServerTime(),
    };
  }

  /**
   * POST /v1/adfree/redemptions (with Idempotency-Key and row lock)
   */
  async redeemAdFree(user: UserContext, tierId: string, idempotencyKey: string) {
    if (!idempotencyKey) {
      throw new AppError(400, ErrorCodes.IDEMPOTENCY_REQUIRED, 'Idempotency-Key header is required');
    }

    const cfg = await this.configService.get(this.db.getPool());
    const tier = cfg.adFreeTiers[tierId];
    if (!tier) {
      throw new AppError(400, ErrorCodes.BAD_REQUEST, `Invalid tierId: ${tierId}`);
    }

    const ledgerKey = `redeem:${idempotencyKey}`;

    return this.db.withTransaction(async (client) => {
      // 1. Lock account row (SELECT ... FOR UPDATE)
      const acc = await client.query(
        `SELECT balance, version FROM credit_accounts WHERE account_id = $1::uuid FOR UPDATE`,
        [user.accountId]
      );
      if (acc.rows.length === 0) {
        throw new AppError(404, ErrorCodes.NOT_FOUND, 'Credit account not found');
      }

      // 2. Check if this exact idempotency key was already processed
      const existingEntry = await client.query(
        `SELECT id, amount, balance_after, reference FROM credit_ledger_entries 
         WHERE account_id = $1::uuid AND idempotency_key = $2`,
        [user.accountId, ledgerKey]
      );

      if (existingEntry.rows.length > 0) {
        const entry = existingEntry.rows[0];
        // If same tier was redeemed, replay the outcome idempotently
        if (entry.reference === `Redeemed ${tierId} (${tier.label})`) {
          const currentEnt = await client.query(
            `SELECT ends_at, source FROM entitlements WHERE account_id = $1::uuid AND kind = 'ADFREE_CREDIT'`,
            [user.accountId]
          );
          return {
            success: true,
            replayed: true,
            balance: acc.rows[0].balance,
            entitlement: {
              endsAt: currentEnt.rows[0]?.ends_at || null,
              source: 'ADFREE_CREDIT',
            },
            serverTime: getServerTime(),
          };
        } else {
          // Different tier with same key -> 422 Unprocessable Entity
          throw new AppError(
            422,
            ErrorCodes.IDEMPOTENCY_CONFLICT,
            'Idempotency key was previously used with a different redemption tier'
          );
        }
      }

      // 3. Check Premium status
      const premRes = await client.query(
        `SELECT ends_at FROM entitlements WHERE account_id = $1::uuid AND kind = 'PREMIUM' AND ends_at > NOW()`,
        [user.accountId]
      );
      if (premRes.rows.length > 0 && !cfg.allowRedeemWhilePremium) {
        throw new AppError(
          409,
          ErrorCodes.PREMIUM_ACTIVE,
          'Premium is currently active. Ad-free redemption is not needed.'
        );
      }

      // 4. Check balance
      const currentBalance = acc.rows[0].balance;
      if (currentBalance < tier.cost) {
        throw new AppError(
          402,
          ErrorCodes.INSUFFICIENT_CREDITS,
          `Insufficient credits. Required: ${tier.cost}, Available: ${currentBalance}`
        );
      }

      const newBalance = currentBalance - tier.cost;

      // 5. Update credit_accounts balance
      await client.query(
        `UPDATE credit_accounts SET balance = $1, version = version + 1 WHERE account_id = $2::uuid`,
        [newBalance, user.accountId]
      );

      // 6. Insert credit_ledger_entries (negative amount)
      await client.query(
        `INSERT INTO credit_ledger_entries (account_id, idempotency_key, type, amount, balance_after, reference)
         VALUES ($1::uuid, $2, 'REDEEM_ADFREE', $3, $4, $5)`,
        [
          user.accountId,
          ledgerKey,
          -tier.cost,
          newBalance,
          `Redeemed ${tierId} (${tier.label})`,
        ]
      );

      // 7. Extend entitlement: GREATEST(NOW(), current ends_at) + duration
      const durationMs = tier.durationHours * 60 * 60 * 1000;
      const entUpdateRes = await client.query(
        `INSERT INTO entitlements (account_id, kind, ends_at, source)
         VALUES ($1::uuid, 'ADFREE_CREDIT', NOW() + ($2 || ' milliseconds')::interval, 'CREDIT')
         ON CONFLICT (account_id, kind)
         DO UPDATE SET 
           ends_at = GREATEST(NOW(), entitlements.ends_at) + ($2 || ' milliseconds')::interval,
           source = 'CREDIT',
           updated_at = NOW()
         RETURNING ends_at`,
        [user.accountId, durationMs.toString()]
      );

      const endsAt = entUpdateRes.rows[0].ends_at;

      return {
        success: true,
        replayed: false,
        balance: newBalance,
        entitlement: {
          endsAt,
          source: 'ADFREE_CREDIT',
        },
        serverTime: getServerTime(),
      };
    });
  }

  /**
   * GET /v1/entitlements
   */
  async getEntitlements(user: UserContext) {
    const res = await this.db.query(
      `SELECT kind, ends_at, source 
       FROM entitlements 
       WHERE account_id = $1::uuid AND ends_at > NOW()`,
      [user.accountId]
    );

    let adFree = false;
    let source: 'PREMIUM' | 'CREDIT' | null = null;
    let endsAt: Date | null = null;

    for (const row of res.rows) {
      if (row.kind === 'PREMIUM') {
        adFree = true;
        source = 'PREMIUM';
        endsAt = row.ends_at;
        break; // Premium takes precedence
      } else if (row.kind === 'ADFREE_CREDIT') {
        adFree = true;
        source = 'CREDIT';
        endsAt = row.ends_at;
      }
    }

    const serverTime = getServerTime();
    const token = await this.jwt.signOfflineEntitlementToken(
      user.accountId,
      adFree,
      source ? (source as any) : null,
      endsAt,
      serverTime
    );

    return {
      adFree,
      source,
      endsAt: endsAt ? endsAt.toISOString() : null,
      serverTime,
      token,
    };
  }
}

