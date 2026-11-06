import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Linking,
} from 'react-native';
import { FigmaTheme } from '../theme/FigmaTheme';

interface GrievanceOfficerModalProps {
  visible: boolean;
  onClose: () => void;
}

export const GrievanceOfficerModal: React.FC<GrievanceOfficerModalProps> = ({
  visible,
  onClose,
}) => {
  const handleEmailPress = () => {
    Linking.openURL('mailto:grievance@docreaderapp.com?subject=Grievance Redressal Request - DPDP Act 2023');
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.card}>
              <View style={styles.headerRow}>
                <View style={styles.iconCircle}>
                  <Text style={styles.iconText}>⚖️</Text>
                </View>
                <View style={styles.headerTextCol}>
                  <Text style={styles.title}>Grievance Officer</Text>
                  <Text style={styles.subtitle}>DPDP Act 2023 & IT Rules (India)</Text>
                </View>
              </View>

              <Text style={styles.body}>
                In accordance with the Digital Personal Data Protection Act, 2023 and the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021, the contact details of the Grievance Redressal Officer are provided below:
              </Text>

              <View style={styles.detailsBox}>
                <View style={styles.detailRow}>
                  <Text style={styles.label}>Designation:</Text>
                  <Text style={styles.value}>Grievance Redressal Officer</Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.label}>Email:</Text>
                  <TouchableOpacity onPress={handleEmailPress}>
                    <Text style={styles.linkValue}>grievance@docreaderapp.com</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.label}>Response SLA:</Text>
                  <Text style={styles.value}>Acknowledged within 24-48 hrs</Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.label}>Resolution SLA:</Text>
                  <Text style={styles.value}>Within 15 working days</Text>
                </View>
              </View>

              <View style={styles.noticeBox}>
                <Text style={styles.noticeText}>
                  🛡️ Local documents are processed entirely on-device and are never uploaded, collected, or shared with external servers.
                </Text>
              </View>

              <TouchableOpacity
                style={styles.closeBtn}
                activeOpacity={0.8}
                onPress={onClose}>
                <Text style={styles.closeBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: FigmaTheme.colors.card,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: FigmaTheme.colors.cardBorder,
    ...FigmaTheme.shadows.floating,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: FigmaTheme.colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  iconText: {
    fontSize: 22,
  },
  headerTextCol: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: FigmaTheme.colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: FigmaTheme.colors.textSecondary,
    marginTop: 2,
  },
  body: {
    fontSize: 13,
    lineHeight: 19,
    color: FigmaTheme.colors.textSecondary,
    marginBottom: 16,
  },
  detailsBox: {
    backgroundColor: FigmaTheme.colors.background,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: FigmaTheme.colors.cardBorder,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: FigmaTheme.colors.textSecondary,
  },
  value: {
    fontSize: 12,
    fontWeight: '500',
    color: FigmaTheme.colors.textPrimary,
  },
  linkValue: {
    fontSize: 12,
    fontWeight: '600',
    color: FigmaTheme.colors.primary,
    textDecorationLine: 'underline',
  },
  noticeBox: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    padding: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  noticeText: {
    fontSize: 12,
    color: '#1E40AF',
    lineHeight: 17,
  },
  closeBtn: {
    height: 46,
    backgroundColor: FigmaTheme.colors.primary,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});

