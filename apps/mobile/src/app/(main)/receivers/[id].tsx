import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { TextInput } from '../../../components/auth';
import {
  getReceiver,
  pauseReceiver,
  resumeReceiver,
  updateReceiver,
  type BackendChannel,
  type BackendReceiverDetail,
  type BackendRelationshipType,
  type BackendTechProfile,
  type ReceiverUpdateInput,
} from '../../../services';
import { colors, spacing, fontSize, borderRadius } from '../../../theme';

const relationshipOptions: Array<{ value: BackendRelationshipType; label: string }> = [
  { value: 'PARENT', label: 'Parent' },
  { value: 'GRANDPARENT', label: 'Grandparent' },
  { value: 'SIBLING', label: 'Sibling' },
  { value: 'SPOUSE', label: 'Spouse' },
  { value: 'CHILD', label: 'Child' },
  { value: 'FRIEND', label: 'Friend' },
  { value: 'OTHER', label: 'Other' },
];

const profileOptions: Array<{
  value: BackendTechProfile;
  label: string;
  primaryChannel: BackendChannel;
  fallbackChannels: BackendChannel[];
}> = [
  { value: 'WHATSAPP', label: 'WhatsApp first', primaryChannel: 'WHATSAPP', fallbackChannels: ['SMS', 'VOICE'] },
  { value: 'SMS', label: 'SMS first', primaryChannel: 'SMS', fallbackChannels: ['VOICE'] },
  { value: 'VOICE_ONLY', label: 'Voice only', primaryChannel: 'VOICE', fallbackChannels: [] },
];

