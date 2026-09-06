import { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getOperationsCheckInDetail, type BackendOperationsCheckInDetail } from '../../../services/backendApi';
import { borderRadius, colors, fontSize, spacing } from '../../../theme';
import {
  attemptStatusLabel,
  escalationResultLabel,
  failureReasonLabel,
  formatOperationsDateTime,
  operationsStatusLabel,
} from '../../../utils/adminOperations';
import { inferCheckInSkipReason } from '../../../utils/checkInSkipReason';

export default function AdminOperationsDetailScreen() {
  const router = useRouter();
  const { checkInId } = useLocalSearchParams<{ checkInId: string }>();
  const [detail, setDetail] = useState<BackendOperationsCheckInDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    if (!checkInId) {
      setError('Missing check-in ID');
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      setError(null);
      setDetail(await getOperationsCheckInDetail(checkInId));
    } catch (err) {
      setDetail(null);
      setError(err instanceof Error ? err.message : 'Unable to load check-in detail');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [checkInId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const refresh = () => {
    setRefreshing(true);
    loadDetail();
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error || !detail) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Check-in detail unavailable</Text>
        <Text style={styles.errorText}>{error ?? 'This operational check-in could not be found.'}</Text>
        <View style={styles.actionRow}>
          <Pressable style={styles.secondaryButton} onPress={() => router.push('/(main)/admin-operations')}>
            <Text style={styles.secondaryButtonText}>Back</Text>
          </Pressable>
          <Pressable style={styles.primaryButton} onPress={refresh} disabled={refreshing}>
            <Text style={styles.primaryButtonText}>{refreshing ? 'Checking...' : 'Retry'}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>Operations</Text>
          <Text style={styles.title}>Check-in Detail</Text>
        </View>
        <Pressable style={styles.refreshButton} onPress={refresh} disabled={refreshing}>
          <Text style={styles.refreshButtonText}>{refreshing ? 'Refreshing' : 'Refresh'}</Text>
        </Pressable>
      </View>

      <Pressable style={styles.backButton} onPress={() => router.push('/(main)/admin-operations')}>
        <Text style={styles.backButtonText}>Back to operations</Text>
      </Pressable>

      <View style={styles.metaBand}>
        <InfoBlock
          label="Status"
          value={operationsStatusLabel(detail.status, inferCheckInSkipReason(detail.attempts))}
        />
        <InfoBlock label="Channel" value={detail.channelUsed ?? 'Not sent'} />
        <InfoBlock
          label="Alerts"
          value={`${detail.successfulEscalationCount}/${detail.escalationAttemptCount} delivered`}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Timeline</Text>
        <InfoRow label="Scheduled" value={formatOperationsDateTime(detail.scheduledAt)} />
        <InfoRow label="Sent" value={formatOperationsDateTime(detail.sentAt)} />
        <InfoRow label="Responded" value={formatOperationsDateTime(detail.respondedAt)} />
        <InfoRow label="Response" value={detail.responseDetectedAs ?? 'Not detected'} />
        <InfoRow label="Resolved" value={formatOperationsDateTime(detail.resolvedAt)} />
        <InfoRow label="Check-in ID" value={detail.checkInId} mono />
        <InfoRow label="Receiver ID" value={detail.receiverId} mono />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Cascade Attempts</Text>
        {detail.attempts.length > 0 ? (
          <View style={styles.escalationList}>
            {detail.attempts.map((attempt) => (
              <View key={attempt.id} style={styles.escalationItem}>
                <View style={styles.recentHeader}>
                  <Text style={styles.statusText}>
                    {attempt.channel} attempt {attempt.attemptNumber}
                  </Text>
                  <Text style={styles.attemptText}>{attemptStatusLabel(attempt.status)}</Text>
                </View>
                <InfoRow label="Scheduled" value={formatOperationsDateTime(attempt.scheduledAt)} />
                <InfoRow label="Sent" value={formatOperationsDateTime(attempt.sentAt)} />
                <InfoRow label="Completed" value={formatOperationsDateTime(attempt.completedAt)} />
                <InfoRow label="Provider status" value={attempt.providerStatus ?? 'Not reported'} />
                <InfoRow label="Failure reason" value={failureReasonLabel(attempt.failureReason)} />
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.emptyText}>No cascade attempts recorded.</Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Backup Escalation Attempts</Text>
        {detail.escalations.length > 0 ? (
          <View style={styles.escalationList}>
            {detail.escalations.map((escalation) => (
              <View key={escalation.id} style={styles.escalationItem}>
                <View style={styles.recentHeader}>
                  <Text style={styles.statusText}>Attempt {escalation.attemptNumber}</Text>
                  <Text style={styles.attemptText}>{escalationResultLabel(escalation.result)}</Text>
                </View>
                <InfoRow label="Channel" value={escalation.channel} />
                <InfoRow label="Started" value={formatOperationsDateTime(escalation.startedAt)} />
                <InfoRow label="Completed" value={formatOperationsDateTime(escalation.completedAt)} />
                <InfoRow label="Sender notified" value={formatOperationsDateTime(escalation.senderNotifiedAt)} />
                <InfoRow label="Backup alerted" value={formatOperationsDateTime(escalation.backupAlertedAt)} />
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.emptyText}>No escalation attempts recorded.</Text>
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
    marginBottom: spacing.md,
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
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: spacing.md,
  },
  backButtonText: {
    color: colors.primary,
    fontSize: fontSize.sm,
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
  escalationList: {
    gap: spacing.md,
  },
  escalationItem: {
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
  emptyText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  primaryButtonText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  secondaryButtonText: {
    color: colors.primary,
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
