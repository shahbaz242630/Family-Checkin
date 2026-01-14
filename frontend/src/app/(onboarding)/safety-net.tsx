// Safety Net (Escalation) screen - Step 4
import { View, Text, TextInput, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, fontSize, borderRadius } from '../../theme';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { StepHeader, StepProgress, SelectableOption, PhoneInput } from '../../components/onboarding';
import { WAIT_TIMES, ESCALATION_ACTIONS } from '../../data/constants';

export default function SafetyNetScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, updateEscalation, setCurrentStep } = useOnboarding();

  const needsEmergencyContact =
    data.escalation.action === 'call_emergency' || data.escalation.action === 'both';

  const canContinue =
    !needsEmergencyContact ||
    (data.escalation.emergencyContact.name.trim().length > 0 &&
      data.escalation.emergencyContact.phone.trim().length > 0);

  const handleContinue = () => {
    setCurrentStep(5);
    router.push('/(onboarding)/all-set');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StepProgress currentStep={4} totalSteps={5} />

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <StepHeader
          step={4}
          totalSteps={5}
          title="Set up your safety net"
          subtitle="What should happen if your loved one doesn't respond to a check-in?"
        />

        {/* Wait Time */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>How long should we wait?</Text>
          <Text style={styles.sectionHint}>Before taking action if they don't respond</Text>
          <View style={styles.optionsList}>
            {WAIT_TIMES.map((wait) => (
              <SelectableOption
                key={wait.value}
                label={wait.label}
                selected={data.escalation.waitTime === wait.value}
                onPress={() => updateEscalation({ waitTime: wait.value as any })}
              />
            ))}
          </View>
        </View>

        {/* Escalation Action */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What should we do?</Text>
          <View style={styles.optionsList}>
            {ESCALATION_ACTIONS.map((action) => (
              <SelectableOption
                key={action.value}
                label={action.label}
                description={action.description}
                selected={data.escalation.action === action.value}
                onPress={() => updateEscalation({ action: action.value as any })}
              />
            ))}
          </View>
        </View>

        {/* Emergency Contact (conditional) */}
        {needsEmergencyContact && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Emergency Contact</Text>
            <Text style={styles.sectionHint}>Who should we notify if there's no response?</Text>

            {/* Name */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Contact Name</Text>
              <TextInput
                style={styles.textInput}
                value={data.escalation.emergencyContact.name}
                onChangeText={(name) =>
                  updateEscalation({
                    emergencyContact: { ...data.escalation.emergencyContact, name },
                  })
                }
                placeholder="Enter contact name"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="words"
              />
            </View>

            {/* Phone */}
            <PhoneInput
              label="Contact Phone"
              value={data.escalation.emergencyContact.phone}
              countryCode={data.escalation.emergencyContact.countryCode}
              onChangePhone={(phone) =>
                updateEscalation({
                  emergencyContact: { ...data.escalation.emergencyContact, phone },
                })
              }
              onChangeCountryCode={(countryCode) =>
                updateEscalation({
                  emergencyContact: { ...data.escalation.emergencyContact, countryCode },
                })
              }
              placeholder="Enter phone number"
            />
          </View>
        )}

        {/* Info Card */}
        <View style={styles.infoCard}>
          <Text style={styles.infoIcon}>🛡️</Text>
          <Text style={styles.infoText}>
            We'll only escalate if there's genuinely no response. Your loved one can easily respond with just one tap.
          </Text>
        </View>
      </ScrollView>

      {/* Continue Button */}
      <View style={[styles.bottomContainer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable
          style={[styles.continueButton, !canContinue && styles.continueButtonDisabled]}
          onPress={handleContinue}
          disabled={!canContinue}
        >
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
  inputGroup: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  textInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
    color: colors.text,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.success + '15',
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
  continueButtonDisabled: {
    backgroundColor: colors.border,
  },
  continueButtonText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
