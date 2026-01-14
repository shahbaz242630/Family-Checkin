import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, fontSize, borderRadius } from '../../theme';
import type { RelationshipType } from '../../../../shared/types';

const RELATIONSHIP_OPTIONS: { type: RelationshipType; label: string; icon: string }[] = [
  { type: 'mother', label: 'Mother', icon: '👩' },
  { type: 'father', label: 'Father', icon: '👨' },
  { type: 'partner', label: 'Partner', icon: '💑' },
  { type: 'child', label: 'Child', icon: '👶' },
  { type: 'brother', label: 'Brother', icon: '👦' },
  { type: 'sister', label: 'Sister', icon: '👧' },
  { type: 'relative', label: 'Relative', icon: '👪' },
  { type: 'other', label: 'Other', icon: '👤' },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const [selectedRelationship, setSelectedRelationship] = useState<RelationshipType | null>(null);

  const handleContinue = () => {
    if (!selectedRelationship) return;

    // TODO: Store selection and proceed to next step
    console.log('Selected relationship:', selectedRelationship);

    // For now, go to main app
    router.replace('/(app)/home');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Who do you want to check in on?</Text>
          <Text style={styles.subtitle}>
            Select the relationship type. You can add more people later.
          </Text>
        </View>

        <View style={styles.grid}>
          {RELATIONSHIP_OPTIONS.map((option) => (
            <Pressable
              key={option.type}
              style={[
                styles.option,
                selectedRelationship === option.type && styles.optionSelected,
              ]}
              onPress={() => setSelectedRelationship(option.type)}
            >
              <Text style={styles.optionIcon}>{option.icon}</Text>
              <Text
                style={[
                  styles.optionLabel,
                  selectedRelationship === option.type && styles.optionLabelSelected,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={[styles.button, !selectedRelationship && styles.buttonDisabled]}
          onPress={handleContinue}
          disabled={!selectedRelationship}
        >
          <Text style={styles.buttonText}>Continue</Text>
        </Pressable>

        <Pressable
          style={styles.skipButton}
          onPress={() => router.replace('/(app)/home')}
        >
          <Text style={styles.skipButtonText}>Skip for now</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  header: {
    marginBottom: spacing.xl,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  option: {
    width: '47%',
    backgroundColor: colors.backgroundSecondary,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  optionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight + '20',
  },
  optionIcon: {
    fontSize: 40,
    marginBottom: spacing.sm,
  },
  optionLabel: {
    fontSize: fontSize.md,
    fontWeight: '500',
    color: colors.text,
  },
  optionLabelSelected: {
    color: colors.primary,
  },
  footer: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  button: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: colors.disabled,
  },
  buttonText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  skipButton: {
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  skipButtonText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
  },
});
