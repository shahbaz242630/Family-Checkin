// Step header with title, subtitle, and back button
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, spacing, fontSize } from '../../theme';

interface StepHeaderProps {
  step: number;
  totalSteps: number;
  title: string;
  subtitle: string;
  showBack?: boolean;
}

export function StepHeader({ step, totalSteps, title, subtitle, showBack = true }: StepHeaderProps) {
  const router = useRouter();

  return (
    <View style={styles.container}>
      {/* Back Button & Step Counter */}
      <View style={styles.topRow}>
        {showBack ? (
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backText}>← Back</Text>
          </Pressable>
        ) : (
          <View />
        )}
        <Text style={styles.stepCounter}>
          Step {step} of {totalSteps}
        </Text>
      </View>

      {/* Title & Subtitle */}
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.lg,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  backButton: {
    paddingVertical: spacing.xs,
  },
  backText: {
    fontSize: fontSize.md,
    color: colors.primary,
  },
  stepCounter: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontWeight: '500',
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
});
