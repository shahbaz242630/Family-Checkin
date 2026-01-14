// Check-in Schedule screen - Step 3
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, fontSize, borderRadius } from '../../theme';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { StepHeader, StepProgress, SelectableOption } from '../../components/onboarding';
import { CHECKIN_FREQUENCIES, TIME_OF_DAY, CHECKIN_METHODS } from '../../data/constants';

export default function CheckinScheduleScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, updateSchedule, setCurrentStep } = useOnboarding();

  const handleContinue = () => {
    setCurrentStep(4);
    router.push('/(onboarding)/safety-net');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StepProgress currentStep={3} totalSteps={5} />

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <StepHeader
          step={3}
          totalSteps={5}
          title="Set up your check-in schedule"
          subtitle="Choose how often and when you'd like to check in on your loved one."
        />

        {/* Frequency */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>How often?</Text>
          <View style={styles.optionsList}>
            {CHECKIN_FREQUENCIES.map((freq) => (
              <SelectableOption
                key={freq.value}
                label={freq.label}
                description={freq.description}
                selected={data.schedule.frequency === freq.value}
                onPress={() => updateSchedule({ frequency: freq.value as any })}
              />
            ))}
          </View>
        </View>

        {/* Time of Day */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Best time of day?</Text>
          <Text style={styles.sectionHint}>Based on your loved one's timezone</Text>
          <View style={styles.optionsList}>
            {TIME_OF_DAY.map((time) => (
              <SelectableOption
                key={time.value}
                label={time.label}
                description={time.timeRange}
                selected={data.schedule.timeOfDay === time.value}
                onPress={() => updateSchedule({
                  timeOfDay: time.value as any,
                  specificTime: time.defaultTime
                })}
              />
            ))}
          </View>
        </View>

        {/* Method */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>How should we reach them?</Text>
          <View style={styles.optionsList}>
            {CHECKIN_METHODS.map((method) => (
              <SelectableOption
                key={method.value}
                icon={method.icon}
                label={method.label}
                description={method.description}
                selected={data.schedule.method === method.value}
                onPress={() => updateSchedule({ method: method.value as any })}
              />
            ))}
          </View>
        </View>

        {/* Info Card */}
        <View style={styles.infoCard}>
          <Text style={styles.infoIcon}>📲</Text>
          <Text style={styles.infoText}>
            Your loved one will receive a friendly message with a simple "I'm OK" button. No app needed for SMS or WhatsApp.
          </Text>
        </View>
      </ScrollView>

      {/* Continue Button */}
      <View style={[styles.bottomContainer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable style={styles.continueButton} onPress={handleContinue}>
          <Text style={styles.continueButtonText}>Continue</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  sectionHint: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  optionsList: {
    gap: spacing.sm,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.primary + '10',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  infoIcon: {
    fontSize: 18,
  },
  infoText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  bottomContainer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  continueButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
  },
  continueButtonText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
