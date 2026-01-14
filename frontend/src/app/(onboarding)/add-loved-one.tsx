// Add Loved One screen - Step 2
import { View, Text, TextInput, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, fontSize, borderRadius } from '../../theme';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { StepHeader, StepProgress, PhoneInput, TimezoneSelect, SelectableOption } from '../../components/onboarding';
import { RELATIONSHIPS } from '../../data/constants';

export default function AddLovedOneScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, updateLovedOne, setCurrentStep } = useOnboarding();

  const canContinue =
    data.lovedOne.name.trim().length > 0 &&
    data.lovedOne.relationship.length > 0 &&
    data.lovedOne.phone.trim().length > 0;

  const handleContinue = () => {
    setCurrentStep(3);
    router.push('/(onboarding)/checkin-schedule');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StepProgress currentStep={2} totalSteps={5} />

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <StepHeader
          step={2}
          totalSteps={5}
          title="Who would you like to check in on?"
          subtitle="Add the first person you want to stay connected with. You can add more later."
        />

        {/* Name */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Their Name</Text>
          <TextInput
            style={styles.textInput}
            value={data.lovedOne.name}
            onChangeText={(text) => updateLovedOne({ name: text })}
            placeholder="Enter their name"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="words"
            autoCorrect={false}
          />
        </View>

        {/* Relationship */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Relationship</Text>
          <View style={styles.relationshipGrid}>
            {RELATIONSHIPS.map((rel) => (
              <Pressable
                key={rel.value}
                style={[
                  styles.relationshipChip,
                  data.lovedOne.relationship === rel.value && styles.relationshipChipSelected,
                ]}
                onPress={() => updateLovedOne({ relationship: rel.value })}
              >
                <Text
                  style={[
                    styles.relationshipChipText,
                    data.lovedOne.relationship === rel.value && styles.relationshipChipTextSelected,
                  ]}
                >
                  {rel.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Phone Number */}
        <PhoneInput
          label="Their Phone Number"
          value={data.lovedOne.phone}
          countryCode={data.lovedOne.countryCode}
          onChangePhone={(phone) => updateLovedOne({ phone })}
          onChangeCountryCode={(countryCode) => updateLovedOne({ countryCode })}
          placeholder="Enter their phone number"
        />

        {/* Timezone */}
        <TimezoneSelect
          label="Their Timezone"
          value={data.lovedOne.timezone}
          onChange={(timezone) => updateLovedOne({ timezone })}
          hint="This ensures check-ins arrive at a convenient time for them"
        />

        {/* Info Card */}
        <View style={styles.infoCard}>
          <Text style={styles.infoIcon}>💬</Text>
          <Text style={styles.infoText}>
            Your loved one will receive a simple message asking if they're okay. They just need to tap "I'm OK" to respond.
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
  relationshipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  relationshipChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  relationshipChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  relationshipChipText: {
    fontSize: fontSize.sm,
    color: colors.text,
    fontWeight: '500',
  },
  relationshipChipTextSelected: {
    color: '#FFFFFF',
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.primary + '10',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.md,
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
