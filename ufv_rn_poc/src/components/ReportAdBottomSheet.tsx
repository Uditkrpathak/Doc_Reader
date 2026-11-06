import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { FigmaTheme } from '../theme/FigmaTheme';

interface ReportAdBottomSheetProps {
  visible: boolean;
  adUnitId?: string;
  onClose: () => void;
  onSubmitSuccess?: () => void;
}

const REPORT_REASONS = [
  'Inappropriate or offensive content',
  'Scam, fraud, or phishing attempt',
  'App froze or crashed during the ad',
  'Misleading or clickbait advertisement',
  'Ad plays loud audio unexpectedly',
  'Ad cannot be closed or timer is stuck',
];

export const ReportAdBottomSheet: React.FC<ReportAdBottomSheetProps> = ({
  visible,
  adUnitId: _adUnitId,
  onClose,
  onSubmitSuccess,
}) => {
  const [selectedReason, setSelectedReason] = useState<string>(REPORT_REASONS[0]);
  const [comment, setComment] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitted, setSubmitted] = useState<boolean>(false);

  const handleSubmit = () => {
    setIsSubmitting(true);
    // Simulate safe report submission
    setTimeout(() => {
      setIsSubmitting(false);
      setSubmitted(true);
      setTimeout(() => {
        setSubmitted(false);
        setComment('');
        setSelectedReason(REPORT_REASONS[0]);
        if (onSubmitSuccess) onSubmitSuccess();
        onClose();
      }, 1500);
    }, 600);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.sheet}>
              <View style={styles.dragHandle} />

              {submitted ? (
                <View style={styles.successContainer}>
                  <View style={styles.successIconCircle}>
                    <Text style={styles.successIconText}>✓</Text>
                  </View>
                  <Text style={styles.successTitle}>Thank you for reporting</Text>
                  <Text style={styles.successSubtitle}>
                    We will review this ad placement to keep DocReader safe and reliable.
                  </Text>
                </View>
              ) : (
                <>
                  <Text style={styles.title}>Report this Advertisement</Text>
                  <Text style={styles.subtitle}>
                    Help us maintain high quality standards. No personal data or document info is shared.
                  </Text>

                  <Text style={styles.sectionLabel}>Select an issue:</Text>

                  {REPORT_REASONS.map((reason) => {
                    const isSelected = selectedReason === reason;
                    return (
                      <TouchableOpacity
                        key={reason}
                        style={[styles.reasonRow, isSelected && styles.reasonRowSelected]}
                        activeOpacity={0.7}
                        onPress={() => setSelectedReason(reason)}>
                        <View style={[styles.radioCircle, isSelected && styles.radioCircleSelected]}>
                          {isSelected && <View style={styles.radioDot} />}
                        </View>
                        <Text style={[styles.reasonText, isSelected && styles.reasonTextSelected]}>
                          {reason}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}

                  <TextInput
                    style={styles.commentInput}
                    placeholder="Additional details (optional)..."
                    placeholderTextColor={FigmaTheme.colors.textMuted}
                    value={comment}
                    onChangeText={setComment}
                    multiline
                    maxLength={200}
                  />

                  <View style={styles.buttonRow}>
                    <TouchableOpacity
                      style={styles.cancelBtn}
                      activeOpacity={0.7}
                      onPress={onClose}>
                      <Text style={styles.cancelBtnText}>Cancel</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.submitBtn, isSubmitting && styles.submitBtnDisabled]}
                      activeOpacity={0.8}
                      disabled={isSubmitting}
                      onPress={handleSubmit}>
                      {isSubmitting ? (
                        <ActivityIndicator color="#FFFFFF" size="small" />
                      ) : (
                        <Text style={styles.submitBtnText}>Submit Report</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              )}
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
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: FigmaTheme.colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    ...FigmaTheme.shadows.floating,
  },
  dragHandle: {
    width: 36,
    height: 4,
    backgroundColor: FigmaTheme.colors.cardBorder,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: FigmaTheme.colors.textPrimary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: FigmaTheme.colors.textSecondary,
    marginBottom: 16,
    lineHeight: 18,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: FigmaTheme.colors.textSecondary,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  reasonRowSelected: {
    backgroundColor: FigmaTheme.colors.primaryLight,
    borderColor: FigmaTheme.colors.primaryBorder,
  },
  radioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: FigmaTheme.colors.cardBorder,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  radioCircleSelected: {
    borderColor: FigmaTheme.colors.primary,
  },
  radioDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: FigmaTheme.colors.primary,
  },
  reasonText: {
    fontSize: 13,
    color: FigmaTheme.colors.textPrimary,
    flex: 1,
  },
  reasonTextSelected: {
    fontWeight: '600',
    color: FigmaTheme.colors.primaryDark,
  },
  commentInput: {
    backgroundColor: FigmaTheme.colors.background,
    borderWidth: 1,
    borderColor: FigmaTheme.colors.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 13,
    color: FigmaTheme.colors.textPrimary,
    minHeight: 64,
    textAlignVertical: 'top',
    marginTop: 10,
    marginBottom: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: FigmaTheme.colors.cardBorder,
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: FigmaTheme.colors.textSecondary,
  },
  submitBtn: {
    flex: 2,
    height: 48,
    borderRadius: 12,
    backgroundColor: FigmaTheme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  successContainer: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  successIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: FigmaTheme.colors.successBg,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  successIconText: {
    fontSize: 28,
    color: FigmaTheme.colors.success,
    fontWeight: '700',
  },
  successTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: FigmaTheme.colors.textPrimary,
    marginBottom: 6,
  },
  successSubtitle: {
    fontSize: 13,
    color: FigmaTheme.colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 20,
    lineHeight: 18,
  },
});

