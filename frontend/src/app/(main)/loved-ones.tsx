// Loved Ones screen - manage family members
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { colors, spacing, fontSize } from '../../theme';

export default function LovedOnesScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.emptyState}>
        <Text style={styles.emptyIcon}>👨‍👩‍👧‍👦</Text>
        <Text style={styles.emptyTitle}>No loved ones yet</Text>
        <Text style={styles.emptySubtitle}>
          Add your family members to start checking in on them
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
    flex: 1,
    padding: spacing.lg,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl * 2,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    fontSize: fontSize.xl,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
