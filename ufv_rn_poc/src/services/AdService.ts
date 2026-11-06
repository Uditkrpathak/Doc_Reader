import { WalletService } from './WalletService';

export interface SponsorCard {
  id: string;
  sponsorName: string;
  headline: string;
  body: string;
  callToAction: string;
  targetCategory?: string;
  tag: string;
}

const LOCAL_SPONSOR_CARDS: SponsorCard[] = [
  {
    id: 'sponsor_1',
    sponsorName: 'Local Printing & Binding Hub',
    headline: 'Need physical prints of your documents?',
    body: 'High-speed digital printing & spiral binding for college reports & office contracts.',
    callToAction: 'Find Nearby Hub',
    tag: 'SPONSORED',
  },
  {
    id: 'sponsor_2',
    sponsorName: 'Secure Offline File Backup',
    headline: 'Keep your archives safely archived',
    body: 'Encrypted hardware storage drives for your heavy video & presentation files.',
    callToAction: 'Learn More',
    tag: 'FEATURED',
  },
  {
    id: 'sponsor_3',
    sponsorName: 'Office & Student Supplies',
    headline: 'Paper, notebooks, and digital styluses',
    body: 'Flat 15% discount on student essentials with local same-day store pickup.',
    callToAction: 'View Deals',
    tag: 'SPONSORED',
  },
];

export class AdService {
  private static instance: AdService;
  private isOnline: boolean = true;
  private interstitialLastShown: number = 0;
  private readonly INTERSTITIAL_MIN_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes (Master PRD Sec 8.4)

  static getInstance(): AdService {
    if (!AdService.instance) {
      AdService.instance = new AdService();
    }
    return AdService.instance;
  }

  public setOnlineStatus(online: boolean) {
    this.isOnline = online;
  }

  public shouldShowAds(): boolean {
    const wallet = WalletService.getInstance();
    // 1. If Ad-Free Pass is active, suppress all ads
    if (wallet.isAdFreeActive()) {
      return false;
    }
    return true;
  }

  public getRandomSponsorCard(): SponsorCard | null {
    if (!this.shouldShowAds()) return null;
    const idx = Math.floor(Math.random() * LOCAL_SPONSOR_CARDS.length);
    return LOCAL_SPONSOR_CARDS[idx];
  }

  public canShowInterstitial(): boolean {
    if (!this.shouldShowAds()) return false;
    if (!this.isOnline) return false;
    const now = Date.now();
    return now - this.interstitialLastShown > this.INTERSTITIAL_MIN_INTERVAL_MS;
  }

  public markInterstitialShown() {
    this.interstitialLastShown = Date.now();
  }

  /**
   * Rewarded Video Ad playback trigger (Master PRD Sec 8.2 & 9.4)
   * Discloses reward (+10 credits), simulates/handles video playback, and awards credits.
   */
  public async playRewardedAd(
    onProgress: (status: 'LOADING' | 'PLAYING' | 'VERIFYING' | 'COMPLETED' | 'FAILED') => void
  ): Promise<{ success: boolean; newBalance?: number; error?: string }> {
    const wallet = WalletService.getInstance();
    if (!wallet.canWatchRewardedAdToday()) {
      return {
        success: false,
        error: 'Daily limit reached. You can watch up to 5 rewarded ads per day.',
      };
    }

    try {
      onProgress('LOADING');
      await new Promise((r) => setTimeout(r, 600));

      onProgress('PLAYING');
      // In development/test mode, simulate full verified rewarded video ad playback (3 seconds)
      await new Promise((r) => setTimeout(r, 2500));

      onProgress('VERIFYING');
      await new Promise((r) => setTimeout(r, 400));

      const award = wallet.awardRewardedAdCredit();
      if (award.success) {
        onProgress('COMPLETED');
        return { success: true, newBalance: award.newBalance };
      } else {
        onProgress('FAILED');
        return { success: false, error: award.error };
      }
    } catch (err: any) {
      onProgress('FAILED');
      return { success: false, error: err?.message || 'Ad playback error' };
    }
  }
}

