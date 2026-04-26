// Auth callback screen - handles deep links from Supabase email confirmations
import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import { handleAuthDeepLink } from '../../services/supabase';
import { colors, spacing } from '../../theme';

export default function AuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    const processAuthCallback = async () => {
      try {
        // Get the full URL that opened the app
        const url = await Linking.getInitialURL();

        if (url) {
          const result = await handleAuthDeepLink(url);

          if (result.success) {
            setStatus('success');
            // Navigate to main app after successful auth
            setTimeout(() => {
              router.replace('/(main)');
            }, 1500);
          } else {
            setStatus('error');
            setErrorMessage(result.error || 'Authentication failed');
            // Navigate back to login after showing error
            setTimeout(() => {
              router.replace('/(auth)/login');
            }, 3000);
          }
        } else {
          // No URL, might be direct navigation - redirect to login
          router.replace('/(auth)/login');
        }
      } catch (error) {
        console.error('Auth callback error:', error);
        setStatus('error');
        setErrorMessage('An unexpected error occurred');
        setTimeout(() => {
          router.replace('/(auth)/login');
        }, 3000);
      }
    };

    processAuthCallback();
  }, []);

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
