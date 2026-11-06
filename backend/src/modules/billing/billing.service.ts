import { PoolClient } from 'pg';
import { Database } from '../../db/pool';
import { PlayClient } from './play-client';
import { AppError, ErrorCodes } from '../../shared/errors';
import { PurchaseKind, PurchaseState, UserContext } from '../../shared/types';
import { getServerTime } from '../../shared/time';
import { logger } from '../../shared/logger';

const LIFETIME_DATE = new Date('9999-12-31T23:59:59.999Z');
const PACKAGE_NAME = 'com.ufv_rn_poc';

export class BillingService {
  constructor(
    private db: Database,
    private playClient: PlayClient
  ) {}

  /**
   * Check if a purchase state grants Premium access
   */
  private grantsAccess(kind: PurchaseKind, state: PurchaseState, expiresAt: Date): boolean {
    if (kind === 'ONE_TIME') {
      return state === 'ACTIVE';
    }
    // Subscriptions: ACTIVE, CANCELED (until expiry), IN_GRACE_PERIOD
    if (state === 'ACTIVE' || state === 'IN_GRACE_PERIOD') {
      return true;
    }
    if (state === 'CANCELED') {
      return expiresAt.getTime() > Date.now();
    }
    return false;
  }

  /**
   * Helper: Recompute highest ends_at for PREMIUM entitlement across all purchase records of an account
   */
  private async recomputePremiumEntitlement(client: PoolClient, accountId: string): Promise<Date | null> {
    const res = await client.query(
      `SELECT kind, state, expires_at FROM purchase_records WHERE account_id = $1::uuid`,
      [accountId]
    );

    let maxEndsAt: Date | null = null;

    for (const p of res.rows) {
      if (this.grantsAccess(p.kind, p.state, p.expires_at)) {
        if (!maxEndsAt || p.expires_at > maxEndsAt) {
          maxEndsAt = p.expires_at;
        }
      }
    }

    if (maxEndsAt && maxEndsAt.getTime() > Date.now()) {
      await client.query(
        `INSERT INTO entitlements (account_id, kind, ends_at, source)
         VALUES ($1::uuid, 'PREMIUM', $2, 'PURCHASE')
         ON CONFLICT (account_id, kind)
         DO UPDATE SET ends_at = EXCLUDED.ends_at, updated_at = NOW()`,
        [accountId, maxEndsAt]
      );
      return maxEndsAt;
    } else {
      // Remove or expire PREMIUM entitlement
      await client.query(
        `UPDATE entitlements SET ends_at = NOW(), updated_at = NOW()
         WHERE account_id = $1::uuid AND kind = 'PREMIUM'`,
        [accountId]
      );
      return null;
    }
  }

  /**
   * POST /billing/verify: Verify purchase with Play, upsert record, acknowledge and compute entitlement
   */
  async verifyPurchase(
    user: UserContext,
    kind: PurchaseKind,
    productId: string,
    purchaseToken: string
  ) {
    return this.db.withTransaction(async (client) => {
      // 1. Check existing ownership
      const existing = await client.query(
        `SELECT p.account_id, a.kind as account_kind
         FROM purchase_records p
         JOIN accounts a ON p.account_id = a.id
         WHERE p.purchase_token = $1`,
        [purchaseToken]
      );

      if (existing.rows.length > 0) {
        const owner = existing.rows[0];
        if (owner.account_id !== user.accountId) {
          if (owner.account_kind === 'REGISTERED') {
            throw new AppError(
              409,
              ErrorCodes.PURCHASE_ALREADY_LINKED,
              'This purchase is already linked to a registered account'
            );
          } else {
            // Re-link from orphaned GUEST account to current user
            logger.info(
              { purchaseToken, from: owner.account_id, to: user.accountId },
              'Re-linking purchase from guest to current user'
            );
          }
        }
      }

      // 2. Fetch fresh state from Google Play API
      let state: PurchaseState;
      let expiresAt: Date;
      let acknowledged = false;

      if (kind === 'SUBSCRIPTION') {
        const sub = await this.playClient.getSubscription(PACKAGE_NAME, productId, purchaseToken);
        state = sub.state;
        expiresAt = sub.expiryTime;
        acknowledged = sub.acknowledgementState === 'ACKNOWLEDGED';
      } else {
        const prod = await this.playClient.getProduct(PACKAGE_NAME, productId, purchaseToken);
        state = prod.purchaseState === 'PURCHASED' ? 'ACTIVE' : prod.purchaseState === 'PENDING' ? 'PENDING' : 'REVOKED';
        expiresAt = LIFETIME_DATE;
        acknowledged = prod.acknowledgementState === 'ACKNOWLEDGED';
      }

      // 3. Upsert purchase_records
      await client.query(
        `INSERT INTO purchase_records 
          (account_id, purchase_token, product_id, kind, state, expires_at, acknowledged, last_event_at)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (purchase_token)
         DO UPDATE SET
           account_id = EXCLUDED.account_id,
           product_id = EXCLUDED.product_id,
           state = EXCLUDED.state,
           expires_at = EXCLUDED.expires_at,
           acknowledged = purchase_records.acknowledged OR EXCLUDED.acknowledged,
           last_event_at = NOW(),
           updated_at = NOW()`,
        [user.accountId, purchaseToken, productId, kind, state, expiresAt, acknowledged]
      );

      // 4. Acknowledge with Google Play if unacknowledged
      if (!acknowledged) {
        try {
          if (kind === 'SUBSCRIPTION') {
            await this.playClient.acknowledgeSubscription(PACKAGE_NAME, productId, purchaseToken);
          } else {
            await this.playClient.acknowledgeProduct(PACKAGE_NAME, productId, purchaseToken);
          }
          await client.query(
            `UPDATE purchase_records SET acknowledged = TRUE WHERE purchase_token = $1`,
            [purchaseToken]
          );
          acknowledged = true;
        } catch (ackErr) {
          logger.warn({ ackErr, purchaseToken }, 'Immediate Google Play acknowledge failed; queued for background retry');
        }
      }

      // 5. Recompute PREMIUM entitlement
      const premiumEndsAt = await this.recomputePremiumEntitlement(client, user.accountId);

      return {
        success: true,
        productId,
        kind,
        state,
        acknowledged,
        premium: {
          active: Boolean(premiumEndsAt),
          endsAt: premiumEndsAt ? premiumEndsAt.toISOString() : null,
        },
        serverTime: getServerTime(),
      };
    });
  }

