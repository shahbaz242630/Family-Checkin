import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, fontSize, borderRadius } from '../../theme';

// Mock data - will be replaced with real data from Supabase
const MOCK_LOVED_ONES = [
  {
    id: '1',
    name: 'Mom',
    relationship: 'mother',
    status: 'safe',
    lastCheckin: '2 hours ago',
  },
];

export default function HomeScreen() {
  const hasLovedOnes = MOCK_LOVED_ONES.length > 0;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.greeting}>Good morning!</Text>
          <Text style={styles.title}>Your Family Status</Text>
        </View>

        {!hasLovedOnes ? (
          <EmptyState />
        ) : (
          <View style={styles.cards}>
            {MOCK_LOVED_ONES.map((person) => (
              <StatusCard key={person.id} person={person} />
            ))}
          </View>
        )}

        <Pressable style={styles.addButton}>
          <Text style={styles.addButtonText}>+ Add Loved One</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function EmptyState() {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyIcon}>👨‍👩‍👧‍👦</Text>
      <Text style={styles.emptyTitle}>No loved ones added yet</Text>
      <Text style={styles.emptyDescription}>
        Add your first family member to start daily check-ins
      </Text>
    </View>
  );
}

function StatusCard({ person }: { person: typeof MOCK_LOVED_ONES[0] }) {
  const statusColors = {
    safe: colors.safe,
    pending: colors.pending,
    alert: colors.alert,
  };

  const statusLabels = {
    safe: 'Safe',
    pending: 'Pending',
    alert: 'Alert',
  };

  return (
    <Pressable style={styles.card}>
      <View style={styles.cardHeader}>
        <View>
          <Text style={styles.cardName}>{person.name}</Text>
          <Text style={styles.cardRelationship}>{person.relationship}</Text>
        </View>
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: statusColors[person.status as keyof typeof statusColors] + '20' },
          ]}
        >
          <View
            style={[
              styles.statusDot,
              { backgroundColor: statusColors[person.status as keyof typeof statusColors] },
            ]}
          />
          <Text
            style={[
              styles.statusText,
              { color: statusColors[person.status as keyof typeof statusColors] },
            ]}
          >
            {statusLabels[person.status as keyof typeof statusLabels]}
          </Text>
        </View>
      </View>
      <Text style={styles.cardLastCheckin}>Last check-in: {person.lastCheckin}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  header: {
    marginBottom: spacing.xl,
  },
  greeting: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: 'bold',
    color: colors.text,
  },
  cards: {
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  cardName: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
  },
  cardRelationship: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    gap: spacing.xs,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  cardLastCheckin: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyDescription: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  addButton: {
    marginTop: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  addButtonText: {
    color: colors.primary,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
});
