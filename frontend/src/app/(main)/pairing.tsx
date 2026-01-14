// Pairing screen - add new loved ones via code or invite
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../../theme';

export default function PairingScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Add a Loved One</Text>
      <Text style={styles.subtitle}>
        Connect with family members to start checking in on each other
      </Text>

      {/* Generate Code Option */}
      <View style={styles.optionCard}>
        <Text style={styles.optionIcon}>🔢</Text>
        <Text style={styles.optionTitle}>Generate Pairing Code</Text>
        <Text style={styles.optionDescription}>
          Create a 6-digit code for your loved one to enter in their app
        </Text>
        <Pressable style={styles.optionButton}>
          <Text style={styles.optionButtonText}>Generate Code</Text>
        </Pressable>
      </View>

      {/* Enter Code Option */}
      <View style={styles.optionCard}>
        <Text style={styles.optionIcon}>📱</Text>
        <Text style={styles.optionTitle}>Enter Pairing Code</Text>
        <Text style={styles.optionDescription}>
          Have a code from a family member? Enter it here to connect
        </Text>
        <Pressable style={[styles.optionButton, styles.optionButtonSecondary]}>
          <Text style={styles.optionButtonTextSecondary}>Enter Code</Text>
        </Pressable>
      </View>

      {/* Invite Option */}
      <View style={styles.optionCard}>
        <Text style={styles.optionIcon}>✉️</Text>
        <Text style={styles.optionTitle}>Send Invite</Text>
        <Text style={styles.optionDescription}>
          Invite someone via SMS or WhatsApp to download the app
        </Text>
        <Pressable style={[styles.optionButton, styles.optionButtonSecondary]}>
          <Text style={styles.optionButtonTextSecondary}>Send Invite</Text>
        </Pressable>
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
  optionCard: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  optionIcon: {
    fontSize: 32,
    marginBottom: spacing.md,
  },
  optionTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  optionDescription: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  optionButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  optionButtonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  optionButtonText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  optionButtonTextSecondary: {
    color: colors.primary,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
});
