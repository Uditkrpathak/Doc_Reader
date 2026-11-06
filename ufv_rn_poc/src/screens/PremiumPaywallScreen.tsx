import React, { useState } from 'react';
import {
  SafeAreaView,
  StatusBar,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { FigmaTheme } from '../theme/FigmaTheme';

interface PremiumPaywallScreenProps {
  onClose: () => void;
  onUpgradeSuccess?: () => void;
}

type PlanType = 'ANNUAL' | 'MONTHLY' | 'LIFETIME';

export const PremiumPaywallScreen: React.FC<PremiumPaywallScreenProps> = ({
  onClose,
  onUpgradeSuccess,
}) => {
  const [selectedPlan, setSelectedPlan] = useState<PlanType>('ANNUAL');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [billingPending, setBillingPending] = useState<boolean>(false);

  const handlePurchase = () => {
    setIsProcessing(true);
    // Simulate real Google Play Billing cycle
    setTimeout(() => {
      setIsProcessing(false);
      Alert.alert(
        'Purchase Simulation',
        'Google Play Billing flow started. All ads and limits will be unlocked upon receipt confirmation.',
        [
          {
            text: 'OK',
            onPress: () => {
              if (onUpgradeSuccess) onUpgradeSuccess();
              onClose();
            },
          },
        ]
      );
    }, 1200);
  };

  const handleRestore = () => {
    Alert.alert('Restore Purchases', 'Looking up Google Play receipts for your Google account...');
  };

  const handleOpenPlaySubscriptions = () => {
    Linking.openURL('https://play.google.com/store/account/subscriptions');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar hidden={true} />

      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.closeBtn} activeOpacity={0.7} onPress={onClose}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.7} onPress={handleRestore}>
          <Text style={styles.restoreText}>Restore</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Pro Header Badge */}
        <View style={styles.badgePill}>
          <Text style={styles.badgePillText}>★ DOCREADER PRO</Text>
        </View>

        <Text style={styles.headline}>Unlock the Ultimate Reading Experience</Text>
        <Text style={styles.subheadline}>
          Pure, ad-free document viewing with fast high-res rendering and unlimited features.
        </Text>

        {/* Pending Notice (Shown when Google Play marks payment pending) */}
        {billingPending && (
          <View style={styles.pendingCard}>
            <Text style={styles.pendingTitle}>⏳ Payment Processing</Text>
            <Text style={styles.pendingText}>
              Google Play is confirming your transaction with your bank. Access will activate automatically.
            </Text>
            <TouchableOpacity onPress={() => setBillingPending(false)}>
              <Text style={styles.pendingDismiss}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Benefits Checklist */}
        <View style={styles.benefitsCard}>
          <View style={styles.benefitRow}>
            <View style={styles.checkCircle}>
              <Text style={styles.checkText}>✓</Text>
            </View>
            <View style={styles.benefitCol}>
              <Text style={styles.benefitTitle}>100% Ad-Free Forever</Text>
              <Text style={styles.benefitDesc}>Zero banner, interstitial, or video interruptions</Text>
            </View>
          </View>

          <View style={styles.benefitRow}>
            <View style={styles.checkCircle}>
              <Text style={styles.checkText}>✓</Text>
            </View>
            <View style={styles.benefitCol}>
              <Text style={styles.benefitTitle}>High-Speed Batch Archive Extraction</Text>
              <Text style={styles.benefitDesc}>Extract multi-gigabyte ZIP and RAR archives instantly</Text>
            </View>
          </View>

          <View style={styles.benefitRow}>
            <View style={styles.checkCircle}>
              <Text style={styles.checkText}>✓</Text>
            </View>
            <View style={styles.benefitCol}>
              <Text style={styles.benefitTitle}>Advanced Spreadsheet Search & Formulas</Text>
              <Text style={styles.benefitDesc}>Search across 100,000+ XLSX cells with zero lag</Text>
            </View>
          </View>

          <View style={styles.benefitRow}>
            <View style={styles.checkCircle}>
              <Text style={styles.checkText}>✓</Text>
            </View>
            <View style={styles.benefitCol}>
              <Text style={styles.benefitTitle}>Priority Offline Support</Text>
              <Text style={styles.benefitDesc}>Direct support channel for tricky document formats</Text>
            </View>
          </View>
        </View>

        {/* Pricing Options */}
        <Text style={styles.plansSectionTitle}>SELECT YOUR PLAN</Text>

        {/* Annual Plan */}
        <TouchableOpacity
          style={[styles.planCard, selectedPlan === 'ANNUAL' && styles.planCardSelected]}
          activeOpacity={0.8}
          onPress={() => setSelectedPlan('ANNUAL')}>
          <View style={styles.saveBadge}>
            <Text style={styles.saveBadgeText}>SAVE 55%</Text>
          </View>
          <View style={styles.planRadioCol}>
            <View style={[styles.radioOuter, selectedPlan === 'ANNUAL' && styles.radioOuterSelected]}>
              {selectedPlan === 'ANNUAL' && <View style={styles.radioInner} />}
            </View>
          </View>
          <View style={styles.planInfoCol}>
            <Text style={styles.planName}>Annual Subscription</Text>
            <Text style={styles.planPrice}>₹499 / year</Text>
            <Text style={styles.planBreakdown}>Only ₹41.50 per month, billed annually</Text>
          </View>
        </TouchableOpacity>

        {/* Monthly Plan */}
        <TouchableOpacity
          style={[styles.planCard, selectedPlan === 'MONTHLY' && styles.planCardSelected]}
          activeOpacity={0.8}
          onPress={() => setSelectedPlan('MONTHLY')}>
          <View style={styles.planRadioCol}>
            <View style={[styles.radioOuter, selectedPlan === 'MONTHLY' && styles.radioOuterSelected]}>
              {selectedPlan === 'MONTHLY' && <View style={styles.radioInner} />}
            </View>
          </View>
          <View style={styles.planInfoCol}>
            <Text style={styles.planName}>Monthly Subscription</Text>
            <Text style={styles.planPrice}>₹89 / month</Text>
            <Text style={styles.planBreakdown}>Billed monthly, cancel anytime</Text>
          </View>
        </TouchableOpacity>

        {/* Lifetime Purchase */}
        <TouchableOpacity
          style={[styles.planCard, selectedPlan === 'LIFETIME' && styles.planCardSelected]}
          activeOpacity={0.8}
          onPress={() => setSelectedPlan('LIFETIME')}>
          <View style={styles.lifetimeBadge}>
            <Text style={styles.lifetimeBadgeText}>ONE-TIME</Text>
          </View>
          <View style={styles.planRadioCol}>
            <View style={[styles.radioOuter, selectedPlan === 'LIFETIME' && styles.radioOuterSelected]}>
              {selectedPlan === 'LIFETIME' && <View style={styles.radioInner} />}
            </View>
          </View>
          <View style={styles.planInfoCol}>
            <Text style={styles.planName}>Lifetime Access</Text>
            <Text style={styles.planPrice}>₹1,299</Text>
            <Text style={styles.planBreakdown}>Pay once, enjoy forever across all your devices</Text>
          </View>
        </TouchableOpacity>

        {/* CTA Button */}
        <TouchableOpacity
          style={[styles.ctaBtn, isProcessing && styles.ctaBtnDisabled]}
          activeOpacity={0.85}
          disabled={isProcessing}
          onPress={handlePurchase}>
          {isProcessing ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.ctaBtnText}>
              {selectedPlan === 'ANNUAL' ? 'Start 7-Day Free Trial' : 'Upgrade to Pro Now'}
            </Text>
          )}
        </TouchableOpacity>

        {/* Disclaimer / Google Play links */}
        <Text style={styles.legalDisclaimer}>
          Cancel anytime via Google Play Subscriptions. Recurring billing applies to monthly and annual plans.
        </Text>

        <TouchableOpacity onPress={handleOpenPlaySubscriptions} style={styles.manageSubsBtn}>
          <Text style={styles.manageSubsText}>Manage subscriptions in Google Play ↗</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: FigmaTheme.colors.background,
  },
  topBar: {
    height: 52,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: FigmaTheme.colors.cardBorder,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: FigmaTheme.colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    fontSize: 16,
    color: FigmaTheme.colors.textSecondary,
    fontWeight: '600',
  },
  restoreText: {
    fontSize: 14,
    fontWeight: '600',
    color: FigmaTheme.colors.primary,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  badgePill: {
    alignSelf: 'flex-start',
    backgroundColor: '#0D084C',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    marginBottom: 12,
  },
  badgePillText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  headline: {
    fontSize: 24,
    fontWeight: '800',
    color: FigmaTheme.colors.textPrimary,
    lineHeight: 30,
    marginBottom: 8,
  },
  subheadline: {
    fontSize: 14,
    color: FigmaTheme.colors.textSecondary,
    lineHeight: 20,
    marginBottom: 20,
  },
  pendingCard: {
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  pendingTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
    marginBottom: 4,
  },
  pendingText: {
    fontSize: 12,
    color: '#78350F',
    lineHeight: 17,
  },
  pendingDismiss: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400E',
    marginTop: 6,
    textDecorationLine: 'underline',
  },
  benefitsCard: {
    backgroundColor: FigmaTheme.colors.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: FigmaTheme.colors.cardBorder,
    marginBottom: 24,
    ...FigmaTheme.shadows.card,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: FigmaTheme.colors.successBg,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  checkText: {
    fontSize: 12,
    fontWeight: '800',
    color: FigmaTheme.colors.success,
  },
  benefitCol: {
    flex: 1,
  },
  benefitTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: FigmaTheme.colors.textPrimary,
  },
  benefitDesc: {
    fontSize: 12,
    color: FigmaTheme.colors.textSecondary,
    marginTop: 2,
  },
  plansSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: FigmaTheme.colors.textSecondary,
    letterSpacing: 0.6,
    marginBottom: 12,
  },
  planCard: {
    backgroundColor: FigmaTheme.colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1.5,
    borderColor: FigmaTheme.colors.cardBorder,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
    ...FigmaTheme.shadows.card,
  },
  planCardSelected: {
    borderColor: FigmaTheme.colors.primary,
    backgroundColor: '#F8FAFF',
  },
  saveBadge: {
    position: 'absolute',
    top: -10,
    right: 14,
    backgroundColor: FigmaTheme.colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  saveBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  lifetimeBadge: {
    position: 'absolute',
    top: -10,
    right: 14,
    backgroundColor: '#0D084C',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  lifetimeBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  planRadioCol: {
    marginRight: 14,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: FigmaTheme.colors.cardBorder,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioOuterSelected: {
    borderColor: FigmaTheme.colors.primary,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: FigmaTheme.colors.primary,
  },
  planInfoCol: {
    flex: 1,
  },
  planName: {
    fontSize: 15,
    fontWeight: '700',
    color: FigmaTheme.colors.textPrimary,
  },
  planPrice: {
    fontSize: 17,
    fontWeight: '800',
    color: FigmaTheme.colors.primaryDark,
    marginTop: 2,
  },
  planBreakdown: {
    fontSize: 12,
    color: FigmaTheme.colors.textSecondary,
    marginTop: 2,
  },
  ctaBtn: {
    height: 52,
    backgroundColor: FigmaTheme.colors.primary,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 12,
    ...FigmaTheme.shadows.card,
  },
  ctaBtnDisabled: {
    opacity: 0.7,
  },
  ctaBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  legalDisclaimer: {
    fontSize: 11,
    color: FigmaTheme.colors.textMuted,
    textAlign: 'center',
    lineHeight: 16,
    marginBottom: 12,
  },
  manageSubsBtn: {
    alignSelf: 'center',
    paddingVertical: 6,
  },
  manageSubsText: {
    fontSize: 12,
    fontWeight: '600',
    color: FigmaTheme.colors.primary,
  },
});

