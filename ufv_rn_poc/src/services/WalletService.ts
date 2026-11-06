import { MMKV } from './MMKV';

export interface LedgerEntry {
  id: string;
  type: 'EARNED_REWARD' | 'REDEEMED_PASS' | 'WELCOME_BONUS';
  amount: number;
  timestamp: number;
  description: string;
}

export type AdFreeTier = '1_HOUR' | '24_HOURS' | '7_DAYS';

export interface TierConfig {
  id: AdFreeTier;
  label: string;
  durationLabel: string;
  cost: number;
  durationMs: number;
  tag?: string;
}

export const AD_FREE_TIERS: Record<AdFreeTier, TierConfig> = {
  '1_HOUR': {
    id: '1_HOUR',
    label: '1 Hour Ad-Free',
    durationLabel: '1 Hour',
    cost: 20,
    durationMs: 1 * 60 * 60 * 1000,
  },
  '24_HOURS': {
    id: '24_HOURS',
    label: '24 Hours Ad-Free',
    durationLabel: '24 Hours',
    cost: 60,
    durationMs: 24 * 60 * 60 * 1000,
    tag: 'MOST POPULAR',
  },
  '7_DAYS': {
    id: '7_DAYS',
    label: '7 Days Ad-Free',
    durationLabel: '7 Days',
    cost: 300,
    durationMs: 7 * 24 * 60 * 60 * 1000,
    tag: 'BEST VALUE',
  },
};

export interface WalletState {
  balance: number;
  dailyAdsCount: number;
  lastAdDate: string; // YYYY-MM-DD
  adFreeUntil: number | null; // epoch timestamp ms
  history: LedgerEntry[];
}

const WALLET_STORAGE_KEY = 'ufv_wallet_state_v1';
const REWARD_AMOUNT_PER_AD = 10;
const AD_FREE_PASS_COST = 50;
const DAILY_REWARDED_AD_LIMIT = 5;
const PASS_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

export class WalletService {
  private static instance: WalletService;

  static getInstance(): WalletService {
    if (!WalletService.instance) {
      WalletService.instance = new WalletService();
    }
    return WalletService.instance;
  }

