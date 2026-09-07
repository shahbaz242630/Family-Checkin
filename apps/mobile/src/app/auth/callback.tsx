// Auth callback screen - shows the outcome of the deep link the root layout already processed (CB-029)
import { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { DEEP_LINK_SETTLE_MS } from '../../hooks/useDeepLinks';
import { colors, spacing } from '../../theme';

export default function AuthCallbackScreen() {
  const router = useRouter();
  // `useDeepLinks` in the root layout is the only thing that reads the URL and calls `handleAuthDeepLink`.
  // This screen only renders what it is told, so a confirmation that succeeded can never be processed a
  // second time here and flash "Verification Failed".
  const params = useLocalSearchParams<{ status?: string; message?: string }>();
  const status: 'processing' | 'success' | 'error' =
    params.status === 'success' ? 'success' : params.status === 'error' ? 'error' : 'processing';
  const errorMessage = params.message || 'Authentication failed';

  useEffect(() => {
    if (status === 'success') {
      // Navigate to main app after successful auth
      const timer = setTimeout(() => {
        router.replace('/(main)');
      }, 1500);
      return () => clearTimeout(timer);
    }

    // On an error, back to login after showing it. While still processing, the handler has the link in
    // flight and will re-render this screen with a status; if nothing arrives (direct navigation), fall
    // back to login the way this screen used to when there was no URL.
    const timer = setTimeout(
      () => {
        router.replace('/(auth)/login');
      },
      status === 'error' ? 3000 : DEEP_LINK_SETTLE_MS,
    );
    return () => clearTimeout(timer);
  }, [status, router]);

  return (
    <View style={styles.container}>
      {status === 'processing' && (
        <>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.title}>Verifying your email...</Text>
          <Text style={styles.subtitle}>Please wait while we confirm your account</Text>
        </>
      )}

      {status === 'success' && (
        <>
          <View style={styles.iconContainer}>
            <Text style={styles.successIcon}>✓</Text>
          </View>
          <Text style={styles.title}>Email Verified!</Text>
          <Text style={styles.subtitle}>Redirecting you to the app...</Text>
        </>
      )}

      {status === 'error' && (
        <>
          <View style={[styles.iconContainer, styles.errorIconContainer]}>
            <Text style={styles.errorIcon}>✕</Text>
          </View>
          <Text style={styles.title}>Verification Failed</Text>
          <Text style={styles.subtitle}>{errorMessage}</Text>
          <Text style={styles.redirectText}>Redirecting to login...</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: spacing.xl,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.success,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  errorIconContainer: {
    backgroundColor: colors.error,
  },
  successIcon: {
    fontSize: 40,
    color: colors.textOnPrimary,
    fontWeight: 'bold',
  },
  errorIcon: {
    fontSize: 40,
    color: colors.textOnPrimary,
    fontWeight: 'bold',
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.text,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  redirectText: {
    fontSize: 14,
    color: colors.textLight,
    marginTop: spacing.lg,
  },
});
