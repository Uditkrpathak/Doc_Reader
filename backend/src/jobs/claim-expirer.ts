import { Database } from '../db/pool.js';
import { RemoteConfigService } from '../config/remote-config.js';
import { logger } from '../shared/logger.js';

export const CLAIM_EXPIRER_LOCK_ID = 1005;

export class ClaimExpirer {
  constructor(
    private db: Database,
    private remoteConfig?: RemoteConfigService
  ) {}

  async expireStaleClaims(): Promise<number> {
    const locked = await this.db.tryAdvisoryLock(CLAIM_EXPIRER_LOCK_ID);
    if (!locked) {
      return 0;
    }

    try {
      if (this.remoteConfig) {
        await this.remoteConfig.get(this.db as any);
      }
      const res = await this.db.query(
        `UPDATE reward_claims
         SET status = 'EXPIRED', updated_at = NOW()
         WHERE status = 'STARTED'
           AND expires_at < NOW()
         RETURNING id;`
      );

      const count = res.rows.length;
      if (count > 0) {
        logger.info({ expiredCount: count }, 'Expired stale started reward claims');
      }
      return count;
    } finally {
      await this.db.releaseAdvisoryLock(CLAIM_EXPIRER_LOCK_ID);
    }
  }
}