  /**
   * POST /billing/restore: Restore multiple purchases
   */
  async restorePurchases(
    user: UserContext,
    purchases: Array<{ kind: PurchaseKind; productId: string; purchaseToken: string }>
  ) {
    const results: any[] = [];
    for (const p of purchases) {
      try {
        const verified = await this.verifyPurchase(user, p.kind, p.productId, p.purchaseToken);
        results.push(verified);
      } catch (err: any) {
        results.push({
          productId: p.productId,
          purchaseToken: p.purchaseToken,
          success: false,
          error: err.code || 'VERIFICATION_FAILED',
        });
      }
    }

    return {
      results,
      serverTime: getServerTime(),
    };
  }

  /**
   * POST /webhooks/google-play (Pub/Sub push event handler)
   */
  async handlePubSubNotification(message: { data: string; messageId: string; publishTime: string }) {
    const { data, messageId } = message;

    // Dedupe on Pub/Sub messageId
    const existing = await this.db.query(
      `SELECT id FROM processed_events WHERE event_id = $1`,
      [messageId]
    );
    if (existing.rows.length > 0) {
      return { status: 'DUPLICATE_EVENT' };
    }

    let payload: any;
    try {
      const decoded = Buffer.from(data, 'base64').toString('utf8');
      payload = JSON.parse(decoded);
    } catch {
      logger.warn({ messageId }, 'Invalid Google Play Pub/Sub JSON payload');
      return { status: 'INVALID_DATA' };
    }

    await this.db.withTransaction(async (client) => {
      // Record processed event
      await client.query(
        `INSERT INTO processed_events (event_id, source) VALUES ($1, 'GOOGLE_PLAY')
         ON CONFLICT (event_id) DO NOTHING`,
        [messageId]
      );

      const eventTimeMs = payload.eventTimeMillis ? parseInt(payload.eventTimeMillis, 10) : Date.now();
      const eventTime = new Date(eventTimeMs);

      // Handle subscription notification
      if (payload.subscriptionNotification) {
        const token = payload.subscriptionNotification.purchaseToken;
        const subId = payload.subscriptionNotification.subscriptionId;

        const recordRes = await client.query(
          `SELECT account_id, last_event_at FROM purchase_records WHERE purchase_token = $1`,
          [token]
        );

        if (recordRes.rows.length === 0) {
          // Unknown token: return 200 so Pub/Sub doesn't loop
          return;
        }

        const record = recordRes.rows[0];
        if (new Date(record.last_event_at) > eventTime) {
          // Ignore older out-of-order events
          logger.info({ token, messageId }, 'Ignoring out-of-order Pub/Sub event');
          return;
        }

        // Re-fetch fresh state from Play instead of trusting notification type!
        const fresh = await this.playClient.getSubscription(PACKAGE_NAME, subId, token);

        await client.query(
          `UPDATE purchase_records
           SET state = $1, expires_at = $2, last_event_at = $3, updated_at = NOW()
           WHERE purchase_token = $4`,
          [fresh.state, fresh.expiryTime, eventTime, token]
        );

        await this.recomputePremiumEntitlement(client, record.account_id);
      }

      // Handle voided purchase notification (refund / cancellation)
      if (payload.voidedPurchaseNotification) {
        const token = payload.voidedPurchaseNotification.purchaseToken;
        const recordRes = await client.query(
          `SELECT account_id FROM purchase_records WHERE purchase_token = $1`,
          [token]
        );

        if (recordRes.rows.length > 0) {
          await client.query(
            `UPDATE purchase_records SET state = 'REVOKED', updated_at = NOW() WHERE purchase_token = $1`,
            [token]
          );
          await this.recomputePremiumEntitlement(client, recordRes.rows[0].account_id);
        }
      }
    });

    return { status: 'PROCESSED' };
  }
}

