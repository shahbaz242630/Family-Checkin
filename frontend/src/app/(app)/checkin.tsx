import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, fontSize, borderRadius } from '../../theme';

export default function CheckinScreen() {
  const handleCheckin = async () => {
    // TODO: Implement check-in with Supabase
    console.log('Check-in confirmed!');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Daily Check-In</Text>
          <Text style={styles.subtitle}>Let your family know you're OK</Text>
        </View>

        <View style={styles.buttonContainer}>
          <Pressable style={styles.checkinButton} onPress={handleCheckin}>
            <Text style={styles.checkinButtonIcon}>✓</Text>
            <Text style={styles.checkinButtonText}>I'm OK</Text>
          </Pressable>
        </View>

        <View style={styles.options}>
          <Pressable style={styles.optionButton}>
            <Text style={styles.optionButtonText}>Remind me in 30 min</Text>
          </Pressable>
          <Pressable style={styles.optionButton}>
            <Text style={styles.optionButtonText}>I'm busy but OK</Text>
          </Pressable>
        </View>

        <Text style={styles.note}>
          Your family will be notified that you're safe
        </Text>
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
    flex: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },
  buttonContainer: {
    marginBottom: spacing.xl,
  },
  checkinButton: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: colors.safe,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.safe,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  checkinButtonIcon: {
    fontSize: 64,
    color: colors.textOnPrimary,
    marginBottom: spacing.sm,
  },
  checkinButtonText: {
    fontSize: fontSize.xl,
    fontWeight: 'bold',
    color: colors.textOnPrimary,
  },
  options: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  optionButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.backgroundSecondary,
    borderRadius: borderRadius.full,
  },
  optionButtonText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  note: {
    fontSize: fontSize.sm,
    color: colors.textLight,
    textAlign: 'center',
  },
});
