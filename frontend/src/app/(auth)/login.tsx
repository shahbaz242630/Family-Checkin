// Login screen - Google, Apple, and Email authentication
import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, fontSize, borderRadius } from '../../theme';
import { SocialButton, TextInput, Button, Divider } from '../../components/auth';
import { useAuth } from '../../hooks/useAuth';

export default function LoginScreen() {
  const router = useRouter();
  const { signIn, signInGoogle, signInApple, loading, error, clearError } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const validateForm = (): boolean => {
    let valid = true;
    clearError();
    setEmailError('');
    setPasswordError('');

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
    }

    return valid;
  };

  const handleEmailSignIn = async () => {
    if (!validateForm()) return;

    const success = await signIn(email, password);
    if (success) {
      router.replace('/(main)');
    }
  };

  const handleGoogleSignIn = async () => {
    const success = await signInGoogle();
    if (success) {
      // OAuth will redirect automatically
    }
  };

  const handleAppleSignIn = async () => {
    const success = await signInApple();
    if (success) {
      // OAuth will redirect automatically
    }
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
            <Text style={styles.title}>Login to your account</Text>
          </View>

          {/* Social Buttons */}
          <View style={styles.socialButtons}>
            <SocialButton
              provider="google"
              onPress={handleGoogleSignIn}
              loading={loading}
              mode="signin"
            />
            <SocialButton
              provider="apple"
              onPress={handleAppleSignIn}
              loading={loading}
              mode="signin"
            />
          </View>

          {/* Divider */}
          <Divider text="or continue with email" />

          {/* Email Form */}
          <View style={styles.form}>
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

            <TextInput
              label="Password"
              placeholder="Enter your password"
              isPassword
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                setPasswordError('');
              }}
              error={passwordError}
            />

            {/* Forgot Password Link */}
            <Pressable
              style={styles.forgotPassword}
              onPress={() => router.push('/(auth)/forgot-password')}
            >
              <Text style={styles.forgotPasswordText}>Forgot password?</Text>
            </Pressable>

            {/* Error Message */}
            {error && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{error.message}</Text>
              </View>
            )}

            {/* Sign In Button */}
            <Button
              title="Sign in"
              onPress={handleEmailSignIn}
              loading={loading}
              disabled={!email || !password}
            />
          </View>

          {/* Sign Up Link */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account? </Text>
            <Pressable onPress={() => router.replace('/(auth)/signup')}>
              <Text style={styles.footerLink}>Sign up</Text>
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
  },
  socialButtons: {
    gap: spacing.md,
  },
  form: {
    gap: spacing.md,
  },
  forgotPassword: {
    alignSelf: 'flex-end',
  },
  forgotPasswordText: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: '500',
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
