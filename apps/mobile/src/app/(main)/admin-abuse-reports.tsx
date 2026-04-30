import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  getAdminMe,
  listAdminAbuseReports,
  markAdminAbuseReportActionTaken,
  markAdminAbuseReportSafe,
  type BackendAdminAbuseReport,
  type BackendAdminMe,
} from '../../services';
import { borderRadius, colors, fontSize, spacing } from '../../theme';
import { formatOperationsDateTime } from '../../utils/adminOperations';

export default function AdminAbuseReportsScreen() {
  const [admin, setAdmin] = useState<BackendAdminMe | null>(null);
  const [reports, setReports] = useState<BackendAdminAbuseReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionReportId, setActionReportId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canReview = useMemo(() => admin?.role === 'SUPER_ADMIN' || admin?.role === 'OPERATOR', [admin?.role]);

  const loadQueue = useCallback(async () => {
    try {
      setError(null);
      const [adminIdentity, pendingReports] = await Promise.all([getAdminMe(), listAdminAbuseReports()]);
      setAdmin(adminIdentity);
      setReports(pendingReports);
    } catch (err) {
      setAdmin(null);
      setReports([]);
      setError(err instanceof Error ? err.message : 'Unable to load abuse reports');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const refresh = () => {
    setRefreshing(true);
    loadQueue();
  };

  const reviewReport = async (abuseReportId: string, action: 'safe' | 'action-taken') => {
    try {
      setActionReportId(abuseReportId);
      setError(null);
      if (action === 'safe') {
        await markAdminAbuseReportSafe(abuseReportId);
      } else {
        await markAdminAbuseReportActionTaken(abuseReportId);
      }
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update abuse report');
    } finally {
      setActionReportId(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error && !admin) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Admin access required</Text>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.primaryButton} onPress={refresh} disabled={refreshing}>
          <Text style={styles.primaryButtonText}>{refreshing ? 'Checking...' : 'Retry'}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>Admin</Text>
          <Text style={styles.title}>Abuse Reports</Text>
        </View>
        <Pressable style={styles.refreshButton} onPress={refresh} disabled={refreshing}>
          <Text style={styles.refreshButtonText}>{refreshing ? 'Refreshing' : 'Refresh'}</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.inlineError}>{error}</Text> : null}

      <View style={styles.metaBand}>
        <InfoBlock label="Admin role" value={admin?.role.replace('_', ' ') ?? 'Unknown'} />
        <InfoBlock label="Pending" value={`${reports.length}`} />
        <InfoBlock label="Review access" value={canReview ? 'Enabled' : 'Read only'} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Pending Queue</Text>
        {reports.length > 0 ? (
          <View style={styles.reportList}>
            {reports.map((report) => {
              const actionInFlight = actionReportId === report.id;

              return (
                <View key={report.id} style={styles.reportItem}>
                  <View style={styles.reportHeader}>
                    <Text style={styles.statusText}>{abuseStatusLabel(report.reviewStatus)}</Text>
                    <Text style={styles.contentFlag}>{report.hasReportContent ? 'Content captured' : 'No content'}</Text>
                  </View>
                  <InfoRow label="Reported" value={formatOperationsDateTime(report.reportedAt)} />
                  <InfoRow label="Receiver ID" value={report.receiverId} mono />
                  <InfoRow label="Report ID" value={report.id} mono />
                  <View style={styles.actionRow}>
                    <Pressable
                      style={[styles.secondaryButton, (!canReview || actionInFlight) && styles.disabledButton]}
                      onPress={() => reviewReport(report.id, 'safe')}
                      disabled={!canReview || actionInFlight}
                    >
                      <Text style={styles.secondaryButtonText}>{actionInFlight ? 'Reviewing...' : 'Mark safe'}</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.primaryButton, (!canReview || actionInFlight) && styles.disabledButton]}
                      onPress={() => reviewReport(report.id, 'action-taken')}
                      disabled={!canReview || actionInFlight}
                    >
                      <Text style={styles.primaryButtonText}>Action taken</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={styles.emptyText}>No pending abuse reports.</Text>
        )}
      </View>
    </ScrollView>
  );
}

function abuseStatusLabel(status: BackendAdminAbuseReport['reviewStatus']): string {
  switch (status) {
    case 'REVIEWED_SAFE':
      return 'Reviewed safe';
    case 'REVIEWED_ACTION_TAKEN':
      return 'Action taken';
    case 'PENDING':
    default:
      return 'Pending';
  }
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
  inlineError: {
    color: colors.error,
    fontSize: fontSize.sm,
    fontWeight: '600',
    marginBottom: spacing.md,
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
  reportList: {
    gap: spacing.md,
  },
  reportItem: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    backgroundColor: colors.backgroundSecondary,
    padding: spacing.md,
  },
  reportHeader: {
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
  contentFlag: {
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
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    marginTop: spacing.md,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  primaryButtonText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.5,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
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
