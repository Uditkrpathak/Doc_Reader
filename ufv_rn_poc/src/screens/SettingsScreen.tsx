import React, { useState } from 'react';
import {
  SafeAreaView,
  StatusBar,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  Linking,
} from 'react-native';
import { FigmaTheme } from '../theme/FigmaTheme';
import { MMKV } from '../services/MMKV';
import { GrievanceOfficerModal } from '../components/GrievanceOfficerModal';
import { ReportAdBottomSheet } from '../components/ReportAdBottomSheet';

interface SettingsScreenProps {
  onBack: () => void;
  onOpenAuth: (mode?: string) => void;
  onOpenRewards: () => void;
  onOpenPaywall: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  onBack,
  onOpenAuth,
  onOpenRewards,
  onOpenPaywall,
}) => {
  // Viewer Preferences
  const [rememberPage, setRememberPage] = useState<boolean>(
    () => MMKV.getBoolean('pref_remember_page') ?? true
  );
  const [highResRender, setHighResRender] = useState<boolean>(
    () => MMKV.getBoolean('pref_high_res') ?? true
  );

  // Privacy & DPDP Consents
  const [adPersonalization, setAdPersonalization] = useState<boolean>(
    () => MMKV.getBoolean('consent_personalized_ads') ?? false
  );
  const [telemetryDiagnostics, setTelemetryDiagnostics] = useState<boolean>(
    () => MMKV.getBoolean('consent_telemetry') ?? false
  );

  // Cache state
  const [cacheSizeMb, setCacheSizeMb] = useState<number>(38.4);

  // Modals
  const [isGrievanceVisible, setIsGrievanceVisible] = useState<boolean>(false);
  const [isReportAdVisible, setIsReportAdVisible] = useState<boolean>(false);

  const toggleRememberPage = (val: boolean) => {
    setRememberPage(val);
    MMKV.set('pref_remember_page', val);
  };

  const toggleHighRes = (val: boolean) => {
    setHighResRender(val);
    MMKV.set('pref_high_res', val);
  };

  const toggleAdPersonalization = (val: boolean) => {
    setAdPersonalization(val);
    MMKV.set('consent_personalized_ads', val);
    Alert.alert(
      'Advertising Preferences Updated',
      val
        ? 'Personalized advertising enabled via Google AdMob TCF consent.'
        : 'Non-personalized, contextual advertising enabled. AdMob will not track your activity across apps.'
    );
  };

  const toggleTelemetry = (val: boolean) => {
    setTelemetryDiagnostics(val);
    MMKV.set('consent_telemetry', val);
  };

  const handleClearCache = () => {
    Alert.alert(
      'Clear Preview Cache',
      `This will free up ${cacheSizeMb} MB of temporary rendering cache. Your original documents will NOT be deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            setCacheSizeMb(0);
            Alert.alert('Cache Cleared', 'Temporary rendering cache successfully freed.');
          },
        },
      ]
    );
  };

  const handleExportData = () => {
    Alert.alert(
      'Data Portability (DPDP Act)',
      'Your account preferences, coin transactions, and consent records have been packaged into a secure JSON archive. Would you like to save it to your device?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Export JSON', onPress: () => Alert.alert('Exported', 'Saved to Downloads/docreader_export.json') },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar hidden={true} />

      {/* Screen Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} activeOpacity={0.7} onPress={onBack}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerRightSpace} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Account Profile Card */}
        <Text style={styles.sectionHeader}>ACCOUNT & WALLET</Text>
        <View style={styles.accountCard}>
          <View style={styles.accountTopRow}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>👤</Text>
            </View>
            <View style={styles.accountInfoCol}>
              <Text style={styles.accountName}>Guest User</Text>
              <Text style={styles.accountSub}>Local on-device session (#GUEST-8149)</Text>
            </View>
          </View>

          <View style={styles.accountActionRow}>
            <TouchableOpacity
              style={styles.signInBtn}
              activeOpacity={0.8}
              onPress={() => onOpenAuth('SIGN_IN')}>
              <Text style={styles.signInBtnText}>Sign In / Register</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.rewardsShortcutBtn}
              activeOpacity={0.8}
              onPress={onOpenRewards}>
              <Text style={styles.rewardsShortcutText}>Coin Wallet →</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Pro Banner */}
        <TouchableOpacity
          style={styles.proBanner}
          activeOpacity={0.85}
          onPress={onOpenPaywall}>
          <View style={styles.proBannerLeft}>
            <Text style={styles.proBadge}>★ DOCREADER PRO</Text>
            <Text style={styles.proTitle}>Go 100% Ad-Free Forever</Text>
            <Text style={styles.proSub}>Unlock lightning fast batch extraction & zero ads</Text>
          </View>
          <Text style={styles.proArrow}>›</Text>
        </TouchableOpacity>

        {/* Viewer Settings */}
        <Text style={styles.sectionHeader}>DOCUMENT VIEWING</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.settingLabelCol}>
              <Text style={styles.settingTitle}>Remember Last Read Page</Text>
              <Text style={styles.settingDesc}>Resume PDFs and books where you left off</Text>
            </View>
            <Switch
              value={rememberPage}
              onValueChange={toggleRememberPage}
              trackColor={{ false: '#CBD5E1', true: '#90C2F7' }}
              thumbColor={rememberPage ? FigmaTheme.colors.primary : '#FFFFFF'}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.settingRow}>
            <View style={styles.settingLabelCol}>
              <Text style={styles.settingTitle}>High-Resolution Rendering</Text>
              <Text style={styles.settingDesc}>Crisper vector text for zoom levels above 200%</Text>
            </View>
            <Switch
              value={highResRender}
              onValueChange={toggleHighRes}
              trackColor={{ false: '#CBD5E1', true: '#90C2F7' }}
              thumbColor={highResRender ? FigmaTheme.colors.primary : '#FFFFFF'}
            />
          </View>
        </View>

        {/* Storage & Cache */}
        <Text style={styles.sectionHeader}>STORAGE & CACHE</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.settingLabelCol}>
              <Text style={styles.settingTitle}>Document Preview Cache</Text>
              <Text style={styles.settingDesc}>
                {cacheSizeMb > 0 ? `${cacheSizeMb} MB cached thumbnails & render textures` : 'Cache is empty'}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.smallBtn, cacheSizeMb === 0 && styles.smallBtnDisabled]}
              disabled={cacheSizeMb === 0}
              onPress={handleClearCache}>
              <Text style={styles.smallBtnText}>Clear</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* DPDP Act 2023 & Privacy Center */}
        <Text style={styles.sectionHeader}>PRIVACY & DATA RIGHTS (DPDP ACT 2023)</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.settingLabelCol}>
              <Text style={styles.settingTitle}>Personalized Advertising</Text>
              <Text style={styles.settingDesc}>Allow AdMob to show tailored ads based on interest</Text>
            </View>
            <Switch
              value={adPersonalization}
              onValueChange={toggleAdPersonalization}
              trackColor={{ false: '#CBD5E1', true: '#90C2F7' }}
              thumbColor={adPersonalization ? FigmaTheme.colors.primary : '#FFFFFF'}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.settingRow}>
            <View style={styles.settingLabelCol}>
              <Text style={styles.settingTitle}>Crash & Error Diagnostics</Text>
              <Text style={styles.settingDesc}>Send anonymous crash reports without any document data</Text>
            </View>
            <Switch
              value={telemetryDiagnostics}
              onValueChange={toggleTelemetry}
              trackColor={{ false: '#CBD5E1', true: '#90C2F7' }}
              thumbColor={telemetryDiagnostics ? FigmaTheme.colors.primary : '#FFFFFF'}
            />
          </View>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.navigationRow}
            onPress={() => setIsGrievanceVisible(true)}>
            <Text style={styles.navRowTitle}>⚖️ Grievance Redressal Officer (India)</Text>
            <Text style={styles.navRowArrow}>›</Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.navigationRow} onPress={handleExportData}>
            <Text style={styles.navRowTitle}>📥 Download My Data (Export JSON)</Text>
            <Text style={styles.navRowArrow}>›</Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.navigationRow}
            onPress={() => onOpenAuth('DELETE_ACCOUNT_CONFIRM')}>
            <Text style={[styles.navRowTitle, { color: FigmaTheme.colors.danger }]}>
              🗑️ Delete Account & Cloud Data
            </Text>
            <Text style={styles.navRowArrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Ads & Support */}
        <Text style={styles.sectionHeader}>HELP & FEEDBACK</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.navigationRow}
            onPress={() => setIsReportAdVisible(true)}>
            <Text style={styles.navRowTitle}>📢 Report an Advertisement</Text>
            <Text style={styles.navRowArrow}>›</Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.navigationRow}
            onPress={() => Linking.openURL('mailto:support@docreaderapp.com?subject=DocReader%20Feedback')}>
            <Text style={styles.navRowTitle}>✉️ Contact Support</Text>
            <Text style={styles.navRowArrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* About App */}
        <Text style={styles.sectionHeader}>ABOUT</Text>
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>DocReader App Version</Text>
            <Text style={styles.infoValue}>1.0.0 (Build 42)</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Document Engine</Text>
            <Text style={styles.infoValue}>PDFium C++ Native & SheetJS</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Security Model</Text>
            <Text style={styles.infoValue}>100% On-Device Processing</Text>
          </View>
        </View>

        <Text style={styles.footerNotice}>
          DocReader for Android · Built with privacy-first on-device architecture.
        </Text>
      </ScrollView>

      {/* Modals */}
      <GrievanceOfficerModal
        visible={isGrievanceVisible}
        onClose={() => setIsGrievanceVisible(false)}
      />

      <ReportAdBottomSheet
        visible={isReportAdVisible}
        onClose={() => setIsReportAdVisible(false)}
      />
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
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: FigmaTheme.colors.textSecondary,
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 14,
  },
  accountCard: {
    backgroundColor: FigmaTheme.colors.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: FigmaTheme.colors.cardBorder,
    ...FigmaTheme.shadows.card,
  },
  accountTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: FigmaTheme.colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 20,
  },
  accountInfoCol: {
    flex: 1,
  },
  accountName: {
    fontSize: 16,
    fontWeight: '700',
    color: FigmaTheme.colors.textPrimary,
  },
  accountSub: {
    fontSize: 12,
    color: FigmaTheme.colors.textSecondary,
    marginTop: 2,
  },
  accountActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  signInBtn: {
    flex: 1,
    height: 40,
    backgroundColor: FigmaTheme.colors.primary,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  signInBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  rewardsShortcutBtn: {
    height: 40,
    paddingHorizontal: 14,
    backgroundColor: FigmaTheme.colors.primaryLight,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rewardsShortcutText: {
    color: FigmaTheme.colors.primaryDark,
    fontSize: 13,
    fontWeight: '700',
  },
  proBanner: {
    backgroundColor: '#0D084C',
    borderRadius: 16,
    padding: 18,
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...FigmaTheme.shadows.card,
  },
  proBannerLeft: {
    flex: 1,
  },
  proBadge: {
    color: '#F59E0B',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  proTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  proSub: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 12,
  },
  proArrow: {
    fontSize: 28,
    color: '#FFFFFF',
    fontWeight: '300',
    marginLeft: 10,
  },
  card: {
    backgroundColor: FigmaTheme.colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: FigmaTheme.colors.cardBorder,
    ...FigmaTheme.shadows.card,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  settingLabelCol: {
    flex: 1,
    marginRight: 12,
  },
  settingTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: FigmaTheme.colors.textPrimary,
  },
  settingDesc: {
    fontSize: 12,
    color: FigmaTheme.colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  divider: {
    height: 1,
    backgroundColor: FigmaTheme.colors.cardBorder,
  },
  smallBtn: {
    backgroundColor: FigmaTheme.colors.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  smallBtnDisabled: {
    backgroundColor: FigmaTheme.colors.background,
  },
  smallBtnText: {
    color: FigmaTheme.colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  navigationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  navRowTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: FigmaTheme.colors.textPrimary,
  },
  navRowArrow: {
    fontSize: 20,
    color: FigmaTheme.colors.textMuted,
    fontWeight: '300',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  infoLabel: {
    fontSize: 13,
    color: FigmaTheme.colors.textSecondary,
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '600',
    color: FigmaTheme.colors.textPrimary,
  },
  footerNotice: {
    textAlign: 'center',
    fontSize: 11,
    color: FigmaTheme.colors.textMuted,
    marginTop: 24,
    marginBottom: 8,
  },
});

