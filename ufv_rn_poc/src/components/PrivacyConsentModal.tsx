import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { MMKV } from '../services/MMKV';

interface PrivacyConsentModalProps {
  visible: boolean;
  onAccept: () => void;
}

export const PrivacyConsentModal: React.FC<PrivacyConsentModalProps> = ({
  visible,
  onAccept,
}) => {
  const handleAccept = () => {
    try {
      MMKV.set('dpdp_consent_accepted_v1', true);
    } catch {
      // Ignored
    }
    onAccept();
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={() => { }}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.shieldIcon}>🛡️</Text>
            <Text style={styles.title}>Privacy & Offline Assurance</Text>
            <Text style={styles.subtitle}>Digital Personal Data Protection (DPDP) Notice</Text>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <View style={styles.pillarRow}>
              <Text style={styles.pillarIcon}>🔒</Text>
              <View style={styles.pillarTextCol}>
                <Text style={styles.pillarHeading}>100% On-Device Processing</Text>
                <Text style={styles.pillarDesc}>
                  Your PDFs, Word documents, Excel workbooks, images, videos, and archives are processed strictly on this phone. They are NEVER uploaded to any cloud server.
                </Text>
              </View>
            </View>

            <View style={styles.pillarRow}>
              <Text style={styles.pillarIcon}>🚫</Text>
              <View style={styles.pillarTextCol}>
                <Text style={styles.pillarHeading}>Zero Document Scanning</Text>
                <Text style={styles.pillarDesc}>
                  We do not inspect, parse, or read document contents for advertising or behavioral profiling. Your confidential information stays entirely yours.
                </Text>
              </View>
            </View>

            <View style={styles.pillarRow}>
              <Text style={styles.pillarIcon}>⚡</Text>
              <View style={styles.pillarTextCol}>
                <Text style={styles.pillarHeading}>Full Offline Functionality</Text>
                <Text style={styles.pillarDesc}>
                  The core document viewer and archive extractor work with zero internet connectivity. No forced account registration required.
                </Text>
              </View>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.acceptButton} onPress={handleAccept}>
              <Text style={styles.acceptButtonText}>I Understand & Agree</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    width: '100%',
    maxHeight: '80%',
    padding: 22,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  header: {
    alignItems: 'center',
    marginBottom: 16,
  },
  shieldIcon: {
    fontSize: 40,
    marginBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    marginTop: 2,
    textAlign: 'center',
  },
  body: {
    marginVertical: 4,
  },
  bodyContent: {
    gap: 14,
  },
  pillarRow: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: '#f8fafc',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  pillarIcon: {
    fontSize: 22,
    marginTop: 2,
  },
  pillarTextCol: {
    flex: 1,
  },
  pillarHeading: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1e293b',
    marginBottom: 2,
  },
  pillarDesc: {
    fontSize: 11,
    color: '#475569',
    lineHeight: 16,
  },
  footer: {
    marginTop: 18,
  },
  acceptButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  acceptButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
});

