import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { FigmaTheme } from '../theme/FigmaTheme';
import { LockOutlineIcon, EyeOutlineIcon, EyeOffOutlineIcon } from './AppIcons';

interface PasswordModalProps {
  visible: boolean;
  fileName: string;
  errorMsg?: string | null;
  isLoading?: boolean;
  onUnlock: (password: string) => void;
  onCancel: () => void;
}

export const PasswordModal: React.FC<PasswordModalProps> = ({
  visible,
  fileName,
  errorMsg,
  isLoading = false,
  onUnlock,
  onCancel,
}) => {
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [hasSubmitted, setHasSubmitted] = useState<boolean>(false);

  useEffect(() => {
    if (visible) {
      setPassword('');
      setShowPassword(false);
      setHasSubmitted(false);
    }
  }, [visible]);

  const handleUnlock = () => {
    setHasSubmitted(true);
    if (password.trim().length > 0) {
      onUnlock(password);
    }
  };

  const handleCancel = () => {
    setPassword('');
    setHasSubmitted(false);
    onCancel();
  };

  const isError = Boolean(errorMsg || (hasSubmitted && password.length === 0));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleCancel}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={handleCancel}
        />

        {/* Figma Screen 3 & 4: Password Protection Card / Sheet */}
        <View style={styles.sheetContainer}>
          {/* Top handle pill */}
          <View style={styles.sheetHandle} />

          {/* Centered Light Blue Lock Badge */}
          <View style={styles.lockBadgeCircle}>
            <LockOutlineIcon size={20} color={FigmaTheme.colors.primary} />
          </View>

          {/* Title & Subtitle */}
          <Text style={styles.title}>This PDF is password protected</Text>
          <Text style={styles.subtitle}>
            Enter the password to open {fileName || 'this file'}. It stays on your device.
          </Text>

          {/* Password Input Box with Eye Toggle */}
          <View
            style={[
              styles.inputWrapper,
              isError && styles.inputWrapperError,
            ]}>
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor="#94A3B8"
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                if (hasSubmitted) setHasSubmitted(false);
              }}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleUnlock}
            />

            <TouchableOpacity
              style={styles.eyeBtn}
              activeOpacity={0.7}
              onPress={() => setShowPassword(!showPassword)}>
              {showPassword ? (
                <EyeOffOutlineIcon size={19} color="#64748B" />
              ) : (
                <EyeOutlineIcon size={19} color="#64748B" />
              )}
            </TouchableOpacity>
          </View>

          {/* Figma Screen 5: Incorrect Password Warning */}
          {isError && (
            <View style={styles.errorRow}>
              <Text style={styles.errorIcon}>⚠</Text>
              <Text style={styles.errorText}>
                {errorMsg || "That password isn't right. Try again."}
              </Text>
            </View>
          )}

          {/* Action Buttons: Cancel and Open */}
          <View style={styles.buttonsRow}>
            <TouchableOpacity
              style={styles.cancelBtn}
              activeOpacity={0.7}
              onPress={handleCancel}
              disabled={isLoading}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.openBtn,
                (!password || isLoading) && styles.openBtnDisabled,
              ]}
              activeOpacity={0.8}
              onPress={handleUnlock}
              disabled={!password || isLoading}>
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.openBtnText}>Open</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: Platform.OS === 'android' ? 28 : 40,
    alignItems: 'center',
    ...FigmaTheme.shadows.card,
  },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E2E8F0',
    marginBottom: 20,
  },
  lockBadgeCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 22,
    maxWidth: 290,
  },
  inputWrapper: {
    width: '100%',
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  inputWrapperError: {
    borderColor: '#DC2626',
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#0F172A',
    paddingVertical: 0,
    letterSpacing: 2,
  },
  eyeBtn: {
    padding: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 2,
  },
  errorIcon: {
    fontSize: 13,
    color: '#DC2626',
  },
  errorText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#DC2626',
  },
  buttonsRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 12,
    marginTop: 22,
  },
  cancelBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    borderWidth: 1.2,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  openBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    backgroundColor: FigmaTheme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    ...FigmaTheme.shadows.card,
  },
  openBtnDisabled: {
    opacity: 0.6,
  },
  openBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
