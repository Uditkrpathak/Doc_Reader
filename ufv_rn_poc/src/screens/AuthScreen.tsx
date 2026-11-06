import React, { useState } from 'react';
import {
  SafeAreaView,
  StatusBar,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { FigmaTheme } from '../theme/FigmaTheme';
import { EyeOutlineIcon, EyeOffOutlineIcon } from '../components/AppIcons';

export type AuthMode =
  | 'SIGN_IN'
  | 'SIGN_UP'
  | 'RESET_PASSWORD'
  | 'EMAIL_VERIFY'
  | 'DELETE_ACCOUNT_CONFIRM'
  | 'ACCOUNT_DELETED';

interface AuthScreenProps {
  initialMode?: AuthMode;
  onBack: () => void;
  onAuthSuccess?: (email: string) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  initialMode = 'SIGN_IN',
  onBack,
  onAuthSuccess,
}) => {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [otpCode, setOtpCode] = useState<string>('');
  const [consentChecked, setConsentChecked] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const handleSignIn = () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Required Fields', 'Please enter your email address and password.');
      return;
    }
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      Alert.alert('Signed In', `Welcome back, ${email}! Your coin wallet and entitlements are now synced.`);
      if (onAuthSuccess) onAuthSuccess(email);
      onBack();
    }, 1000);
  };

  const handleSignUp = () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Required Fields', 'Please enter your email and desired password.');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Weak Password', 'Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Password Mismatch', 'Confirm password does not match.');
      return;
    }
    if (!consentChecked) {
      Alert.alert('Consent Required', 'Please accept the DPDP Privacy Notice to proceed.');
      return;
    }

    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      setMode('EMAIL_VERIFY');
    }, 900);
  };

  const handleVerifyOtp = () => {
    if (otpCode.length < 6) {
      Alert.alert('Invalid Code', 'Please enter the 6-digit code sent to your email.');
      return;
    }
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      Alert.alert('Email Verified', 'Your account has been created and verified!');
      if (onAuthSuccess) onAuthSuccess(email);
      onBack();
    }, 900);
  };

  const handleDeleteAccount = () => {
    if (!password.trim()) {
      Alert.alert('Security Check', 'Please enter your password to confirm account deletion.');
      return;
    }
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      setMode('ACCOUNT_DELETED');
    }, 1000);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar hidden={true} />

      {/* Screen Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} activeOpacity={0.7} onPress={onBack}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {mode === 'SIGN_IN' && 'Sign In'}
          {mode === 'SIGN_UP' && 'Create Account'}
          {mode === 'RESET_PASSWORD' && 'Reset Password'}
          {mode === 'EMAIL_VERIFY' && 'Verify Email'}
          {mode === 'DELETE_ACCOUNT_CONFIRM' && 'Delete Account'}
          {mode === 'ACCOUNT_DELETED' && 'Account Deleted'}
        </Text>
        <View style={styles.headerRightSpace} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* MODE: SIGN IN */}
        {mode === 'SIGN_IN' && (
          <View style={styles.formContainer}>
            <Text style={styles.title}>Welcome Back</Text>
            <Text style={styles.subtitle}>
              Sign in to sync your coin wallet, ad-free passes, and preferences across devices.
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Email Address</Text>
              <TextInput
                style={styles.textInput}
                placeholder="name@example.com"
                placeholderTextColor={FigmaTheme.colors.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Password</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  style={styles.passwordInput}
                  placeholder="••••••••"
                  placeholderTextColor={FigmaTheme.colors.textMuted}
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                />
                <TouchableOpacity
                  style={styles.eyeBtn}
                  onPress={() => setShowPassword(!showPassword)}>
                  {showPassword ? <EyeOffOutlineIcon size={18} /> : <EyeOutlineIcon size={18} />}
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              style={styles.forgotPassBtn}
              onPress={() => setMode('RESET_PASSWORD')}>
              <Text style={styles.forgotPassText}>Forgot Password?</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.primaryBtn, isSubmitting && styles.btnDisabled]}
              activeOpacity={0.8}
              disabled={isSubmitting}
              onPress={handleSignIn}>
              {isSubmitting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.primaryBtnText}>Sign In</Text>
              )}
            </TouchableOpacity>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              style={styles.switchModeBtn}
              onPress={() => setMode('SIGN_UP')}>
              <Text style={styles.switchModeText}>
                Don't have an account? <Text style={styles.boldLink}>Sign Up</Text>
              </Text>
            </TouchableOpacity>

            <View style={styles.privacyNoteBox}>
              <Text style={styles.privacyNoteText}>
                🔒 <Text style={{ fontWeight: '700' }}>Your files stay on device.</Text> Signing in only syncs coins, receipts, and settings. Your documents are never uploaded to any cloud server.
              </Text>
            </View>
          </View>
        )}

        {/* MODE: SIGN UP */}
        {mode === 'SIGN_UP' && (
          <View style={styles.formContainer}>
            <Text style={styles.title}>Create Account</Text>
            <Text style={styles.subtitle}>
              Save your coins, track rewarded ads, and safeguard your ad-free passes.
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Email Address</Text>
              <TextInput
                style={styles.textInput}
                placeholder="name@example.com"
                placeholderTextColor={FigmaTheme.colors.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Password (8+ chars)</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  style={styles.passwordInput}
                  placeholder="At least 8 characters"
                  placeholderTextColor={FigmaTheme.colors.textMuted}
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                />
                <TouchableOpacity
                  style={styles.eyeBtn}
                  onPress={() => setShowPassword(!showPassword)}>
                  {showPassword ? <EyeOffOutlineIcon size={18} /> : <EyeOutlineIcon size={18} />}
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Confirm Password</Text>
              <TextInput
                style={styles.textInput}
                placeholder="Re-enter password"
                placeholderTextColor={FigmaTheme.colors.textMuted}
                secureTextEntry={!showPassword}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
            </View>

            {/* DPDP Consent Checkbox */}
            <TouchableOpacity
              style={styles.consentRow}
              activeOpacity={0.8}
              onPress={() => setConsentChecked(!consentChecked)}>
              <View style={[styles.checkboxBox, consentChecked && styles.checkboxBoxChecked]}>
                {consentChecked && <Text style={styles.checkboxTick}>✓</Text>}
              </View>
              <Text style={styles.consentLabel}>
                I accept the Terms of Service & acknowledge the DPDP Privacy Notice. I understand that my document files are kept strictly on my phone.
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.primaryBtn, (!consentChecked || isSubmitting) && styles.btnDisabled]}
              activeOpacity={0.8}
              disabled={!consentChecked || isSubmitting}
              onPress={handleSignUp}>
              {isSubmitting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.primaryBtnText}>Create Account</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.switchModeBtn}
              onPress={() => setMode('SIGN_IN')}>
              <Text style={styles.switchModeText}>
                Already have an account? <Text style={styles.boldLink}>Sign In</Text>
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* MODE: EMAIL VERIFY */}
        {mode === 'EMAIL_VERIFY' && (
          <View style={styles.formContainer}>
            <View style={styles.iconCenterCircle}>
              <Text style={{ fontSize: 28 }}>✉️</Text>
            </View>
            <Text style={[styles.title, { textAlign: 'center' }]}>Verify Your Email</Text>
            <Text style={[styles.subtitle, { textAlign: 'center', marginBottom: 20 }]}>
              We sent a 6-digit confirmation code to{' '}
              <Text style={{ fontWeight: '700', color: FigmaTheme.colors.textPrimary }}>
                {email || 'your email'}
              </Text>
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Enter 6-Digit Code</Text>
              <TextInput
                style={[styles.textInput, styles.otpInput]}
                placeholder="123456"
                placeholderTextColor={FigmaTheme.colors.textMuted}
                keyboardType="number-pad"
                maxLength={6}
                value={otpCode}
                onChangeText={setOtpCode}
              />
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, isSubmitting && styles.btnDisabled]}
              activeOpacity={0.8}
              disabled={isSubmitting}
              onPress={handleVerifyOtp}>
              {isSubmitting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.primaryBtnText}>Verify & Continue</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.switchModeBtn}
              onPress={() => Alert.alert('Code Resent', 'A fresh verification code was sent to your inbox.')}>
              <Text style={styles.switchModeText}>Didn't receive code? Resend (45s)</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* MODE: RESET PASSWORD */}
        {mode === 'RESET_PASSWORD' && (
          <View style={styles.formContainer}>
            <Text style={styles.title}>Reset Password</Text>
            <Text style={styles.subtitle}>
              Enter your registered email address and we'll send a password reset code.
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Registered Email</Text>
              <TextInput
                style={styles.textInput}
                placeholder="name@example.com"
                placeholderTextColor={FigmaTheme.colors.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, isSubmitting && styles.btnDisabled]}
              activeOpacity={0.8}
              disabled={isSubmitting}
              onPress={() => {
                Alert.alert('Reset Code Sent', 'Check your email for the reset instructions.');
                setMode('SIGN_IN');
              }}>
              <Text style={styles.primaryBtnText}>Send Reset Code</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.switchModeBtn}
              onPress={() => setMode('SIGN_IN')}>
              <Text style={styles.switchModeText}>Remember password? Sign In</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* MODE: DELETE ACCOUNT CONFIRM */}
        {mode === 'DELETE_ACCOUNT_CONFIRM' && (
          <View style={styles.formContainer}>
            <View style={styles.peachIconCircle}>
              <Text style={{ fontSize: 26, color: FigmaTheme.colors.warning }}>⚠</Text>
            </View>
            <Text style={[styles.title, { textAlign: 'center', color: FigmaTheme.colors.danger }]}>
              Permanent Account Deletion
            </Text>
            <Text style={[styles.subtitle, { textAlign: 'center', marginBottom: 16 }]}>
              Deleting your account will permanently wipe your coin balance, ad-free status, and account profile.
            </Text>

            {/* Play Store Subscription Notice */}
            <View style={styles.amberWarningCard}>
              <Text style={styles.amberTitle}>⚠️ Active Subscription Notice</Text>
              <Text style={styles.amberText}>
                Deleting your app account does NOT cancel an active Google Play subscription. Please cancel it in Google Play first to avoid future charges.
              </Text>
              <TouchableOpacity
                onPress={() => Linking.openURL('https://play.google.com/store/account/subscriptions')}>
                <Text style={styles.amberLink}>Open Google Play Subscriptions →</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Enter your password to confirm:</Text>
              <TextInput
                style={styles.textInput}
                placeholder="Your password"
                placeholderTextColor={FigmaTheme.colors.textMuted}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
            </View>

            <TouchableOpacity
              style={[styles.destructiveBtn, isSubmitting && styles.btnDisabled]}
              activeOpacity={0.8}
              disabled={isSubmitting}
              onPress={handleDeleteAccount}>
              {isSubmitting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.destructiveBtnText}>Permanently Delete My Account</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.switchModeBtn} onPress={onBack}>
              <Text style={styles.switchModeText}>Cancel and keep account</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* MODE: ACCOUNT DELETED */}
        {mode === 'ACCOUNT_DELETED' && (
          <View style={styles.formContainer}>
            <View style={[styles.iconCenterCircle, { backgroundColor: FigmaTheme.colors.successBg }]}>
              <Text style={{ fontSize: 28, color: FigmaTheme.colors.success, fontWeight: '700' }}>✓</Text>
            </View>
            <Text style={[styles.title, { textAlign: 'center' }]}>Account Deleted</Text>
            <Text style={[styles.subtitle, { textAlign: 'center', marginBottom: 20 }]}>
              Your account and cloud records have been permanently removed. Your documents on device storage remain safe and unaffected.
            </Text>

            <TouchableOpacity style={styles.primaryBtn} activeOpacity={0.8} onPress={onBack}>
              <Text style={styles.primaryBtnText}>Continue as Guest</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
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
    padding: 20,
    paddingBottom: 40,
  },
  formContainer: {
    backgroundColor: FigmaTheme.colors.card,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: FigmaTheme.colors.cardBorder,
    ...FigmaTheme.shadows.card,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: FigmaTheme.colors.textPrimary,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    color: FigmaTheme.colors.textSecondary,
    lineHeight: 18,
    marginBottom: 20,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: FigmaTheme.colors.textSecondary,
    marginBottom: 6,
  },
  textInput: {
    height: 48,
    backgroundColor: FigmaTheme.colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: FigmaTheme.colors.cardBorder,
    paddingHorizontal: 14,
    fontSize: 14,
    color: FigmaTheme.colors.textPrimary,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: FigmaTheme.colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: FigmaTheme.colors.cardBorder,
  },
  passwordInput: {
    flex: 1,
    height: 48,
    paddingHorizontal: 14,
    fontSize: 14,
    color: FigmaTheme.colors.textPrimary,
  },
  eyeBtn: {
    paddingHorizontal: 14,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  forgotPassBtn: {
    alignSelf: 'flex-end',
    marginBottom: 16,
  },
  forgotPassText: {
    fontSize: 13,
    fontWeight: '600',
    color: FigmaTheme.colors.primary,
  },
  primaryBtn: {
    height: 48,
    backgroundColor: FigmaTheme.colors.primary,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: FigmaTheme.colors.cardBorder,
  },
  dividerText: {
    marginHorizontal: 10,
    fontSize: 12,
    color: FigmaTheme.colors.textMuted,
  },
  switchModeBtn: {
    alignSelf: 'center',
    paddingVertical: 8,
  },
  switchModeText: {
    fontSize: 13,
    color: FigmaTheme.colors.textSecondary,
  },
  boldLink: {
    fontWeight: '700',
    color: FigmaTheme.colors.primary,
  },
  privacyNoteBox: {
    backgroundColor: FigmaTheme.colors.primaryLight,
    borderRadius: 10,
    padding: 12,
    marginTop: 16,
    borderWidth: 1,
    borderColor: FigmaTheme.colors.primaryBorder,
  },
  privacyNoteText: {
    fontSize: 12,
    color: FigmaTheme.colors.primaryDark,
    lineHeight: 17,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  checkboxBox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: FigmaTheme.colors.cardBorder,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    marginTop: 2,
  },
  checkboxBoxChecked: {
    backgroundColor: FigmaTheme.colors.primary,
    borderColor: FigmaTheme.colors.primary,
  },
  checkboxTick: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  consentLabel: {
    flex: 1,
    fontSize: 12,
    color: FigmaTheme.colors.textSecondary,
    lineHeight: 17,
  },
  iconCenterCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: FigmaTheme.colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 14,
  },
  otpInput: {
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 6,
  },
  peachIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: FigmaTheme.colors.warningBg,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 12,
  },
  amberWarningCard: {
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  amberTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
    marginBottom: 4,
  },
  amberText: {
    fontSize: 12,
    color: '#78350F',
    lineHeight: 17,
    marginBottom: 8,
  },
  amberLink: {
    fontSize: 12,
    fontWeight: '700',
    color: '#92400E',
    textDecorationLine: 'underline',
  },
  destructiveBtn: {
    height: 48,
    backgroundColor: FigmaTheme.colors.danger,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  destructiveBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});

