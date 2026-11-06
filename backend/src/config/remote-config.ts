import { Pool, PoolClient } from 'pg';
import { logger } from '../shared/logger';

export interface AdFreeTierConfig {
  durationHours: number;
  cost: number;
  label: string;
}

export interface RemoteConfigValues {
  creditsPerReward: number;
  dailyLimit: number;
  claimTtlSeconds: number;
  adFreeTiers: Record<string, AdFreeTierConfig>;
  killSwitches: {
    rewardedAds: boolean;
    signups: boolean;
    firstPartyAds: boolean;
  };
  allowRedeemWhilePremium: boolean;
  firstPartyAdComplaintThreshold: number;
  minAppVersion: string;
}

export const CODE_DEFAULTS: RemoteConfigValues = {
  creditsPerReward: 10,
  dailyLimit: 5,
  claimTtlSeconds: 600,
  adFreeTiers: {
    h1: { durationHours: 1, cost: 20, label: '1 Hour Ad-Free' },
    h24: { durationHours: 24, cost: 60, label: '24 Hours Ad-Free' },
    d7: { durationHours: 168, cost: 300, label: '7 Days Ad-Free' },
  },
  killSwitches: {
    rewardedAds: false,
    signups: false,
    firstPartyAds: false,
  },
  allowRedeemWhilePremium: false,
  firstPartyAdComplaintThreshold: 10,
  minAppVersion: '1.0.0',
};

export class RemoteConfigService {
  private cache: RemoteConfigValues = { ...CODE_DEFAULTS };
  private lastFetchedAt: number = 0;
  private readonly ttlMs = 30000; // 30s cache

  async get(db?: Pool | PoolClient): Promise<RemoteConfigValues> {
    const now = Date.now();
    if (db && now - this.lastFetchedAt > this.ttlMs) {
      await this.refresh(db);
    }
    return this.cache;
  }

  async getAll(db?: Pool | PoolClient): Promise<RemoteConfigValues> {
    return this.get(db);
  }

  async refresh(db: Pool | PoolClient): Promise<RemoteConfigValues> {
    try {
      const res = await db.query(`SELECT key, value FROM remote_config`);
      const updated: any = { ...CODE_DEFAULTS };

      for (const row of res.rows) {
        if (row.key in updated) {
          updated[row.key] = row.value;
        }
      }

      this.cache = updated;
      this.lastFetchedAt = Date.now();
    } catch (err) {
      logger.warn({ err }, 'Failed to refresh remote_config from DB; using cached/defaults');
    }
    return this.cache;
  }

  async set(db: Pool | PoolClient, key: keyof RemoteConfigValues, value: any): Promise<void> {
    await db.query(
      `INSERT INTO remote_config (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, JSON.stringify(value)]
    );
    await this.refresh(db);
  }
}
