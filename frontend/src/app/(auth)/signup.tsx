// Signup screen - Google, Apple, and Email registration
import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, fontSize, borderRadius } from '../../theme';
import { SocialButton, TextInput, Button, Divider } from '../../components/auth';
import { useAuth } from '../../hooks/useAuth';

export default function SignupScreen() {
  const router = useRouter();
  const { signUp, signInGoogle, signInApple, loading, error, clearError } = useAuth();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nameError, setNameError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const validateForm = (): boolean => {
    let valid = true;
    clearError();
    setNameError('');
    setEmailError('');
    setPasswordError('');

    if (!fullName || fullName.length < 2) {
      setNameError('Please enter your name');
      valid = false;
    }

    if (!email) {
      setEmailError('Email is required');
      valid = false;
    } else if (!email.includes('@')) {
      setEmailError('Please enter a valid email');
      valid = false;
    }

    if (!password) {
      setPasswordError('Password is required');
      valid = false;
    } else if (password.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      valid = false;
    }

    return valid;
  };

  const handleEmailSignUp = async () => {
    if (!validateForm()) return;

    const success = await signUp(email, password, fullName);
    if (success) {
      // Go to main app dashboard
      router.replace('/(main)');
    }
  };

  const handleGoogleSignUp = async () => {
    const success = await signInGoogle();
    if (success) {
      // OAuth will redirect automatically
    }
  };

  const handleAppleSignUp = async () => {
    const success = await signInApple();
    if (success) {
      // OAuth will redirect automatically
    }
  };

  const openPrivacyPolicy = () => {
    // TODO: Replace with actual privacy policy URL
    Linking.openURL('https://familycheckin.app/privacy');
  };

  const openTermsOfService = () => {
    // TODO: Replace with actual terms URL
    Linking.openURL('https://familycheckin.app/terms');
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} style={styles.backButton}>
              <Text style={styles.backButtonText}>← Back</Text>
            </Pressable>
            <Text style={styles.title}>Create your account</Text>
            <Text style={styles.subtitle}>
              Join thousands securing their loved ones
            </Text>
          </View>

          {/* Social Buttons */}
          <View style={styles.socialButtons}>
            <SocialButton
              provider="google"
              onPress={handleGoogleSignUp}
              loading={loading}
              mode="signup"
            />
            <SocialButton
              provider="apple"
              onPress={handleAppleSignUp}
              loading={loading}
              mode="signup"
            />
          </View>

          {/* Divider */}
          <Divider text="or continue with email" />

          {/* Email Form */}
          <View style={styles.form}>
            <TextInput
              label="Full Name"
              placeholder="Your name"
              autoCapitalize="words"
              value={fullName}
              onChangeText={(text) => {
                setFullName(text);
                setNameError('');
              }}
              error={nameError}
            />

            <TextInput
              label="Email"
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                setEmailError('');
              }}
              error={emailError}
            />

            <View>
              <TextInput
                label="Password"
                placeholder="Create a strong password"
                isPassword
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  setPasswordError('');
                }}
                error={passwordError}
              />
              <Text style={styles.passwordHint}>
                Use 8+ characters with uppercase, lowercase, numbers & symbols
              </Text>
            </View>

            {/* Error Message */}
            {error && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{error.message}</Text>
              </View>
            )}

            {/* Create Account Button */}
            <Button
              title="Create account"
              onPress={handleEmailSignUp}
              loading={loading}
              disabled={!fullName || !email || !password}
            />

            {/* Terms & Privacy */}
            <View style={styles.termsContainer}>
              <Text style={styles.termsText}>
                By creating an account, you agree to our{' '}
              </Text>
              <View style={styles.termsLinks}>
                <Pressable onPress={openTermsOfService}>
                  <Text style={styles.termsLink}>Terms of Service</Text>
                </Pressable>
                <Text style={styles.termsText}> and </Text>
                <Pressable onPress={openPrivacyPolicy}>
                  <Text style={styles.termsLink}>Privacy Policy</Text>
                </Pressable>
              </View>
            </View>
          </View>

          {/* Login Link */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <Pressable onPress={() => router.replace('/(auth)/login')}>
              <Text style={styles.footerLink}>Sign in</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  header: {
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },
  backButton: {
    marginBottom: spacing.lg,
  },
  backButtonText: {
    color: colors.primary,
    fontSize: fontSize.md,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },
  socialButtons: {
    gap: spacing.md,
  },
  form: {
    gap: spacing.md,
  },
  passwordHint: {
    fontSize: fontSize.xs,
    color: colors.textLight,
    marginTop: spacing.xs,
  },
  errorContainer: {
    backgroundColor: colors.error + '10',
    padding: spacing.md,
    borderRadius: borderRadius.md,
  },
  errorText: {
    color: colors.error,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  termsContainer: {
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  termsText: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  termsLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  termsLink: {
    fontSize: fontSize.xs,
    color: colors.primary,
    fontWeight: '500',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  footerText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
  },
  footerLink: {
    color: colors.primary,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
});
