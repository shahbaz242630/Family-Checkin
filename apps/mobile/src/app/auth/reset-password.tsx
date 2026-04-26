// Reset Password screen - Enter new password after clicking email link
import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import { colors, spacing, fontSize, borderRadius } from '../../theme';
import { TextInput, Button } from '../../components/auth';
import { supabase, handleAuthDeepLink } from '../../services/supabase';

export default function ResetPasswordScreen() {
  const router = useRouter();

  const [isValidating, setIsValidating] = useState(true);
  const [isValidSession, setIsValidSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Process the deep link to establish session
    const processResetLink = async () => {
      try {
        const url = await Linking.getInitialURL();

        if (url) {
          const result = await handleAuthDeepLink(url);

          if (result.success) {
            setIsValidSession(true);
          } else {
            setError(result.error || 'Invalid or expired reset link');
          }
        } else {
          // Check if we already have a valid session (user might have navigated here)
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            setIsValidSession(true);
          } else {
            setError('No valid session found. Please request a new password reset link.');
          }
        }
      } catch (err) {
        setError('Failed to process reset link');
      } finally {
        setIsValidating(false);
      }
    };

    processResetLink();
  }, []);

  const validateForm = (): boolean => {
    let valid = true;
    setPasswordError('');
    setConfirmError('');
    setError(null);

    if (!password) {
      setPasswordError('Password is required');
      valid = false;
    } else if (password.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      valid = false;
    }

    if (!confirmPassword) {
      setConfirmError('Please confirm your password');
      valid = false;
    } else if (password !== confirmPassword) {
      setConfirmError('Passwords do not match');
      valid = false;
    }

    return valid;
  };

  const handleResetPassword = async () => {
    if (!validateForm()) return;

    setLoading(true);
    setError(null);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: password,
      });

      if (updateError) {
        setError(updateError.message);
      } else {
        setSuccess(true);
        // Redirect to login after success
        setTimeout(() => {
          router.replace('/(auth)/login');
        }, 2000);
      }
    } catch (err) {
      setError('Failed to update password');
    } finally {
      setLoading(false);
    }
  };

  // Loading state while validating the reset link
  if (isValidating) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Validating reset link...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Error state - invalid or expired link
  if (!isValidSession && error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <View style={[styles.iconContainer, styles.errorIconContainer]}>
            <Text style={styles.iconText}>!</Text>
          </View>
          <Text style={styles.errorTitle}>Link Invalid</Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <Button
            title="Request new link"
            onPress={() => router.replace('/(auth)/forgot-password')}
            style={styles.actionButton}
          />
          <Button
            title="Back to login"
            onPress={() => router.replace('/(auth)/login')}
            variant="secondary"
          />
        </View>
      </SafeAreaView>
    );
  }

  // Success state
  if (success) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <View style={[styles.iconContainer, styles.successIconContainer]}>
            <Text style={styles.successIcon}>✓</Text>
          </View>
          <Text style={styles.successTitle}>Password Updated!</Text>
          <Text style={styles.successMessage}>
            Your password has been reset successfully. Redirecting to login...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Main form - enter new password
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
            <Text style={styles.title}>Create new password</Text>
            <Text style={styles.subtitle}>
              Enter a strong password for your account
            </Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <TextInput
              label="New Password"
              placeholder="Enter new password"
              isPassword
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                setPasswordError('');
              }}
              error={passwordError}
            />

            <View>
              <TextInput
                label="Confirm Password"
                placeholder="Confirm new password"
                isPassword
                value={confirmPassword}
                onChangeText={(text) => {
                  setConfirmPassword(text);
                  setConfirmError('');
                }}
                error={confirmError}
              />
              <Text style={styles.passwordHint}>
                Use 8+ characters with uppercase, lowercase, numbers & symbols
              </Text>
            </View>

            {/* Error Message */}
            {error && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Submit Button */}
            <Button
              title="Reset Password"
              onPress={handleResetPassword}
              loading={loading}
              disabled={!password || !confirmPassword}
            />
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
    flexGrow: 1,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  header: {
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
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
    lineHeight: 22,
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
  loadingText: {
    marginTop: spacing.lg,
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  errorIconContainer: {
    backgroundColor: colors.error + '15',
  },
  successIconContainer: {
    backgroundColor: colors.success + '15',
  },
  iconText: {
    fontSize: 36,
    fontWeight: 'bold',
    color: colors.error,
  },
  successIcon: {
    fontSize: 36,
    fontWeight: 'bold',
    color: colors.success,
  },
  errorTitle: {
    fontSize: fontSize.xl,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  errorMessage: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: 22,
  },
  successTitle: {
    fontSize: fontSize.xl,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  successMessage: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  actionButton: {
    marginBottom: spacing.md,
    width: '100%',
  },
});
