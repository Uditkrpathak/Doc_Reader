import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
} from 'react-native';

interface PermissionOnboardingModalProps {
  visible: boolean;
  onRequestAllFiles: () => void;
  onRequestSafFolder: () => void;
}

export const PermissionOnboardingModal: React.FC<PermissionOnboardingModalProps> = ({
  visible,
  onRequestAllFiles,
  onRequestSafFolder,
}) => {
  return (
    <Modal visible={visible} animationType="fade" transparent={false} statusBarTranslucent={false}>
      <SafeAreaView style={styles.container}>
        <StatusBar hidden={true} />
        <View style={styles.content}>
          {/* Top Graphic / Icon */}
          <View style={styles.iconCircle}>
            <Text style={styles.iconEmoji}>📂</Text>
          </View>

          <Text style={styles.title}>All Files Access</Text>
          <Text style={styles.subtitle}>
            Universal File Viewer needs storage permission to automatically discover and open your documents, spreadsheets, PDFs, and archives.
          </Text>

          {/* Value Props Card */}
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={[styles.bulletCircle, { backgroundColor: '#eff6ff' }]}>
                <Text style={styles.bulletEmoji}>⚡</Text>
              </View>
              <View style={styles.textCol}>
                <Text style={styles.rowTitle}>Instant Auto-Sync</Text>
                <Text style={styles.rowDesc}>
                  Automatically organizes all PDFs, Word docs, Excel sheets, and ZIP archives on your phone.
                </Text>
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.row}>
              <View style={[styles.bulletCircle, { backgroundColor: '#f0fdf4' }]}>
                <Text style={styles.bulletEmoji}>🔒</Text>
              </View>
              <View style={styles.textCol}>
                <Text style={styles.rowTitle}>100% Offline & Private</Text>
                <Text style={styles.rowDesc}>
                  Zero cloud uploads. All document parsing and viewing runs locally on this device.
                </Text>
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.row}>
              <View style={[styles.bulletCircle, { backgroundColor: '#faf5ff' }]}>
                <Text style={styles.bulletEmoji}>📲</Text>
              </View>
              <View style={styles.textCol}>
                <Text style={styles.rowTitle}>WhatsApp & Telegram Ready</Text>
                <Text style={styles.rowDesc}>
                  Open files directly from any messaging app or email without permission crashes.
                </Text>
              </View>
            </View>
          </View>

          {/* Action Buttons */}
          <View style={styles.actionContainer}>
            <TouchableOpacity
              style={styles.primaryButton}
              activeOpacity={0.8}
              onPress={onRequestAllFiles}>
              <Text style={styles.primaryButtonText}>Grant Storage Access</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              activeOpacity={0.7}
              onPress={onRequestSafFolder}>
              <Text style={styles.secondaryButtonText}>Choose Specific Folder (SAF)</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.footerNote}>
            You can modify this permission anytime in Android System Settings.
          </Text>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderWidth: 1.5,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  iconEmoji: {
    fontSize: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 10,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 28,
    paddingHorizontal: 8,
  },
  card: {
    width: '100%',
    backgroundColor: '#1e293b',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 28,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingVertical: 4,
  },
  bulletCircle: {
    width: 38,
    height: 38,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bulletEmoji: {
    fontSize: 18,
  },
  textCol: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 2,
  },
  rowDesc: {
    fontSize: 12,
    lineHeight: 17,
    color: '#94a3b8',
  },
  divider: {
    height: 1,
    backgroundColor: '#334155',
    marginVertical: 12,
  },
  actionContainer: {
    width: '100%',
    gap: 12,
  },
  primaryButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#475569',
  },
  secondaryButtonText: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '600',
  },
  footerNote: {
    fontSize: 11,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 20,
  },
});
