// Billing settings screen
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, spacing, fontSize, borderRadius } from '../../../theme';

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: 'forever',
    features: ['1 loved one', 'Push notifications only', 'Basic check-ins'],
  },
  {
    id: 'one_way',
    name: 'One-Way',
    price: '$9.99',
    period: '/month',
    features: ['Up to 3 loved ones', 'Push + WhatsApp + SMS', 'Email alerts'],
    recommended: true,
  },
  {
    id: 'two_way',
    name: 'Two-Way',
    price: '$14.99',
    period: '/month',
    features: ['Up to 5 loved ones', 'All channels + Voice', 'Mutual check-ins'],
  },
];

export default function BillingScreen() {
  const router = useRouter();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Back Button */}
      <Pressable onPress={() => router.back()} style={styles.backButton}>
        <Text style={styles.backButtonText}>← Back</Text>
      </Pressable>

      <Text style={styles.title}>Billing</Text>
      <Text style={styles.subtitle}>Choose a plan that works for you</Text>

      {/* Plans */}
      {PLANS.map((plan) => (
        <View
          key={plan.id}
          style={[styles.planCard, plan.recommended && styles.planCardRecommended]}
        >
          {plan.recommended && (
            <View style={styles.recommendedBadge}>
              <Text style={styles.recommendedText}>Recommended</Text>
            </View>
          )}
          <Text style={styles.planName}>{plan.name}</Text>
          <View style={styles.priceRow}>
            <Text style={styles.planPrice}>{plan.price}</Text>
            <Text style={styles.planPeriod}>{plan.period}</Text>
          </View>
          <View style={styles.features}>
            {plan.features.map((feature, idx) => (
              <Text key={idx} style={styles.feature}>
                ✓ {feature}
              </Text>
            ))}
          </View>
          <Pressable
            style={[
              styles.selectButton,
              plan.recommended && styles.selectButtonRecommended,
            ]}
          >
            <Text
              style={[
                styles.selectButtonText,
                plan.recommended && styles.selectButtonTextRecommended,
              ]}
            >
              {plan.id === 'free' ? 'Current Plan' : 'Upgrade'}
            </Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
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
    marginBottom: spacing.xl,
  },
  planCard: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  planCardRecommended: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  recommendedBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    alignSelf: 'flex-start',
    marginBottom: spacing.sm,
  },
  recommendedText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  planName: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginVertical: spacing.sm,
  },
  planPrice: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.text,
  },
  planPeriod: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginLeft: spacing.xs,
  },
  features: {
    marginVertical: spacing.md,
    gap: spacing.xs,
  },
  feature: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  selectButton: {
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  selectButtonRecommended: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  selectButtonText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  selectButtonTextRecommended: {
    color: colors.textOnPrimary,
  },
});
