// Dashboard screen - main home screen after login
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, spacing, fontSize, borderRadius } from '../../theme';
import { useProfile } from '../../hooks/useProfile';

export default function DashboardScreen() {
  const router = useRouter();
  const { profile } = useProfile();

  const greeting = getGreeting();
  const firstName = profile?.full_name?.split(' ')[0] || 'there';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Welcome Section */}
      <View style={styles.welcomeSection}>
        <Text style={styles.greeting}>{greeting},</Text>
        <Text style={styles.name}>{firstName}!</Text>
      </View>

      {/* Quick Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.quickActions}>
          <QuickActionCard
            icon="👨‍👩‍👧‍👦"
            title="Add Loved One"
            subtitle="Connect with family"
            onPress={() => router.push('/(main)/pairing')}
          />
          <QuickActionCard
            icon="✓"
            title="View Check-ins"
            subtitle="Recent activity"
            onPress={() => router.push('/(main)/check-ins')}
          />
        </View>
      </View>

      {/* Status Overview */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Status Overview</Text>
        <View style={styles.statusCard}>
          <Text style={styles.statusIcon}>👋</Text>
          <Text style={styles.statusTitle}>No loved ones yet</Text>
          <Text style={styles.statusSubtitle}>
            Add your first loved one to start receiving check-in updates
          </Text>
          <Pressable
            style={styles.statusButton}
            onPress={() => router.push('/(main)/pairing')}
          >
            <Text style={styles.statusButtonText}>Get Started</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

// Quick Action Card Component
interface QuickActionCardProps {
  icon: string;
  title: string;
  subtitle: string;
  onPress: () => void;
}

function QuickActionCard({ icon, title, subtitle, onPress }: QuickActionCardProps) {
  return (
    <Pressable style={styles.quickActionCard} onPress={onPress}>
      <Text style={styles.quickActionIcon}>{icon}</Text>
      <Text style={styles.quickActionTitle}>{title}</Text>
      <Text style={styles.quickActionSubtitle}>{subtitle}</Text>
    </Pressable>
  );
}

// Helper function
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
  },
  welcomeSection: {
    marginBottom: spacing.xl,
  },
  greeting: {
    fontSize: fontSize.lg,
    color: colors.textSecondary,
  },
  name: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.text,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.md,
  },
  quickActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  quickActionCard: {
    flex: 1,
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickActionIcon: {
    fontSize: 24,
    marginBottom: spacing.sm,
  },
  quickActionTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  quickActionSubtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  statusCard: {
    backgroundColor: colors.surface,
    padding: spacing.xl,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  statusIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  statusTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  statusSubtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  statusButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
  },
  statusButtonText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
});
