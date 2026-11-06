import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Dimensions,
} from 'react-native';
import {
  PhoneOutlineIcon,
  LockOutlineIcon,
  NoAdsOutlineIcon,
  ExternalLinkIcon,
} from '../components/AppIcons';

const { width } = Dimensions.get('window');

interface WelcomeScreenProps {
  onBrowseFiles: () => void;
  onOpenFromAnotherApp: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  onBrowseFiles,
  onOpenFromAnotherApp,
}) => {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar hidden={true} />

      {/* 1. TOP BRAND HEADER (Figma: Solid white folder + My Files) */}
      <View style={styles.topHeader}>
        <View style={styles.brandRow}>
          {/* Custom White Folder Vector */}
          <View style={styles.whiteFolderIcon}>
            <View style={styles.folderTab} />
            <View style={styles.folderBody} />
          </View>
          <Text style={styles.brandName}>My Files</Text>
        </View>
      </View>

      {/* 2. HERO ILLUSTRATION SECTION (Figma 3-card fan + navy pocket) */}
      <View style={styles.heroSection}>
        <View style={styles.heroContainer}>
          {/* Decorative Little White Dot on Left */}
          <View style={styles.whiteDot} />

          {/* Decorative Little Purple Dot on Right */}
          <View style={styles.purpleDot} />

          {/* Stack of 3 fan cards */}
          <View style={styles.cardsFanWrapper}>
            {/* Left Card: PDF (rotated left) */}
            <View style={[styles.fanCard, styles.cardLeft]}>
              <View style={styles.cardBadgeRed}>
                <Text style={styles.cardBadgeTextRed}>PDF</Text>
              </View>
              <View style={styles.cardLineLong} />
              <View style={styles.cardLineShort} />
              <View style={styles.cardPreviewPeach} />
            </View>

            {/* Middle Card: XLS (upright, centered) */}
            <View style={[styles.fanCard, styles.cardMiddle]}>
              <View style={styles.cardBadgeGreen}>
                <Text style={styles.cardBadgeTextGreen}>XLS</Text>
              </View>
              <View style={styles.cardLineLong} />
              <View style={styles.cardLineShort} />
              <View style={styles.cardPreviewMint} />
            </View>

            {/* Right Card: ZIP (rotated right) */}
            <View style={[styles.fanCard, styles.cardRight]}>
              <View style={styles.cardBadgeBrown}>
                <Text style={styles.cardBadgeTextBrown}>ZIP</Text>
              </View>
              <View style={styles.cardLineLong} />
              <View style={styles.cardLineShort} />
              <View style={styles.cardPreviewSand} />
            </View>
          </View>

          {/* Navy Blue Pocket Base */}
          <View style={styles.navyPocket}>
            {/* White Pill: 🔒 Stays on your device */}
            <View style={styles.staysPill}>
              <LockOutlineIcon size={14} color="#016EEF" />
              <Text style={styles.staysText}>Stays on your device</Text>
            </View>
          </View>
        </View>
      </View>

      {/* 3. BOTTOM MAIN CONTENT CARD (White container with rounded top corners) */}
      <View style={styles.bottomCard}>
        {/* Title (Left aligned, two lines) */}
        <Text style={styles.title}>
          Every file, one tidy{'\n'}place.
        </Text>

        {/* Subtitle (Left aligned, two lines) */}
        <Text style={styles.subtitle}>
          Open PDFs, documents, sheets, media and{'\n'}archives straight from your phone.
        </Text>

        {/* 3 Outlined Feature Badges (Left aligned: 📱 No sign-in | 🔒 On-device | ⊘ No ads first) */}
        <View style={styles.pillsRow}>
          <View style={styles.featurePill}>
            <PhoneOutlineIcon size={14} color="#016EEF" />
            <Text style={styles.featurePillText}>No sign-in</Text>
          </View>

          <View style={styles.featurePill}>
            <LockOutlineIcon size={14} color="#016EEF" />
            <Text style={styles.featurePillText}>On-device</Text>
          </View>

          <View style={styles.featurePill}>
            <NoAdsOutlineIcon size={14} color="#016EEF" />
            <Text style={styles.featurePillText}>No ads first</Text>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionsBox}>
          {/* Primary Action Button */}
          <TouchableOpacity
            style={styles.primaryBtn}
            activeOpacity={0.85}
            onPress={onBrowseFiles}>
            <Text style={styles.primaryBtnText}>Browse files  →</Text>
          </TouchableOpacity>

          {/* Secondary Action: Open a file from another app */}
          <TouchableOpacity
            style={styles.secondaryBtn}
            activeOpacity={0.75}
            onPress={onOpenFromAnotherApp}>
            <ExternalLinkIcon size={15} color="#016EEF" />
            <Text style={styles.secondaryBtnText}>Open a file from another app</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#016EEF',
  },
  topHeader: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 6,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  // Custom White Flat Folder Icon (matching Figma)
  whiteFolderIcon: {
    width: 22,
    height: 18,
    position: 'relative',
    justifyContent: 'flex-end',
  },
  folderTab: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 9,
    height: 4,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  folderBody: {
    width: 22,
    height: 15,
    backgroundColor: '#FFFFFF',
    borderRadius: 3,
    borderTopRightRadius: 4,
  },
  brandName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },

  // Hero Section
  heroSection: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  heroContainer: {
    width: width * 0.88,
    height: 230,
    alignItems: 'center',
    justifyContent: 'flex-end',
    position: 'relative',
  },

  // Decorative Dots
  whiteDot: {
    position: 'absolute',
    top: 70,
    left: 10,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#FFFFFF',
    opacity: 0.9,
  },
  purpleDot: {
    position: 'absolute',
    top: 24,
    right: 32,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#7C3AED',
  },

  // Cards Fan Layout
  cardsFanWrapper: {
    position: 'absolute',
    top: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    width: '100%',
    height: 160,
  },
  fanCard: {
    width: 106,
    height: 140,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },

  // Left Card (PDF)
  cardLeft: {
    transform: [{ rotate: '-10deg' }],
    marginRight: -16,
    marginBottom: 4,
  },
  cardBadgeRed: {
    alignSelf: 'flex-start',
    backgroundColor: '#DC2626',
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 8,
  },
  cardBadgeTextRed: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  cardPreviewPeach: {
    marginTop: 'auto',
    height: 48,
    backgroundColor: '#FFF1F2',
    borderRadius: 8,
  },

  // Middle Card (XLS)
  cardMiddle: {
    zIndex: 2,
    transform: [{ rotate: '0deg' }],
    marginBottom: 12,
  },
  cardBadgeGreen: {
    alignSelf: 'flex-start',
    backgroundColor: '#16A34A',
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 8,
  },
  cardBadgeTextGreen: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  cardPreviewMint: {
    marginTop: 'auto',
    height: 48,
    backgroundColor: '#F0FDF4',
    borderRadius: 8,
  },

  // Right Card (ZIP)
  cardRight: {
    transform: [{ rotate: '10deg' }],
    marginLeft: -16,
    marginBottom: 4,
  },
  cardBadgeBrown: {
    alignSelf: 'flex-start',
    backgroundColor: '#854D0E',
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 8,
  },
  cardBadgeTextBrown: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  cardPreviewSand: {
    marginTop: 'auto',
    height: 48,
    backgroundColor: '#FEF9C3',
    borderRadius: 8,
  },

  // Common lines on cards
  cardLineLong: {
    height: 4,
    width: '85%',
    backgroundColor: '#E2E8F0',
    borderRadius: 2,
    marginBottom: 5,
  },
  cardLineShort: {
    height: 4,
    width: '60%',
    backgroundColor: '#E2E8F0',
    borderRadius: 2,
  },

  // Navy Pocket Shape in front of cards
  navyPocket: {
    width: width * 0.74,
    height: 84,
    backgroundColor: '#0F2C59',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 6,
  },

  // Stays on your device floating pill
  staysPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 22,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  staysLockIcon: {
    fontSize: 13,
  },
  staysText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#016EEF',
  },

  // Bottom Content Card (Left-aligned matching Figma)
  bottomCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 36,
    alignItems: 'flex-start',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 8,
  },
  title: {
    fontSize: 32,
    fontWeight: '900',
    color: '#0F172A',
    textAlign: 'left',
    lineHeight: 38,
    marginBottom: 10,
    letterSpacing: -0.8,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 22,
    color: '#64748B',
    textAlign: 'left',
    marginBottom: 20,
  },

  // 3 Outlined Feature Badges (Left-aligned)
  pillsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    gap: 8,
    marginBottom: 28,
  },
  featurePill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#FFFFFF',
    gap: 6,
  },
  featurePillIcon: {
    fontSize: 12,
  },
  featurePillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },

  // Action Buttons
  actionsBox: {
    width: '100%',
    gap: 14,
  },
  primaryBtn: {
    backgroundColor: '#016EEF',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#016EEF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 6,
  },
  secondaryBtnIcon: {
    fontSize: 15,
    color: '#016EEF',
    fontWeight: '800',
  },
  secondaryBtnText: {
    color: '#016EEF',
    fontSize: 14,
    fontWeight: '700',
  },
});
