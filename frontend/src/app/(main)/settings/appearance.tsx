// Appearance settings screen
import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, spacing, fontSize, borderRadius } from '../../../theme';

type ThemeOption = 'light' | 'dark' | 'system';

const THEME_OPTIONS: { id: ThemeOption; label: string; icon: string }[] = [
  { id: 'light', label: 'Light', icon: '☀️' },
  { id: 'dark', label: 'Dark', icon: '🌙' },
  { id: 'system', label: 'System', icon: '⚙️' },
];

export default function AppearanceScreen() {
  const router = useRouter();
  const [selectedTheme, setSelectedTheme] = useState<ThemeOption>('system');

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Back Button */}
      <Pressable onPress={() => router.back()} style={styles.backButton}>
        <Text style={styles.backButtonText}>← Back</Text>
      </Pressable>

      <Text style={styles.title}>Appearance</Text>
      <Text style={styles.subtitle}>Customize how the app looks</Text>

      {/* Theme Options */}
      <Text style={styles.sectionTitle}>Theme</Text>
      <View style={styles.options}>
        {THEME_OPTIONS.map((option) => (
          <Pressable
            key={option.id}
            style={[
              styles.optionCard,
              selectedTheme === option.id && styles.optionCardSelected,
            ]}
            onPress={() => setSelectedTheme(option.id)}
          >
            <Text style={styles.optionIcon}>{option.icon}</Text>
            <Text
              style={[
                styles.optionLabel,
                selectedTheme === option.id && styles.optionLabelSelected,
              ]}
            >
              {option.label}
            </Text>
            {selectedTheme === option.id && (
              <Text style={styles.checkmark}>✓</Text>
            )}
          </Pressable>
        ))}
      </View>

      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          System theme will automatically switch between light and dark based on your device settings
        </Text>
      </View>
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
  sectionTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.md,
  },
  options: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optionCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '10',
  },
  optionIcon: {
    fontSize: 24,
    marginRight: spacing.md,
  },
  optionLabel: {
    flex: 1,
    fontSize: fontSize.md,
    color: colors.text,
  },
  optionLabelSelected: {
    fontWeight: '600',
    color: colors.primary,
  },
  checkmark: {
    fontSize: fontSize.lg,
    color: colors.primary,
    fontWeight: 'bold',
  },
  infoBox: {
    backgroundColor: colors.primary + '10',
    padding: spacing.md,
    borderRadius: borderRadius.md,
  },
  infoText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
});
