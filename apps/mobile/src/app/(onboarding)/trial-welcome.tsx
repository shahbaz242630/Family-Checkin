// Trial Welcome screen - first screen after signup
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, fontSize, borderRadius } from '../../theme';
import { TRIAL_DAYS } from '../../data/constants';

export default function TrialWelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleGetStarted = () => {
    router.push('/(onboarding)/profile-setup');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.xl }]}>
      {/* Welcome Icon */}
      <View style={styles.iconContainer}>
        <Text style={styles.icon}>👋</Text>
      </View>

      {/* Welcome Text */}
      <Text style={styles.title}>Welcome to Family Check-in!</Text>
      <Text style={styles.subtitle}>
        Stay connected with your loved ones, no matter the distance.
      </Text>

      {/* Trial Badge */}
      <View style={styles.trialBadge}>
        <Text style={styles.trialIcon}>🎁</Text>
        <View style={styles.trialTextContainer}>
          <Text style={styles.trialTitle}>{TRIAL_DAYS}-Day Free Trial</Text>
          <Text style={styles.trialDescription}>
            No credit card required. Full access to all features.
          </Text>
        </View>
      </View>

      {/* Features List */}
      <View style={styles.featuresContainer}>
        <Text style={styles.featuresTitle}>What you can do:</Text>
        <View style={styles.featureItem}>
          <Text style={styles.featureIcon}>✓</Text>
          <Text style={styles.featureText}>Schedule daily check-ins with loved ones</Text>
        </View>
        <View style={styles.featureItem}>
          <Text style={styles.featureIcon}>✓</Text>
          <Text style={styles.featureText}>Get notified if they don't respond</Text>
        </View>
        <View style={styles.featureItem}>
          <Text style={styles.featureIcon}>✓</Text>
          <Text style={styles.featureText}>Set up emergency escalation plans</Text>
        </View>
        <View style={styles.featureItem}>
          <Text style={styles.featureIcon}>✓</Text>
          <Text style={styles.featureText}>Peace of mind, every single day</Text>
        </View>
      </View>

      {/* CTA Button */}
      <View style={styles.bottomContainer}>
        <Pressable style={styles.ctaButton} onPress={handleGetStarted}>
          <Text style={styles.ctaButtonText}>Let's Get You Set Up</Text>
          <Text style={styles.ctaArrow}>→</Text>
        </Pressable>

        <Text style={styles.setupTime}>Takes about 2 minutes</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  icon: {
    fontSize: 64,
  },
  title: {
    fontSize: fontSize.xxl || 28,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: 24,
  },
  trialBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary + '15',
    borderWidth: 1,
    borderColor: colors.primary + '30',
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.xl,
    gap: spacing.md,
  },
  trialIcon: {
    fontSize: 32,
  },
  trialTextContainer: {
    flex: 1,
  },
  trialTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.primary,
    marginBottom: 2,
  },
  trialDescription: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  featuresContainer: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  featuresTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.md,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  featureIcon: {
    fontSize: fontSize.md,
    color: colors.success,
    fontWeight: 'bold',
  },
  featureText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  bottomContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: spacing.xl,
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: spacing.md + 4,
    borderRadius: borderRadius.lg,
    gap: spacing.sm,
  },
  ctaButtonText: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  ctaArrow: {
    fontSize: fontSize.lg,
    color: '#FFFFFF',
  },
  setupTime: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