  private getTodayString(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  public getState(): WalletState {
    try {
      const raw = MMKV.getString(WALLET_STORAGE_KEY);
      if (raw) {
        const parsed: WalletState = JSON.parse(raw);
        // Reset daily ad count if new day
        const today = this.getTodayString();
        if (parsed.lastAdDate !== today) {
          parsed.dailyAdsCount = 0;
          parsed.lastAdDate = today;
          this.saveState(parsed);
        }
        return parsed;
      }
    } catch (err) {
      console.warn('WalletService.getState parse error', err);
    }

    // Default initial state with 10 welcome credits (Master PRD Sec 9.2)
    const initial: WalletState = {
      balance: 10,
      dailyAdsCount: 0,
      lastAdDate: this.getTodayString(),
      adFreeUntil: null,
      history: [
        {
          id: 'welcome_1',
          type: 'WELCOME_BONUS',
          amount: 10,
          timestamp: Date.now(),
          description: 'Welcome Bonus Credits',
        },
      ],
    };
    this.saveState(initial);
    return initial;
  }

  private saveState(state: WalletState): void {
    try {
      MMKV.set(WALLET_STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('WalletService.saveState error', err);
    }
  }

  public getBalance(): number {
    return this.getState().balance;
  }

  public isAdFreeActive(): boolean {
    const state = this.getState();
    if (!state.adFreeUntil) return false;
    return state.adFreeUntil > Date.now();
  }

  public getAdFreeRemainingHours(): number {
    const state = this.getState();
    if (!state.adFreeUntil || state.adFreeUntil <= Date.now()) return 0;
    const diffMs = state.adFreeUntil - Date.now();
    return Math.ceil(diffMs / (1000 * 60 * 60));
  }

  public canWatchRewardedAdToday(): boolean {
    const state = this.getState();
    return state.dailyAdsCount < DAILY_REWARDED_AD_LIMIT;
  }

  public getDailyAdsRemaining(): number {
    const state = this.getState();
    return Math.max(0, DAILY_REWARDED_AD_LIMIT - state.dailyAdsCount);
  }

  /**
   * Verified rewarded ad completion callback
   * Grants +10 credits (Master PRD Sec 9.2)
   */
  public awardRewardedAdCredit(): { success: boolean; newBalance: number; error?: string } {
    const state = this.getState();
    if (state.dailyAdsCount >= DAILY_REWARDED_AD_LIMIT) {
      return {
        success: false,
        newBalance: state.balance,
        error: `Daily limit of ${DAILY_REWARDED_AD_LIMIT} rewarded ads reached. Come back tomorrow!`,
      };
    }

    state.balance += REWARD_AMOUNT_PER_AD;
    state.dailyAdsCount += 1;
    state.lastAdDate = this.getTodayString();
    state.history.unshift({
      id: `reward_${Date.now()}`,
      type: 'EARNED_REWARD',
      amount: REWARD_AMOUNT_PER_AD,
      timestamp: Date.now(),
      description: 'Watched Rewarded Video Ad',
    });

    // Keep max 50 ledger items
    if (state.history.length > 50) {
      state.history = state.history.slice(0, 50);
    }

    this.saveState(state);
    return { success: true, newBalance: state.balance };
  }

  /**
   * Redeem 50 credits for 24 hours of Ad-Free Pass (Master PRD Sec 9.1 & 9.2)
   */
  public redeemAdFreePass(): { success: boolean; message: string } {
    const state = this.getState();
    if (state.balance < AD_FREE_PASS_COST) {
      return {
        success: false,
        message: `Insufficient credits. You need ${AD_FREE_PASS_COST} credits (Current: ${state.balance}).`,
      };
    }

    state.balance -= AD_FREE_PASS_COST;
    const baseTime = state.adFreeUntil && state.adFreeUntil > Date.now()
      ? state.adFreeUntil
      : Date.now();
    state.adFreeUntil = baseTime + PASS_DURATION_MS;

    state.history.unshift({
      id: `redeem_${Date.now()}`,
      type: 'REDEEMED_PASS',
      amount: -AD_FREE_PASS_COST,
      timestamp: Date.now(),
      description: 'Activated 24-Hour Ad-Free Pass',
    });

    if (state.history.length > 50) {
      state.history = state.history.slice(0, 50);
    }

    this.saveState(state);
    return {
      success: true,
      message: '🎉 24-Hour Ad-Free Pass activated! All advertisements suppressed.',
    };
  }

  /**
   * Redeem custom Figma Ad-Free tier (20 coins = 1h, 60 coins = 24h, 300 coins = 7d)
   */
  public redeemTier(tierKey: AdFreeTier): { success: boolean; message: string } {
    const tier = AD_FREE_TIERS[tierKey];
    if (!tier) {
      return { success: false, message: 'Invalid redemption tier.' };
    }

    const state = this.getState();
    if (state.balance < tier.cost) {
      return {
        success: false,
        message: `Insufficient coins. You need ${tier.cost} coins (Current: ${state.balance}).`,
      };
    }

    state.balance -= tier.cost;
    const baseTime = state.adFreeUntil && state.adFreeUntil > Date.now()
      ? state.adFreeUntil
      : Date.now();
    state.adFreeUntil = baseTime + tier.durationMs;

    state.history.unshift({
      id: `redeem_${Date.now()}`,
      type: 'REDEEMED_PASS',
      amount: -tier.cost,
      timestamp: Date.now(),
      description: `Activated ${tier.label}`,
    });

    if (state.history.length > 50) {
      state.history = state.history.slice(0, 50);
    }

    this.saveState(state);
    return {
      success: true,
      message: `🎉 ${tier.label} activated! All advertisements suppressed.`,
    };
  }
}

