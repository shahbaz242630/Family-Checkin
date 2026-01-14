// Profile Setup screen - Step 1
import { View, Text, TextInput, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, fontSize, borderRadius } from '../../theme';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { StepHeader, StepProgress, PhoneInput, TimezoneSelect } from '../../components/onboarding';

export default function ProfileSetupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, updateProfile, setCurrentStep } = useOnboarding();

  const canContinue = data.profile.fullName.trim().length > 0 && data.profile.phone.trim().length > 0;

  const handleContinue = () => {
    setCurrentStep(2);
    router.push('/(onboarding)/add-loved-one');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StepProgress currentStep={1} totalSteps={5} />

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <StepHeader
          step={1}
          totalSteps={5}
          title="Tell us about yourself"
          subtitle="We'll use this to personalize your experience and send you important notifications."
          showBack={true}
        />

        {/* Full Name */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Full Name</Text>
          <TextInput
            style={styles.textInput}
            value={data.profile.fullName}
            onChangeText={(text) => updateProfile({ fullName: text })}
            placeholder="Enter your full name"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="words"
            autoCorrect={false}
          />
        </View>

        {/* Phone Number */}
        <PhoneInput
          label="Phone Number"
          value={data.profile.phone}
          countryCode={data.profile.countryCode}
          onChangePhone={(phone) => updateProfile({ phone })}
          onChangeCountryCode={(countryCode) => updateProfile({ countryCode })}
          placeholder="Enter phone number"
        />

        {/* Timezone */}
        <TimezoneSelect
          label="Your Timezone"
          value={data.profile.timezone}
          onChange={(timezone) => updateProfile({ timezone })}
          hint="We use this to schedule check-ins at the right time for you"
        />

        {/* Info Card */}
        <View style={styles.infoCard}>
          <Text style={styles.infoIcon}>💡</Text>
          <Text style={styles.infoText}>
            Your phone number will only be used to send you important alerts about your loved ones.
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
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.primary + '10',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.md,
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
