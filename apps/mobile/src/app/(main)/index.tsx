// Dashboard screen - main home screen after login
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useCallback } from 'react';
import { colors, spacing, fontSize, borderRadius } from '../../theme';
import { useProfile, useLovedOnes, LovedOne } from '../../hooks';

export default function DashboardScreen() {
  const router = useRouter();
  const { profile } = useProfile();
  const { lovedOnes, loading, refreshLovedOnes } = useLovedOnes();
  const [refreshing, setRefreshing] = useState(false);

  const greeting = getGreeting();
  const firstName = profile?.full_name?.split(' ')[0] || 'there';

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshLovedOnes();
    setRefreshing(false);
  }, [refreshLovedOnes]);

  const hasLovedOnes = lovedOnes.length > 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
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
            onPress={() => router.push('/(main)/receiver-setup')}
          />
          <QuickActionCard
            icon="✓"
            title="View Check-ins"
            subtitle="Recent activity"
            onPress={() => router.push('/(main)/check-ins')}
          />
        </View>
      </View>

      {/* Status Overview / Loved Ones List */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {hasLovedOnes ? 'Your Loved Ones' : 'Status Overview'}
        </Text>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : hasLovedOnes ? (
          <View style={styles.lovedOnesList}>
            {lovedOnes.map((lovedOne) => (
              <LovedOneCard key={lovedOne.id} lovedOne={lovedOne} />
            ))}
          </View>
        ) : (
          <View style={styles.statusCard}>
            <Text style={styles.statusIcon}>👋</Text>
            <Text style={styles.statusTitle}>No loved ones yet</Text>
            <Text style={styles.statusSubtitle}>
              Add your first loved one to start receiving check-in updates
            </Text>
            <Pressable
              style={styles.statusButton}
              onPress={() => router.push('/(main)/receiver-setup')}
            >
              <Text style={styles.statusButtonText}>Get Started</Text>
            </Pressable>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

// Loved One Card Component
interface LovedOneCardProps {
  lovedOne: LovedOne;
}

function LovedOneCard({ lovedOne }: LovedOneCardProps) {
  const router = useRouter();

  // Format schedule display
  const scheduleText = lovedOne.schedule
    ? `Daily at ${formatTime(lovedOne.schedule.time_local)}`
    : 'No schedule set';
  const isPaused = Boolean(lovedOne.paused_reason || lovedOne.paused_until);
  const statusText = formatReceiverStatus(lovedOne.consent_status, lovedOne.latest_check_in_status, isPaused);
  const statusColor = receiverStatusColor(lovedOne.consent_status, lovedOne.latest_check_in_status, isPaused);

  // Get preferred channel
  const channels = lovedOne.preferred_channels;
  const preferredChannel = channels.push
    ? 'Push'
    : channels.whatsapp
    ? 'WhatsApp'
    : channels.sms
    ? 'SMS'
    : 'Not set';

  return (
    <Pressable
      style={styles.lovedOneCard}
      onPress={() => router.push(`/(main)/receivers/${lovedOne.id}` as never)}
    >
      <View style={styles.lovedOneHeader}>
        <View style={styles.lovedOneAvatar}>
          <Text style={styles.lovedOneAvatarText}>
            {lovedOne.display_name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.lovedOneInfo}>
          <Text style={styles.lovedOneName}>{lovedOne.display_name}</Text>
          <Text style={styles.lovedOneRelation}>
            {formatRelationship(lovedOne.relationship_type)}
          </Text>
        </View>
        <View style={styles.lovedOneStatus}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={styles.statusText}>{statusText}</Text>
        </View>
      </View>

      <View style={styles.lovedOneDetails}>
        <View style={styles.detailItem}>
          <Text style={styles.detailLabel}>Schedule</Text>
          <Text style={styles.detailValue}>{scheduleText}</Text>
        </View>
        <View style={styles.detailItem}>
          <Text style={styles.detailLabel}>Via</Text>
          <Text style={styles.detailValue}>{preferredChannel}</Text>
        </View>
      </View>
    </Pressable>
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

// Helper functions
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatTime(time: string): string {
  const [hours, minutes] = time.split(':');
  const hour = parseInt(hours, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

function formatRelationship(type: string): string {
  const labels: Record<string, string> = {
    PARENT: 'Parent',
    GRANDPARENT: 'Grandparent',
    SIBLING: 'Sibling',
    SPOUSE: 'Spouse',
    CHILD: 'Child',
    FRIEND: 'Friend',
    OTHER: 'Other',
    mother: 'Mother',
    father: 'Father',
    child: 'Child',
    partner: 'Partner',
    brother: 'Brother',
    sister: 'Sister',
    relative: 'Relative',
    other: 'Other',
  };
  return labels[type] || type;
}

function formatReceiverStatus(consentStatus: string, latestCheckInStatus?: string, isPaused = false): string {
  if (isPaused) return 'Paused';
  if (consentStatus === 'PENDING') return 'Pending';
  if (consentStatus === 'DECLINED') return 'Declined';
  if (consentStatus === 'REVOKED') return 'Opted out';
  if (latestCheckInStatus === 'RESPONDED_OK') return 'OK';
  if (latestCheckInStatus === 'RESPONDED_HELP') return 'Needs help';
  if (latestCheckInStatus === 'SENT') return 'Awaiting reply';
  return 'Active';
}

function receiverStatusColor(consentStatus: string, latestCheckInStatus?: string, isPaused = false): string {
  if (isPaused) return colors.warning;
  if (latestCheckInStatus === 'RESPONDED_HELP') return colors.error;
  if (consentStatus === 'PENDING' || latestCheckInStatus === 'SENT') return colors.warning;
  if (consentStatus === 'DECLINED' || consentStatus === 'REVOKED') return colors.textLight;
  return colors.success;
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
  loadingContainer: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  lovedOnesList: {
    gap: spacing.md,
  },
  lovedOneCard: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  lovedOneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  lovedOneAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  lovedOneAvatarText: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.primary,
  },
  lovedOneInfo: {
    flex: 1,
  },
  lovedOneName: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  lovedOneRelation: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  lovedOneStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  lovedOneDetails: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    gap: spacing.lg,
  },
  detailItem: {
    flex: 1,
  },
  detailLabel: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    color: colors.text,
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
