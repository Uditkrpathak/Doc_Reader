import React, { useState, useEffect } from 'react';
import {
  SafeAreaView,
  StatusBar,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { FigmaTheme } from '../theme/FigmaTheme';
import { WalletService, AD_FREE_TIERS, AdFreeTier, LedgerEntry } from '../services/WalletService';
import { CoinIcon } from '../components/AppIcons';

interface RewardsScreenProps {
  onBack: () => void;
  onOpenPaywall?: () => void;
}

export const RewardsScreen: React.FC<RewardsScreenProps> = ({ onBack, onOpenPaywall }) => {
  const walletService = WalletService.getInstance();
  const [balance, setBalance] = useState<number>(() => walletService.getBalance());
  const [isAdFreeActive, setIsAdFreeActive] = useState<boolean>(() => walletService.isAdFreeActive());
  const [remainingHours, setRemainingHours] = useState<number>(() =>
    walletService.getAdFreeRemainingHours()
  );
  const [dailyAdsRemaining, setDailyAdsRemaining] = useState<number>(() =>
    walletService.getDailyAdsRemaining()
  );
  const [history, setHistory] = useState<LedgerEntry[]>(() => walletService.getState().history);

  // Verifying state modal
  const [isVerifyingAd, setIsVerifyingAd] = useState<boolean>(false);
  const [verifyStatus, setVerifyStatus] = useState<'VERIFYING' | 'SUCCESS' | 'ERROR'>('VERIFYING');

  const refreshState = () => {
    setBalance(walletService.getBalance());
    setIsAdFreeActive(walletService.isAdFreeActive());
    setRemainingHours(walletService.getAdFreeRemainingHours());
    setDailyAdsRemaining(walletService.getDailyAdsRemaining());
    setHistory([...walletService.getState().history]);
  };

  useEffect(() => {
    refreshState();
  }, []);

  const handleWatchAd = () => {
    if (!walletService.canWatchRewardedAdToday()) {
      Alert.alert('Daily Limit Reached', 'You have watched all 5 reward ads for today. Limit resets at midnight.');
      return;
    }

    setIsVerifyingAd(true);
    setVerifyStatus('VERIFYING');

    // Simulate real AdMob video completion followed by server-side verification
    setTimeout(() => {
      const res = walletService.awardRewardedAdCredit();
      if (res.success) {
        setVerifyStatus('SUCCESS');
        setTimeout(() => {
          setIsVerifyingAd(false);
          refreshState();
        }, 1200);
      } else {
        setVerifyStatus('ERROR');
        setTimeout(() => {
          setIsVerifyingAd(false);
          Alert.alert('Reward Notice', res.error || 'Failed to credit coins');
        }, 1000);
      }
    }, 2000);
  };

  const handleRedeemTier = (tierKey: AdFreeTier) => {
    const tier = AD_FREE_TIERS[tierKey];
    if (balance < tier.cost) {
      Alert.alert(
        'Insufficient Coins',
        `You need ${tier.cost} coins for ${tier.label}. You currently have ${balance} coins. Watch reward ads to earn more!`
      );
      return;
    }

    const res = walletService.redeemTier(tierKey);
    if (res.success) {
      refreshState();
      Alert.alert('Success', res.message);
    } else {
      Alert.alert('Redemption Failed', res.message);
    }
  };

  const completedAdsCount = 5 - dailyAdsRemaining;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar hidden={true} />

      {/* Screen Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} activeOpacity={0.7} onPress={onBack}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Rewards & Coins</Text>
        <View style={styles.headerRightSpace} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Balance Card */}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>YOUR COIN BALANCE</Text>
          <View style={styles.balanceRow}>
            <View style={styles.coinBadgeCircle}>
              <CoinIcon size={24} color="#F59E0B" />
            </View>
            <Text style={styles.balanceNumber}>{balance}</Text>
            <Text style={styles.coinsSuffix}>Coins</Text>
          </View>

          {isAdFreeActive ? (
            <View style={styles.activeAdFreePill}>
              <Text style={styles.activeAdFreeText}>
                🛡️ Ad-Free Active: ~{remainingHours}h remaining
              </Text>
            </View>
          ) : (
            <Text style={styles.adFreeSubtext}>
              Earn coins by watching short video ads and redeem them for ad-free reading!
            </Text>
          )}

          {onOpenPaywall && (
            <TouchableOpacity
              style={styles.paywallLinkBtn}
              activeOpacity={0.8}
              onPress={onOpenPaywall}>
              <Text style={styles.paywallLinkText}>★ Go 100% Ad-Free Forever with Pro →</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Daily Reward Ads Card */}
        <Text style={styles.sectionHeader}>DAILY REWARD ADS</Text>
        <View style={styles.dailyCard}>
          <View style={styles.dailyTopRow}>
            <View style={styles.adIconCircle}>
              <Text style={styles.adPlayIcon}>▶</Text>
            </View>
            <View style={styles.adInfoCol}>
              <Text style={styles.adTitle}>Watch Video Ad</Text>
              <Text style={styles.adSubtitle}>Earn +10 coins per completed ad</Text>
            </View>
            <View style={styles.rewardPill}>
              <Text style={styles.rewardPillText}>+10 Coins</Text>
            </View>
          </View>

          <View style={styles.progressContainer}>
            <View style={styles.progressLabelRow}>
              <Text style={styles.progressLabel}>
                Today's limit: {completedAdsCount} of 5 watched
              </Text>
              <Text style={styles.progressCap}>{dailyAdsRemaining} left</Text>
            </View>
            <View style={styles.progressBarTrack}>
              <View
                style={[
                  styles.progressBarFill,
                  { width: `${(completedAdsCount / 5) * 100}%` },
                ]}
              />
            </View>
            <Text style={styles.resetTimerText}>Resets automatically at midnight</Text>
          </View>

          <TouchableOpacity
            style={[
              styles.watchAdBtn,
              dailyAdsRemaining === 0 && styles.watchAdBtnDisabled,
            ]}
            activeOpacity={0.8}
            disabled={dailyAdsRemaining === 0}
            onPress={handleWatchAd}>
            <Text style={styles.watchAdBtnText}>
              {dailyAdsRemaining > 0 ? 'Watch Video Ad (+10)' : 'Daily Limit Reached'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Redeem for Ad-Free Passes (Figma Tiers) */}
        <Text style={styles.sectionHeader}>REDEEM AD-FREE TIME</Text>
        <View style={styles.tiersContainer}>
          {(['1_HOUR', '24_HOURS', '7_DAYS'] as AdFreeTier[]).map((tierKey) => {
            const tier = AD_FREE_TIERS[tierKey];
            const canAfford = balance >= tier.cost;
            const isHighlight = tier.tag === 'MOST POPULAR';

            return (
              <View
                key={tierKey}
                style={[styles.tierCard, isHighlight && styles.tierCardHighlight]}>
                {tier.tag && (
                  <View
                    style={[
                      styles.tierBadge,
                      tier.tag === 'BEST VALUE' ? styles.tierBadgeGreen : styles.tierBadgeBlue,
                    ]}>
                    <Text style={styles.tierBadgeText}>{tier.tag}</Text>
                  </View>
                )}

                <View style={styles.tierDetails}>
                  <Text style={styles.tierDuration}>{tier.durationLabel}</Text>
                  <Text style={styles.tierDescription}>Continuous ad-free document reading</Text>
                </View>

                <View style={styles.tierCostRow}>
                  <View style={styles.costBadge}>
                    <CoinIcon size={14} color="#F59E0B" />
                    <Text style={styles.costText}>{tier.cost} Coins</Text>
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.redeemBtn,
                      !canAfford && styles.redeemBtnDisabled,
                      isHighlight && styles.redeemBtnHighlight,
                    ]}
                    activeOpacity={0.8}
                    onPress={() => handleRedeemTier(tierKey)}>
                    <Text
                      style={[
                        styles.redeemBtnText,
                        !canAfford && styles.redeemBtnTextDisabled,
                      ]}>
                      {canAfford ? 'Redeem' : 'Need more'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>

        {/* Coin Ledger History */}
        <Text style={styles.sectionHeader}>RECENT COIN ACTIVITY</Text>
        <View style={styles.historyCard}>
          {history.length === 0 ? (
            <Text style={styles.emptyHistoryText}>No coin activity yet.</Text>
          ) : (
            history.slice(0, 10).map((entry, idx) => {
              const isPositive = entry.amount > 0;
              const dateStr = new Date(entry.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <View
                  key={entry.id || idx}
                  style={[
                    styles.historyRow,
                    idx < Math.min(history.length, 10) - 1 && styles.historyRowBorder,
                  ]}>
                  <View style={styles.historyLeft}>
                    <Text style={styles.historyDesc}>{entry.description}</Text>
                    <Text style={styles.historyDate}>{dateStr}</Text>
                  </View>
                  <Text
                    style={[
                      styles.historyAmount,
                      isPositive ? styles.amountPositive : styles.amountNegative,
                    ]}>
                    {isPositive ? `+${entry.amount}` : entry.amount}
                  </Text>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* Ad Verification Modal */}
      <Modal visible={isVerifyingAd} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {verifyStatus === 'VERIFYING' && (
              <>
                <View style={styles.modalIconCircle}>
                  <ActivityIndicator size="large" color={FigmaTheme.colors.primary} />
                </View>
                <Text style={styles.modalTitle}>Verifying Reward...</Text>
                <Text style={styles.modalSubtitle}>
                  Confirming ad view with Google AdMob. Please do not close the app.
                </Text>
              </>
            )}

            {verifyStatus === 'SUCCESS' && (
              <>
                <View style={[styles.modalIconCircle, { backgroundColor: FigmaTheme.colors.successBg }]}>
                  <Text style={{ fontSize: 28, color: FigmaTheme.colors.success, fontWeight: '700' }}>✓</Text>
                </View>
                <Text style={styles.modalTitle}>+10 Coins Credited!</Text>
                <Text style={styles.modalSubtitle}>
                  Reward confirmed. Your coins have been added to your wallet.
                </Text>
              </>
            )}

            {verifyStatus === 'ERROR' && (
              <>
                <View style={[styles.modalIconCircle, { backgroundColor: FigmaTheme.colors.warningBg }]}>
                  <Text style={{ fontSize: 26, color: FigmaTheme.colors.warning }}>⚠</Text>
                </View>
                <Text style={styles.modalTitle}>Verification Incomplete</Text>
                <Text style={styles.modalSubtitle}>
                  Ad video was closed early or network timed out.
                </Text>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: FigmaTheme.colors.background,
  },
  header: {
    height: 56,
    backgroundColor: FigmaTheme.colors.headerBlue,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    justifyContent: 'space-between',
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backArrow: {
    fontSize: 26,
    color: '#FFFFFF',
    fontWeight: '300',
    marginTop: -2,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerRightSpace: {
    width: 38,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  balanceCard: {
    backgroundColor: FigmaTheme.colors.primary,
    borderRadius: 18,
    padding: 20,
    marginBottom: 20,
    ...FigmaTheme.shadows.card,
  },
  balanceLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.8)',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  coinBadgeCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  balanceNumber: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FFFFFF',
    marginRight: 8,
  },
  coinsSuffix: {
    fontSize: 18,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.9)',
  },
  activeAdFreePill: {
    backgroundColor: '#0D084C',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
    marginBottom: 10,
  },
  activeAdFreeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  adFreeSubtext: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.9)',
    lineHeight: 18,
    marginBottom: 12,
  },
  paywallLinkBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  paywallLinkText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: FigmaTheme.colors.textSecondary,
    letterSpacing: 0.6,
    marginBottom: 10,
    marginTop: 4,
  },
  dailyCard: {
    backgroundColor: FigmaTheme.colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: FigmaTheme.colors.cardBorder,
    ...FigmaTheme.shadows.card,
  },
  dailyTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  adIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: FigmaTheme.colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  adPlayIcon: {
    fontSize: 14,
    color: FigmaTheme.colors.primary,
    marginLeft: 2,
  },
  adInfoCol: {
    flex: 1,
  },
  adTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: FigmaTheme.colors.textPrimary,
  },
  adSubtitle: {
    fontSize: 12,
    color: FigmaTheme.colors.textSecondary,
    marginTop: 2,
  },
  rewardPill: {
    backgroundColor: '#FEF3C7',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  rewardPillText: {
    color: '#D97706',
    fontSize: 11,
    fontWeight: '700',
  },
  progressContainer: {
    marginBottom: 14,
  },
  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: FigmaTheme.colors.textPrimary,
  },
  progressCap: {
    fontSize: 12,
    color: FigmaTheme.colors.textSecondary,
  },
  progressBarTrack: {
    height: 8,
    backgroundColor: FigmaTheme.colors.background,
    borderRadius: 4,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: FigmaTheme.colors.cardBorder,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: FigmaTheme.colors.primary,
    borderRadius: 4,
  },
  resetTimerText: {
    fontSize: 11,
    color: FigmaTheme.colors.textMuted,
    marginTop: 6,
  },
  watchAdBtn: {
    height: 46,
    backgroundColor: FigmaTheme.colors.primary,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  watchAdBtnDisabled: {
    backgroundColor: '#E2E8F0',
  },
  watchAdBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  tiersContainer: {
    marginBottom: 20,
    gap: 10,
  },
  tierCard: {
    backgroundColor: FigmaTheme.colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: FigmaTheme.colors.cardBorder,
    position: 'relative',
    ...FigmaTheme.shadows.card,
  },
  tierCardHighlight: {
    borderColor: FigmaTheme.colors.primary,
    borderWidth: 1.5,
  },
  tierBadge: {
    position: 'absolute',
    top: 10,
    right: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tierBadgeBlue: {
    backgroundColor: FigmaTheme.colors.primaryLight,
  },
  tierBadgeGreen: {
    backgroundColor: '#D1FAE5',
  },
  tierBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: FigmaTheme.colors.primary,
  },
  tierDetails: {
    marginBottom: 12,
  },
  tierDuration: {
    fontSize: 16,
    fontWeight: '700',
    color: FigmaTheme.colors.textPrimary,
  },
  tierDescription: {
    fontSize: 12,
    color: FigmaTheme.colors.textSecondary,
    marginTop: 2,
  },
  tierCostRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  costBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  costText: {
    fontSize: 15,
    fontWeight: '700',
    color: FigmaTheme.colors.textPrimary,
  },
  redeemBtn: {
    backgroundColor: FigmaTheme.colors.primaryLight,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  redeemBtnHighlight: {
    backgroundColor: FigmaTheme.colors.primary,
  },
  redeemBtnDisabled: {
    backgroundColor: FigmaTheme.colors.background,
  },
  redeemBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: FigmaTheme.colors.primary,
  },
  redeemBtnTextDisabled: {
    color: FigmaTheme.colors.textMuted,
  },
  historyCard: {
    backgroundColor: FigmaTheme.colors.card,
    borderRadius: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: FigmaTheme.colors.cardBorder,
    ...FigmaTheme.shadows.card,
  },
  emptyHistoryText: {
    paddingVertical: 20,
    textAlign: 'center',
    color: FigmaTheme.colors.textMuted,
    fontSize: 13,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  historyRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: FigmaTheme.colors.cardBorder,
  },
  historyLeft: {
    flex: 1,
  },
  historyDesc: {
    fontSize: 13,
    fontWeight: '600',
    color: FigmaTheme.colors.textPrimary,
  },
  historyDate: {
    fontSize: 11,
    color: FigmaTheme.colors.textMuted,
    marginTop: 2,
  },
  historyAmount: {
    fontSize: 14,
    fontWeight: '700',
  },
  amountPositive: {
    color: FigmaTheme.colors.success,
  },
  amountNegative: {
    color: FigmaTheme.colors.textSecondary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: FigmaTheme.colors.card,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    ...FigmaTheme.shadows.floating,
  },
  modalIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: FigmaTheme.colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: FigmaTheme.colors.textPrimary,
    marginBottom: 6,
  },
  modalSubtitle: {
    fontSize: 13,
    color: FigmaTheme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
});

