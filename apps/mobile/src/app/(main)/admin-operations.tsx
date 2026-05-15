import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getAdminMe, getOperationsCheckInSummary, type BackendAdminMe, type BackendOperationsSummary } from '../../services/backendApi';
import { colors, spacing, fontSize, borderRadius } from '../../theme';
import { formatOperationsDateTime, operationsStatusLabel, sortStatusCounts } from '../../utils/adminOperations';

export default function AdminOperationsScreen() {
  const router = useRouter();
  const [admin, setAdmin] = useState<BackendAdminMe | null>(null);
  const [summary, setSummary] = useState<BackendOperationsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    try {
      setError(null);
      const [adminIdentity, operationsSummary] = await Promise.all([getAdminMe(), getOperationsCheckInSummary()]);
      setAdmin(adminIdentity);
      setSummary(operationsSummary);
    } catch (err) {
      setAdmin(null);
      setSummary(null);
      setError(err instanceof Error ? err.message : 'Unable to load admin operations');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const refresh = () => {
    setRefreshing(true);
    loadDashboard();
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error || !admin || !summary) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Admin access required</Text>
        <Text style={styles.errorText}>{error ?? 'Sign in with an active admin account.'}</Text>
        <Pressable style={styles.primaryButton} onPress={refresh} disabled={refreshing}>
          <Text style={styles.primaryButtonText}>{refreshing ? 'Checking...' : 'Retry'}</Text>
        </Pressable>
      </View>
    );
  }

  const statusCounts = sortStatusCounts(summary.statusCounts);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>Operations</Text>
          <Text style={styles.title}>Check-in Health</Text>
        </View>
        <Pressable style={styles.refreshButton} onPress={refresh} disabled={refreshing}>
          <Text style={styles.refreshButtonText}>{refreshing ? 'Refreshing' : 'Refresh'}</Text>
        </Pressable>
      </View>

      <View style={styles.metaBand}>
        <InfoBlock label="Admin role" value={admin.role.replace('_', ' ')} />
        <InfoBlock label="Window" value={`${summary.windowHours} hours`} />
        <InfoBlock label="Updated" value={formatOperationsDateTime(summary.generatedAt)} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Status Counts</Text>
        {statusCounts.length > 0 ? (
          <View style={styles.countGrid}>
            {statusCounts.map((item) => (
              <View key={item.status} style={styles.countTile}>
                <Text style={styles.countValue}>{item.count}</Text>
                <Text style={styles.countLabel}>{operationsStatusLabel(item.status)}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.emptyText}>No check-ins in this window.</Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent Operational Check-ins</Text>
        {summary.recent.length > 0 ? (
          <View style={styles.recentList}>
            {summary.recent.map((checkIn) => (
              <Pressable
                key={checkIn.checkInId}
                style={styles.recentItem}
                onPress={() => router.push(`/(main)/admin-operations/${checkIn.checkInId}` as never)}
              >
                <View style={styles.recentHeader}>
                  <Text style={styles.statusText}>{operationsStatusLabel(checkIn.status)}</Text>
                  <Text style={styles.attemptText}>
                    {checkIn.successfulEscalationCount}/{checkIn.escalationAttemptCount} alerts
                  </Text>
                </View>
                <InfoRow label="Scheduled" value={formatOperationsDateTime(checkIn.scheduledAt)} />
                <InfoRow label="Sent" value={formatOperationsDateTime(checkIn.sentAt)} />
                <InfoRow label="Responded" value={formatOperationsDateTime(checkIn.respondedAt)} />
                <InfoRow label="Resolved" value={formatOperationsDateTime(checkIn.resolvedAt)} />
                <InfoRow label="Check-in ID" value={checkIn.checkInId} mono />
                <InfoRow label="Receiver ID" value={checkIn.receiverId} mono />
                <Text style={styles.openDetailText}>Open detail</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.emptyText}>No recent operational incidents.</Text>
        )}
      </View>
    </ScrollView>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoBlock}>
      <Text style={styles.infoBlockLabel}>{label}</Text>
      <Text style={styles.infoBlockValue}>{value}</Text>
    </View>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, mono && styles.monoValue]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  eyebrow: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
  },
  refreshButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  refreshButtonText: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  metaBand: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  infoBlock: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  infoBlockLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    marginBottom: spacing.xs,
  },
  infoBlockValue: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  section: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  countGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  countTile: {
    minWidth: 136,
    flexGrow: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    backgroundColor: colors.backgroundSecondary,
  },
  countValue: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  countLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  recentList: {
    gap: spacing.md,
  },
  recentItem: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    backgroundColor: colors.backgroundSecondary,
    padding: spacing.md,
  },
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  statusText: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  attemptText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  infoLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  infoValue: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '500',
    textAlign: 'right',
  },
  monoValue: {
    fontFamily: 'monospace',
    fontSize: fontSize.xs,
  },
  openDetailText: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: '700',
    marginTop: spacing.sm,
    textAlign: 'right',
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
  primaryButtonText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  errorTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  errorText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
});