export default function ReceiverDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [receiver, setReceiver] = useState<BackendReceiverDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<ReceiverUpdateInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadReceiver = useCallback(async () => {
    if (!id) {
      setError('Receiver not found');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setActionError(null);
      setReceiver(await getReceiver(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load receiver');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadReceiver();
  }, [loadReceiver]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error || !receiver) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Unable to load receiver</Text>
        <Text style={styles.errorText}>{error ?? 'Please try again.'}</Text>
        <Pressable style={styles.primaryButton} onPress={loadReceiver}>
          <Text style={styles.primaryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const isPaused = Boolean(receiver.pausedReason || receiver.pausedUntil);

  const startEditing = () => {
    setDraft({
      name: receiver.displayName,
      countryCode: receiver.countryCode,
      relationshipType: receiver.relationshipType,
      language: receiver.language,
      timezone: receiver.timezone,
      techProfile: receiver.techProfile,
      primaryChannel: receiver.primaryChannel,
      fallbackChannels: receiver.fallbackChannels,
      scheduleFrequency: receiver.scheduleFrequency,
      scheduleTimeWindow: {
        start: receiver.scheduleTimeWindow.start ?? '09:00',
        end: receiver.scheduleTimeWindow.end ?? '11:00',
      },
    });
    setActionError(null);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setDraft(null);
    setActionError(null);
    setIsEditing(false);
  };

  const saveEdit = async () => {
    if (!id || !draft) return;

    if (!draft.name.trim()) {
      Alert.alert('Missing name', 'Receiver name is required.');
      return;
    }

    try {
      setIsSaving(true);
      setActionError(null);
      const updated = await updateReceiver(id, {
        ...draft,
        name: draft.name.trim(),
        countryCode: draft.countryCode.trim().toUpperCase(),
        language: draft.language.trim(),
        timezone: draft.timezone.trim(),
        scheduleFrequency: draft.scheduleFrequency.trim(),
        scheduleTimeWindow: {
          start: draft.scheduleTimeWindow.start.trim(),
          end: draft.scheduleTimeWindow.end.trim(),
        },
      });
      setReceiver(updated);
      setIsEditing(false);
      setDraft(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to update receiver');
    } finally {
      setIsSaving(false);
    }
  };

  const togglePause = async () => {
    if (!id) return;

    try {
      setIsSaving(true);
      setActionError(null);
      setReceiver(isPaused ? await resumeReceiver(id) : await pauseReceiver(id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to update receiver');
    } finally {
      setIsSaving(false);
    }
  };

  const selectProfile = (profile: (typeof profileOptions)[number]) => {
    if (!draft) return;
    setDraft({
      ...draft,
      techProfile: profile.value,
      primaryChannel: profile.primaryChannel,
      fallbackChannels: profile.fallbackChannels,
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backButtonText}>Back</Text>
      </Pressable>

      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{receiver.displayName.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>{receiver.displayName}</Text>
          <Text style={styles.subtitle}>{formatRelationship(receiver.relationshipType)} - {receiver.phoneMasked}</Text>
        </View>
      </View>

      <View style={styles.statusBand}>
        <Text style={styles.statusLabel}>Current status</Text>
        <Text style={[styles.statusValue, { color: receiverStatusColor(receiver.consentStatus, receiver.latestCheckIn?.status, isPaused) }]}>
          {formatReceiverStatus(receiver.consentStatus, receiver.latestCheckIn?.status, isPaused)}
        </Text>
      </View>

      {actionError && <Text style={styles.inlineError}>{actionError}</Text>}

      {isEditing && draft ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Edit receiver</Text>
          <View style={styles.form}>
            <TextInput label="Receiver name" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />

            <View>
              <Text style={styles.fieldLabel}>Relationship</Text>
              <View style={styles.optionGrid}>
                {relationshipOptions.map((option) => (
                  <Pressable
                    key={option.value}
                    style={[styles.option, draft.relationshipType === option.value && styles.optionSelected]}
                    onPress={() => setDraft({ ...draft, relationshipType: option.value })}
                    disabled={isSaving}
                  >
                    <Text style={[styles.optionText, draft.relationshipType === option.value && styles.optionTextSelected]}>
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View>
              <Text style={styles.fieldLabel}>Best channel</Text>
              <View style={styles.optionStack}>
                {profileOptions.map((option) => (
                  <Pressable
                    key={option.value}
                    style={[styles.optionWide, draft.techProfile === option.value && styles.optionSelected]}
                    onPress={() => selectProfile(option)}
                    disabled={isSaving}
                  >
                    <Text style={[styles.optionText, draft.techProfile === option.value && styles.optionTextSelected]}>
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.row}>
              <View style={styles.rowItem}>
                <TextInput
                  label="Country"
                  value={draft.countryCode}
                  onChangeText={(countryCode) => setDraft({ ...draft, countryCode })}
                  autoCapitalize="characters"
                />
              </View>
              <View style={styles.rowItem}>
                <TextInput label="Language" value={draft.language} onChangeText={(language) => setDraft({ ...draft, language })} />
              </View>
            </View>

            <TextInput label="Timezone" value={draft.timezone} onChangeText={(timezone) => setDraft({ ...draft, timezone })} />

            <View style={styles.row}>
              <View style={styles.rowItem}>
                <TextInput
                  label="From"
                  value={draft.scheduleTimeWindow.start}
                  onChangeText={(start) =>
                    setDraft({ ...draft, scheduleTimeWindow: { ...draft.scheduleTimeWindow, start } })
                  }
                />
              </View>
              <View style={styles.rowItem}>
                <TextInput
                  label="To"
                  value={draft.scheduleTimeWindow.end}
                  onChangeText={(end) => setDraft({ ...draft, scheduleTimeWindow: { ...draft.scheduleTimeWindow, end } })}
                />
              </View>
            </View>

            <View style={styles.editActionRow}>
              <Pressable style={styles.secondaryButton} onPress={cancelEditing} disabled={isSaving}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.primaryActionButton} onPress={saveEdit} disabled={isSaving}>
                <Text style={styles.primaryButtonText}>{isSaving ? 'Saving...' : 'Save'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Latest Check-in</Text>
        <InfoRow label="Status" value={formatCheckInStatus(receiver.latestCheckIn?.status)} />
        <InfoRow label="Scheduled" value={formatDateTime(receiver.latestCheckIn?.scheduledAt)} />
        <InfoRow label="Sent" value={formatDateTime(receiver.latestCheckIn?.sentAt)} />
        <InfoRow label="Responded" value={formatDateTime(receiver.latestCheckIn?.respondedAt)} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Schedule</Text>
        <InfoRow label="Frequency" value={capitalize(receiver.scheduleFrequency)} />
        <InfoRow label="Window" value={`${receiver.scheduleTimeWindow.start ?? '09:00'} - ${receiver.scheduleTimeWindow.end ?? '11:00'}`} />
        <InfoRow label="Timezone" value={receiver.timezone} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Channels</Text>
        <InfoRow label="Primary" value={formatChannel(receiver.primaryChannel)} />
        <InfoRow label="Fallbacks" value={receiver.fallbackChannels.map(formatChannel).join(', ') || 'None'} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Backup Contacts</Text>
        <Text style={styles.placeholderText}>{receiver.escalation.nextStep}</Text>
      </View>

      <View style={styles.actionRow}>
        <Pressable style={styles.secondaryButton} onPress={togglePause} disabled={isSaving}>
          <Text style={styles.secondaryButtonText}>{isPaused ? 'Resume' : 'Pause'}</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={startEditing} disabled={isSaving || isEditing}>
          <Text style={styles.secondaryButtonText}>Edit</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Remove</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function formatReceiverStatus(consentStatus: string, latestCheckInStatus?: string, isPaused = false): string {
  if (isPaused) return 'Paused';
  if (consentStatus === 'PENDING') return 'Pending consent';
  if (consentStatus === 'DECLINED') return 'Consent declined';
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

function formatCheckInStatus(status?: string): string {
  if (!status) return 'No check-ins yet';
  return status
    .split('_')
    .map(capitalize)
    .join(' ');
}

function formatRelationship(type: string): string {
  return formatCheckInStatus(type);
}

function formatChannel(channel: string): string {
  return formatCheckInStatus(channel);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function formatDateTime(value?: string): string {
  if (!value) return 'Not yet';
  return new Date(value).toLocaleString();
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
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: spacing.md,
  },
  backButtonText: {
    color: colors.primary,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary + '20',
    marginRight: spacing.md,
  },
  avatarText: {
    color: colors.primary,
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  headerText: {
    flex: 1,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
  },
  statusBand: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    backgroundColor: colors.surface,
  },
  statusLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginBottom: spacing.xs,
  },
  statusValue: {
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  section: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  form: {
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  rowItem: {
    flex: 1,
  },
  fieldLabel: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  optionStack: {
    gap: spacing.sm,
  },
  option: {
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  optionWide: {
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  optionSelected: {
    backgroundColor: colors.primaryLight + '20',
    borderColor: colors.primary,
  },
  optionText: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  optionTextSelected: {
    color: colors.primary,
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
  placeholderText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  editActionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
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
    fontWeight: '600',
  },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  primaryActionButton: {
    flex: 1,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  inlineError: {
    color: colors.error,
    fontSize: fontSize.sm,
    marginBottom: spacing.md,
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
