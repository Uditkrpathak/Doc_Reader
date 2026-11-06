import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { WalletService, WalletState } from '../services/WalletService';
import { AdService } from '../services/AdService';
import { FigmaTheme } from '../theme/FigmaTheme';

interface WalletModalProps {
  visible: boolean;
  onClose: () => void;
  onStateChanged?: () => void;
}

export const WalletModal: React.FC<WalletModalProps> = ({
  visible,
  onClose,
  onStateChanged,
}) => {
  const wallet = WalletService.getInstance();
  const adService = AdService.getInstance();

  const [state, setState] = useState<WalletState>(() => wallet.getState());
  const [activeScreen, setActiveScreen] = useState<'REWARDS' | 'WALLET'>('REWARDS');
  const [walletTab, setWalletTab] = useState<'ALL' | 'EARNED' | 'REDEEMED'>('ALL');

  // Ad playback & reward dialog states (Figma Image 5)
  const [isAdPlaying, setIsAdPlaying] = useState<boolean>(false);
  const [rewardSuccessVisible, setRewardSuccessVisible] = useState<boolean>(false);
  const [rewardFailedVisible, setRewardFailedVisible] = useState<boolean>(false);

  const refreshState = () => {
    const s = wallet.getState();
    setState({ ...s });
    onStateChanged?.();
  };

  useEffect(() => {
    if (visible) {
      refreshState();
    }
  }, [visible]);

  const watchedCount = state.dailyAdsCount || 0;
  const isDailyLimitReached = watchedCount >= 5;

  const handleWatchAd = async () => {
    if (isDailyLimitReached) return;

    setIsAdPlaying(true);
    const res = await adService.playRewardedAd(() => {});
    setIsAdPlaying(false);
    refreshState();

    if (res.success) {
      setRewardSuccessVisible(true);
    } else {
      setRewardFailedVisible(true);
    }
  };

  const handleRedeemAdFree = () => {
    const res = wallet.redeemAdFreePass();
    refreshState();
    if (res.success) {
      setActiveScreen('WALLET');
    }
  };

  const isAdFree = wallet.isAdFreeActive();
  const remainingHours = wallet.getAdFreeRemainingHours();

  // Filter wallet transactions
  const filteredTransactions = (state.history || []).filter((tx) => {
    if (walletTab === 'EARNED') return tx.amount > 0;
    if (walletTab === 'REDEEMED') return tx.amount < 0;
    return true;
  });

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <StatusBar hidden={true} />

        {/* 1. TOP BRAND HEADER (#016EEF) */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.backBtnText}>←</Text>
          </TouchableOpacity>

          <View style={styles.headerTitleBox}>
            <Text style={styles.headerTitleText}>
              {activeScreen === 'REWARDS' ? 'Rewards' : 'Credit Wallet'}
            </Text>
          </View>

          {/* Toggle Screen Button */}
          <TouchableOpacity
            style={styles.switchScreenBtn}
            activeOpacity={0.7}
            onPress={() => setActiveScreen(activeScreen === 'REWARDS' ? 'WALLET' : 'REWARDS')}>
            <Text style={styles.switchScreenText}>
              {activeScreen === 'REWARDS' ? '🪙 Wallet' : '🎁 Rewards'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* 2. REWARDS VIEW (Figma Image 5) */}
        {activeScreen === 'REWARDS' ? (
          <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
            {/* Balance Hero Card */}
            <View style={styles.rewardHeroCard}>
              <Text style={styles.rewardHeroKey}>YOUR CREDITS</Text>
              <Text style={styles.rewardHeroValue}>{state.balance}</Text>
              <Text style={styles.rewardHeroDesc}>
                Redeem credits for ad-free time. Credits never affect opening files.
              </Text>
            </View>

            {/* Today's Rewards Limit Row */}
            <View style={styles.todayLimitRow}>
              <Text style={styles.todayLimitTitle}>Today's rewards</Text>
              <Text style={styles.todayLimitFraction}>{watchedCount} of 5</Text>
            </View>
            <Text style={styles.todayLimitSub}>
              {isDailyLimitReached
                ? "You've reached today's limit. New rewards unlock tomorrow."
                : 'Watch a short video to earn 10 credits. Up to 5 a day.'}
            </Text>

            {/* How It Works 3-Step Guide (Figma Image 5) */}
            <View style={styles.howItWorksCard}>
              <Text style={styles.howItWorksHeader}>How it works</Text>

              <View style={styles.guideStepRow}>
                <View style={styles.guideIconBox}>
                  <Text style={styles.guideEmoji}>👁️</Text>
                </View>
                <Text style={styles.guideStepText}>
                  Watch a short video, only when you choose to
                </Text>
              </View>

              <View style={styles.guideStepRow}>
                <View style={styles.guideIconBox}>
                  <Text style={styles.guideEmoji}>🪙</Text>
                </View>
                <Text style={styles.guideStepText}>
                  Earn 10 credits for each completed video
                </Text>
              </View>

              <View style={styles.guideStepRow}>
                <View style={styles.guideIconBox}>
                  <Text style={styles.guideEmoji}>🛡️</Text>
                </View>
                <Text style={styles.guideStepText}>
                  Spend credits on ad-free access
                </Text>
              </View>
            </View>

            {/* Quick Navigation Tabs: [ Wallet | Ad-free | Premium ] */}
            <View style={styles.quickNavTabsRow}>
              <TouchableOpacity
                style={styles.quickTabBtn}
                activeOpacity={0.7}
                onPress={() => setActiveScreen('WALLET')}>
                <Text style={styles.quickTabEmoji}>🪙</Text>
                <Text style={styles.quickTabLabel}>Wallet</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickTabBtn}
                activeOpacity={0.7}
                onPress={handleRedeemAdFree}>
                <Text style={styles.quickTabEmoji}>⚡</Text>
                <Text style={styles.quickTabLabel}>Ad-free</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickTabBtn}
                activeOpacity={0.7}
                onPress={() => setActiveScreen('WALLET')}>
                <Text style={styles.quickTabEmoji}>⭐</Text>
                <Text style={styles.quickTabLabel}>Premium</Text>
              </TouchableOpacity>
            </View>

            {/* Earn Button or Daily Limit State (Figma Image 5) */}
            {isDailyLimitReached ? (
              <View style={styles.dailyLimitDisabledBtn}>
                <Text style={styles.dailyLimitDisabledText}>Come back tomorrow</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.earnCreditsBtn, isAdPlaying && styles.earnCreditsBtnDisabled]}
                disabled={isAdPlaying}
                activeOpacity={0.85}
                onPress={handleWatchAd}>
                {isAdPlaying ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.earnCreditsBtnText}>▶  Earn 10 credits</Text>
                )}
              </TouchableOpacity>
            )}

            <Text style={styles.optionalDisclaimer}>
              Videos are optional. You will never see one before opening a file.
            </Text>
          </ScrollView>
        ) : (
          /* 3. CREDIT WALLET VIEW (Figma Image 5) */
          <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
            {/* Balance Card */}
            <View style={styles.walletBalanceCard}>
              <Text style={styles.walletBalanceLabel}>BALANCE</Text>
              <Text style={styles.walletBalanceNumber}>{state.balance}</Text>
              {isAdFree && (
                <View style={styles.adFreeActivePill}>
                  <Text style={styles.adFreeActiveText}>
                    🛡️ Ad-Free Active ({remainingHours}h remaining)
                  </Text>
                </View>
              )}
            </View>

            {/* Wallet Filter Tabs: [ All | Earned | Redeemed ] */}
            <View style={styles.walletFilterTabsRow}>
              {(['ALL', 'EARNED', 'REDEEMED'] as const).map((tab) => (
                <TouchableOpacity
                  key={tab}
                  style={[styles.walletTabBtn, walletTab === tab && styles.walletTabBtnActive]}
                  activeOpacity={0.75}
                  onPress={() => setWalletTab(tab)}>
                  <Text
                    style={[
                      styles.walletTabBtnText,
                      walletTab === tab && styles.walletTabBtnTextActive,
                    ]}>
                    {tab.charAt(0) + tab.slice(1).toLowerCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Activity List or Empty State */}
            {filteredTransactions.length === 0 ? (
              <View style={styles.emptyWalletCard}>
                <View style={styles.emptyWalletIconCircle}>
                  <Text style={styles.emptyWalletIcon}>🪙</Text>
                </View>
                <Text style={styles.emptyWalletTitle}>No credit activity yet</Text>
                <Text style={styles.emptyWalletSub}>
                  Earned and redeemed credits will appear here.
                </Text>
              </View>
            ) : (
              <View style={styles.transactionsListCard}>
                {filteredTransactions.map((tx, idx) => (
                  <View key={`tx-${tx.timestamp}-${idx}`} style={styles.txRow}>
                    <View style={styles.txLeft}>
                      <Text style={styles.txDesc}>{tx.description}</Text>
                      <Text style={styles.txDate}>{new Date(tx.timestamp).toLocaleDateString()}</Text>
                    </View>
                    <Text style={[styles.txAmount, tx.amount > 0 ? styles.txPlus : styles.txMinus]}>
                      {tx.amount > 0 ? `+${tx.amount}` : tx.amount}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        )}

        {/* 4. REWARD EARNED DIALOG (Figma Image 5) */}
        <Modal visible={rewardSuccessVisible} transparent animationType="fade" onRequestClose={() => setRewardSuccessVisible(false)}>
          <View style={styles.dialogOverlay}>
            <View style={styles.dialogCard}>
              <View style={styles.successCheckCircle}>
                <Text style={styles.successCheckIcon}>✓</Text>
              </View>
              <Text style={styles.dialogTitle}>+10 credits earned</Text>
              <Text style={styles.dialogSubtitle}>
                Your balance is now {state.balance} credits.
              </Text>
              <TouchableOpacity
                style={styles.dialogPrimaryBtn}
                activeOpacity={0.8}
                onPress={() => setRewardSuccessVisible(false)}>
                <Text style={styles.dialogPrimaryBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* 5. REWARD FAILED DIALOG (Figma Image 5) */}
        <Modal visible={rewardFailedVisible} transparent animationType="fade" onRequestClose={() => setRewardFailedVisible(false)}>
          <View style={styles.dialogOverlay}>
            <View style={styles.dialogCard}>
              <View style={styles.warningCircle}>
                <Text style={styles.warningIcon}>⚠️</Text>
              </View>
              <Text style={styles.dialogTitle}>Reward couldn't be completed</Text>
              <Text style={styles.dialogSubtitle}>
                The video didn't finish loading. No credits were taken or added. You can try again.
              </Text>

              <TouchableOpacity
                style={styles.dialogPrimaryBtn}
                activeOpacity={0.8}
                onPress={() => {
                  setRewardFailedVisible(false);
                  handleWatchAd();
                }}>
                <Text style={styles.dialogPrimaryBtnText}>Try again</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.dialogSecondaryBtn}
                activeOpacity={0.7}
                onPress={() => setRewardFailedVisible(false)}>
                <Text style={styles.dialogSecondaryBtnText}>Not now</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: FigmaTheme.colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: FigmaTheme.colors.headerBlue,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backBtnText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerTitleBox: {
    flex: 1,
    marginHorizontal: 10,
  },
  headerTitleText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  switchScreenBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  switchScreenText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },

  // Reward Hero Card (Figma Image 5)
  rewardHeroCard: {
    backgroundColor: FigmaTheme.colors.primary,
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
    ...FigmaTheme.shadows.floating,
  },
  rewardHeroKey: {
    fontSize: 11,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.8)',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  rewardHeroValue: {
    fontSize: 36,
    fontWeight: '900',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  rewardHeroDesc: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.9)',
    lineHeight: 18,
  },

  todayLimitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  todayLimitTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  todayLimitFraction: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  todayLimitSub: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 16,
  },

  // How it works card (Figma Image 5)
  howItWorksCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...FigmaTheme.shadows.card,
  },
  howItWorksHeader: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 14,
  },
  guideStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  guideIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  guideEmoji: {
    fontSize: 16,
  },
  guideStepText: {
    flex: 1,
    fontSize: 13,
    color: '#334155',
    lineHeight: 18,
  },

  // Quick Nav Tabs
  quickNavTabsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 20,
  },
  quickTabBtn: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...FigmaTheme.shadows.card,
  },
  quickTabEmoji: {
    fontSize: 20,
    marginBottom: 4,
  },
  quickTabLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },

  earnCreditsBtn: {
    backgroundColor: FigmaTheme.colors.primary,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 12,
    ...FigmaTheme.shadows.floating,
  },
  earnCreditsBtnDisabled: {
    opacity: 0.6,
  },
  earnCreditsBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  dailyLimitDisabledBtn: {
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 12,
  },
  dailyLimitDisabledText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#94A3B8',
  },
  optionalDisclaimer: {
    fontSize: 11,
    color: '#94A3B8',
    textAlign: 'center',
  },

  // Credit Wallet Styles
  walletBalanceCard: {
    backgroundColor: FigmaTheme.colors.primary,
    borderRadius: 20,
    padding: 20,
    marginBottom: 18,
    ...FigmaTheme.shadows.floating,
  },
  walletBalanceLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.8)',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  walletBalanceNumber: {
    fontSize: 36,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  adFreeActivePill: {
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginTop: 10,
  },
  adFreeActiveText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  walletFilterTabsRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 4,
    marginBottom: 18,
  },
  walletTabBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  walletTabBtnActive: {
    backgroundColor: '#FFFFFF',
    ...FigmaTheme.shadows.card,
  },
  walletTabBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  walletTabBtnTextActive: {
    fontWeight: '700',
    color: FigmaTheme.colors.primary,
  },

  emptyWalletCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 36,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderStyle: 'dashed',
    marginTop: 10,
    ...FigmaTheme.shadows.card,
  },
  emptyWalletIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  emptyWalletIcon: {
    fontSize: 28,
  },
  emptyWalletTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  emptyWalletSub: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
  },

  transactionsListCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  txRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  txLeft: {
    flex: 1,
    marginRight: 12,
  },
  txDesc: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 2,
  },
  txDate: {
    fontSize: 11,
    color: '#94A3B8',
  },
  txAmount: {
    fontSize: 14,
    fontWeight: '800',
  },
  txPlus: {
    color: '#16A34A',
  },
  txMinus: {
    color: '#DC2626',
  },

  // Dialogs
  dialogOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  dialogCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    ...FigmaTheme.shadows.floating,
  },
  successCheckCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#D1FAE5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  successCheckIcon: {
    fontSize: 28,
    fontWeight: '800',
    color: '#16A34A',
  },
  warningCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  warningIcon: {
    fontSize: 26,
  },
  dialogTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
    textAlign: 'center',
  },
  dialogSubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 20,
  },
  dialogPrimaryBtn: {
    width: '100%',
    backgroundColor: FigmaTheme.colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  dialogPrimaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  dialogSecondaryBtn: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  dialogSecondaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#64748B',
  },
});
