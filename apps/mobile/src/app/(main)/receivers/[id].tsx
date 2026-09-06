import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { StepUpCodeModal } from '../../../components/common';
import { TextInput } from '../../../components/auth';
import {
  CountrySelect,
  LanguageSelect,
  ReceiverPhoneInput,
  TimeSelect,
  TimezoneSelect,
} from '../../../components/onboarding';
import { COUNTRIES } from '../../../data/constants';
import {
  alertBackupForReceiverCheckIn,
  createBackupContact,
  deleteBackupContact,
  deleteReceiver,
  getReceiver,
  listBackupContacts,
  pauseReceiver,
  requestAccountStepUp,
  resendReceiverConsent,
  resolveReceiverCheckIn,
  resumeReceiver,
  tryReceiverCheckInLater,
  updateBackupContact,
  updateReceiver,
  verifyAccountStepUp,
  type BackupContactSetupInput,
  type BackupContactUpdateInput,
  type BackendBackupContact,
  type BackendReceiverDetail,
  type BackendRelationshipType,
  type ReceiverUpdateInput,
} from '../../../services/backendApi';
import {
  CONSENT_NOT_PENDING_CODE,
  describeBackendError,
  isBackendErrorCode,
  isNotFoundError,
} from '../../../services/backendErrors';
import { colors, spacing, fontSize, borderRadius } from '../../../theme';
import { CHANNEL_PROFILE_OPTIONS } from '../../../utils/channelProfiles';
import {
  backupAlertNotice,
  CONSENT_REQUEST_FAILED_NOTICE,
  consentResendNotice,
  MAX_RESOLUTION_NOTE_LENGTH,
  normalizeResolutionNote,
  resolutionNoteCounter,
  type ActionNotice,
} from '../../../utils/receiverActions';
import {
  getReceiverStatusDisplay,
  getScheduleAttentionDisplay,
  SCHEDULE_NEEDS_ATTENTION_MESSAGE,
  type ReceiverStatusTone,
} from '../../../utils/receiverStatus';

const relationshipOptions: Array<{ value: BackendRelationshipType; label: string }> = [
  { value: 'PARENT', label: 'Parent' },
  { value: 'GRANDPARENT', label: 'Grandparent' },
  { value: 'SIBLING', label: 'Sibling' },
  { value: 'SPOUSE', label: 'Spouse' },
  { value: 'CHILD', label: 'Child' },
  { value: 'FRIEND', label: 'Friend' },
  { value: 'OTHER', label: 'Other' },
];

const profileOptions = CHANNEL_PROFILE_OPTIONS;

const RECEIVER_REMOVED_TITLE = 'This receiver was removed';
const RECEIVER_REMOVED_MESSAGE = 'Check-ins for this receiver have already stopped. Returning to your dashboard.';

function notify(title: string, message: string): void {
  // Same web detection as the confirm dialogs below: react-native-web has no Alert implementation.
  if (typeof window !== 'undefined' && typeof window.confirm === 'function' && typeof window.alert === 'function') {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

export default function ReceiverDetailScreen() {
  const router = useRouter();
  // `consentRequest=failed` is set by the add-receiver form when the first invitation could not be sent.
  const { id, consentRequest } = useLocalSearchParams<{ id: string; consentRequest?: string }>();
  const [receiver, setReceiver] = useState<BackendReceiverDetail | null>(null);
  const [backupContacts, setBackupContacts] = useState<BackendBackupContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isAddingBackupContact, setIsAddingBackupContact] = useState(false);
  const [editingBackupContactId, setEditingBackupContactId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReceiverUpdateInput | null>(null);
  const [backupDraft, setBackupDraft] = useState<BackupContactSetupInput>({
    name: '',
    phone: '',
    phoneCountry: 'AE',
    relationshipToReceiver: '',
    locationInstructions: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Outcome of the last sender action (backup alert, resend, resolve). Seeded when the add-receiver form lands
  // here after a failed consent send so the sender is already pointed at "Resend invitation" (CB-009).
  const [notice, setNotice] = useState<ActionNotice | null>(
    consentRequest === 'failed' ? CONSENT_REQUEST_FAILED_NOTICE : null,
  );
  const [isResolving, setIsResolving] = useState(false);
  const [resolutionNoteDraft, setResolutionNoteDraft] = useState('');
  const [resolutionNoteError, setResolutionNoteError] = useState<string | null>(null);
  const [stepUpPrompt, setStepUpPrompt] = useState<{ title: string; message: string } | null>(null);
  const [stepUpCode, setStepUpCode] = useState('');
  const stepUpResolver = useRef<((code: string | null) => void) | null>(null);
  const hasLoadedRef = useRef(false);
  const leavingRef = useRef(false);

  // The receiver no longer exists (removed from another screen or device): say so once and go back (CB-071).
  const leaveRemovedReceiver = useCallback(() => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    notify(RECEIVER_REMOVED_TITLE, RECEIVER_REMOVED_MESSAGE);
    router.replace('/(main)');
  }, [router]);

  const loadReceiver = useCallback(async () => {
    if (!id) {
      setError('Receiver not found');
      setLoading(false);
      return;
    }

    try {
      // Only the first load blanks the screen; focus refetches keep the current detail visible.
      if (!hasLoadedRef.current) {
        setLoading(true);
      }
      setError(null);
      setActionError(null);
      const [receiverDetail, receiverBackupContacts] = await Promise.all([getReceiver(id), listBackupContacts(id)]);
      setReceiver(receiverDetail);
      setBackupContacts(receiverBackupContacts);
      hasLoadedRef.current = true;
    } catch (err) {
      if (isNotFoundError(err)) {
        leaveRemovedReceiver();
        return;
      }
      setError(err instanceof Error ? err.message : 'Unable to load receiver');
    } finally {
      setLoading(false);
    }
  }, [id, leaveRemovedReceiver]);

  // Refetch whenever the screen gains focus so a reply, a removal or an edit made elsewhere is reflected (CB-071).
  useFocusEffect(
    useCallback(() => {
      void loadReceiver();
    }, [loadReceiver]),
  );

  /**
   * An action answered 404: either the receiver is gone, or what it acted on changed underneath (for example the
   * latest check-in was superseded). Reload to tell them apart: a missing receiver leaves the screen, anything
   * else refreshes the detail and shows the message. A 409 CONSENT_NOT_PENDING means the receiver answered while
   * this screen still showed PENDING, so it reloads too. Every other failure is explained through
   * `describeBackendError`, which turns the typed 409/429 codes into a sentence with the relevant date.
   */
  const handleActionError = async (err: unknown, fallback: string): Promise<void> => {
    const staleDetail = isNotFoundError(err) || isBackendErrorCode(err, CONSENT_NOT_PENDING_CODE);
    if (!id || !staleDetail) {
      setActionError(describeBackendError(err, fallback));
      return;
    }

    try {
      const [receiverDetail, receiverBackupContacts] = await Promise.all([getReceiver(id), listBackupContacts(id)]);
      setReceiver(receiverDetail);
      setBackupContacts(receiverBackupContacts);
      setActionError(describeBackendError(err, fallback));
    } catch (reloadErr) {
      if (isNotFoundError(reloadErr)) {
        leaveRemovedReceiver();
        return;
      }
      setActionError(describeBackendError(reloadErr, fallback));
    }
  };

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
  const currentStatus = getReceiverStatusDisplay(receiver.consentStatus, receiver.latestCheckIn?.status, isPaused);
  const scheduleAttention = getScheduleAttentionDisplay(receiver.scheduleInvalidAt);

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
      await handleActionError(err, 'Unable to update receiver');
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
      await handleActionError(err, 'Unable to update receiver');
    } finally {
      setIsSaving(false);
    }
  };

  // One invitation per receiver per 7 days; the 429 is explained with the next allowed date (CB-009).
  const resendInvitation = async () => {
    if (!id) return;

    try {
      setIsSaving(true);
      setActionError(null);
      setNotice(null);
      const result = await resendReceiverConsent(id);
      setNotice(consentResendNotice(result.consentRequestStatus));
    } catch (err) {
      await handleActionError(err, 'Unable to resend the invitation');
    } finally {
      setIsSaving(false);
    }
  };

  const latestStatus = receiver.latestCheckIn?.status ?? '';
  const needsAttention = latestStatus === 'NEEDS_ATTENTION';
  const canResolveLatestCheckIn = ['RESPONDED_HELP', 'ESCALATED', 'NEEDS_ATTENTION', 'FAILED', 'SKIPPED'].includes(
    latestStatus,
  );
  const canAlertBackupForLatestCheckIn = ['RESPONDED_HELP', 'NEEDS_ATTENTION', 'FAILED', 'SKIPPED'].includes(
    latestStatus,
  );
  const canTryLatestCheckInLater = ['SENT', 'RESPONDED_HELP', 'NEEDS_ATTENTION', 'FAILED', 'SKIPPED'].includes(
    latestStatus,
  );
  const backupPhoneError = backupDraft.phone.trim().startsWith('0')
    ? 'Remove the leading 0. Use the local number after the country code.'
    : undefined;

  const startResolving = () => {
    setResolutionNoteDraft('');
    setResolutionNoteError(null);
    setActionError(null);
    setNotice(null);
    setIsResolving(true);
  };

  const cancelResolving = () => {
    setIsResolving(false);
    setResolutionNoteDraft('');
    setResolutionNoteError(null);
  };

  // The optional note (≤ 200 characters) is stored encrypted and shown back on the detail (CB-018).
  const resolveLatestCheckIn = async () => {
    if (!id || !receiver.latestCheckIn || !canResolveLatestCheckIn) return;

    const checked = normalizeResolutionNote(resolutionNoteDraft);
    if (!checked.ok) {
      setResolutionNoteError(checked.message);
      return;
    }

    try {
      setIsSaving(true);
      setActionError(null);
      setReceiver(await resolveReceiverCheckIn(id, receiver.latestCheckIn.id, checked.note));
      setIsResolving(false);
      setResolutionNoteDraft('');
      setNotice({
        message: checked.note ? 'Check-in marked resolved with your note.' : 'Check-in marked resolved.',
        tone: 'success',
      });
    } catch (err) {
      await handleActionError(err, 'Unable to mark check-in resolved');
    } finally {
      setIsSaving(false);
    }
  };

  // The backend reports what the fan-out achieved; with no backup contacts the screen used to change nothing (CB-074).
  const alertBackupForLatestCheckIn = async () => {
    if (!id || !receiver.latestCheckIn || !canAlertBackupForLatestCheckIn) return;

    try {
      setIsSaving(true);
      setActionError(null);
      setNotice(null);
      const result = await alertBackupForReceiverCheckIn(id, receiver.latestCheckIn.id);
      setReceiver(result.receiver);
      setNotice(backupAlertNotice(result.backupAlert));
    } catch (err) {
      await handleActionError(err, 'Unable to alert backup contacts');
    } finally {
      setIsSaving(false);
    }
  };

  const tryLatestCheckInLater = async () => {
    if (!id || !receiver.latestCheckIn || !canTryLatestCheckInLater) return;

    try {
      setIsSaving(true);
      setActionError(null);
      setReceiver(await tryReceiverCheckInLater(id, receiver.latestCheckIn.id));
    } catch (err) {
      await handleActionError(err, 'Unable to record try later');
    } finally {
      setIsSaving(false);
    }
  };

  const startAddingBackupContact = () => {
    setBackupDraft({
      name: '',
      phone: '',
      phoneCountry: receiver.countryCode || 'AE',
      relationshipToReceiver: '',
      locationInstructions: '',
    });
    setActionError(null);
    setEditingBackupContactId(null);
    setIsAddingBackupContact(true);
  };

  const cancelAddingBackupContact = () => {
    setIsAddingBackupContact(false);
    setEditingBackupContactId(null);
    setActionError(null);
  };

  const startEditingBackupContact = (contact: BackendBackupContact) => {
    setBackupDraft({
      name: contact.displayName,
      phone: '',
      phoneCountry: receiver.countryCode || 'AE',
      relationshipToReceiver: contact.relationshipToReceiver,
      locationInstructions: '',
    });
    setActionError(null);
    setEditingBackupContactId(contact.id);
    setIsAddingBackupContact(true);
  };

  const saveBackupContact = async () => {
    if (!id) return;

    if (
      !backupDraft.name.trim() ||
      (!editingBackupContactId && !backupDraft.phone.trim()) ||
      !backupDraft.relationshipToReceiver.trim()
    ) {
      Alert.alert(
        'Missing details',
        editingBackupContactId ? 'Name and relationship are required.' : 'Name, phone, and relationship are required.',
      );
      return;
    }

    if (backupPhoneError) {
      Alert.alert('Check phone number', backupPhoneError);
      return;
    }

    try {
      setIsSaving(true);
      setActionError(null);
      const backupContactInput: BackupContactSetupInput | BackupContactUpdateInput = {
        name: backupDraft.name.trim(),
        phoneCountry: backupDraft.phoneCountry?.trim().toUpperCase() || undefined,
        relationshipToReceiver: backupDraft.relationshipToReceiver.trim(),
        locationInstructions: backupDraft.locationInstructions?.trim() || undefined,
      };
      if (backupDraft.phone.trim()) {
        const selectedBackupCountry =
          COUNTRIES.find((country) => country.isoCode === backupDraft.phoneCountry?.toUpperCase()) ?? COUNTRIES[0];
        backupContactInput.phone = `${selectedBackupCountry.dialCode}${backupDraft.phone.trim()}`;
      }

      if (editingBackupContactId) {
        const updated = await updateBackupContact(id, editingBackupContactId, backupContactInput);
        setBackupContacts((current) =>
          current
            .map((contact) => (contact.id === updated.id ? updated : contact))
            .sort((a, b) => a.priorityOrder - b.priorityOrder),
        );
      } else {
        const created = await createBackupContact(id, backupContactInput as BackupContactSetupInput);
        setBackupContacts((current) => [...current, created].sort((a, b) => a.priorityOrder - b.priorityOrder));
      }
      setIsAddingBackupContact(false);
      setEditingBackupContactId(null);
      setBackupDraft({
        name: '',
        phone: '',
        phoneCountry: receiver.countryCode || 'AE',
        relationshipToReceiver: '',
        locationInstructions: '',
      });
    } catch (err) {
      await handleActionError(err, 'Unable to add backup contact');
    } finally {
      setIsSaving(false);
    }
  };

  const removeBackupContact = async (contact: BackendBackupContact) => {
    if (!id) return;

    const removeMessage = `Remove ${contact.displayName} from backup contacts?`;
    const performRemove = async () => {
      try {
        setIsSaving(true);
        setActionError(null);
        await deleteBackupContact(id, contact.id);
        setBackupContacts((current) => current.filter((item) => item.id !== contact.id));
        if (editingBackupContactId === contact.id) {
          setIsAddingBackupContact(false);
          setEditingBackupContactId(null);
        }
      } catch (err) {
        await handleActionError(err, 'Unable to remove backup contact');
      } finally {
        setIsSaving(false);
      }
    };

    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (window.confirm(removeMessage)) {
        await performRemove();
      }
      return;
    }

    Alert.alert('Remove backup contact', removeMessage, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: performRemove,
      },
    ]);
  };

  const removeReceiver = async () => {
    if (!id || !receiver) return;

    const removeMessage = `Stop check-ins for ${receiver.displayName} and remove them from your dashboard?`;
    const performRemove = async () => {
      try {
        setIsSaving(true);
        setActionError(null);
        const stepUpToken = await completeStepUpForReceiverRemoval();
        if (!stepUpToken) {
          setIsSaving(false);
          return;
        }
        await deleteReceiver(id, stepUpToken);
        router.replace('/(main)');
      } catch (err) {
        if (isNotFoundError(err)) {
          // Already removed elsewhere: nothing left to delete.
          leaveRemovedReceiver();
          return;
        }
        setActionError(describeBackendError(err, 'Unable to remove receiver'));
      } finally {
        setIsSaving(false);
      }
    };

    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (window.confirm(removeMessage)) {
        await performRemove();
      }
      return;
    }

    Alert.alert('Remove receiver', removeMessage, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: performRemove,
      },
    ]);
  };

  const completeStepUpForReceiverRemoval = async (): Promise<string | null> => {
    const requested = await requestAccountStepUp('REMOVE_RECEIVER');
    const code = await promptForOtp(requested.expiresAt);

    if (!code) {
      Alert.alert('Verification required', 'Enter the SMS code to remove this receiver.');
      return null;
    }

    const verified = await verifyAccountStepUp({ challengeId: requested.challengeId, code });
    return verified.stepUpToken;
  };

  const promptForOtp = async (expiresAt: string): Promise<string | null> => {
    setStepUpCode('');
    setStepUpPrompt({
      title: 'Confirm receiver removal',
      message: `Enter the SMS verification code. It expires at ${new Date(expiresAt).toLocaleTimeString()}.`,
    });

    return await new Promise((resolve) => {
      stepUpResolver.current = resolve;
    });
  };

  const resolveStepUpPrompt = (code: string | null) => {
    stepUpResolver.current?.(code);
    stepUpResolver.current = null;
    setStepUpPrompt(null);
    setStepUpCode('');
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
    <>
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
            <Text style={styles.subtitle}>
              {formatRelationship(receiver.relationshipType)} - {receiver.phoneMasked}
            </Text>
          </View>
        </View>

        <View style={styles.statusBand}>
          <Text style={styles.statusLabel}>Current status</Text>
          <Text style={[styles.statusValue, { color: receiverStatusColor(currentStatus.tone) }]}>
            {currentStatus.label}
          </Text>
          {receiver.consentStatus === 'PENDING' ? (
            <View style={styles.consentRow}>
              <Text style={styles.consentText}>Waiting for {receiver.displayName} to reply YES.</Text>
              <Pressable style={styles.inlineActionButton} onPress={resendInvitation} disabled={isSaving}>
                <Text style={styles.smallButtonText}>{isSaving ? 'Sending...' : 'Resend invitation'}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        {scheduleAttention ? (
          <View style={styles.attentionPanel}>
            <Text style={styles.attentionTitle}>{scheduleAttention.label}</Text>
            <Text style={styles.attentionText}>{SCHEDULE_NEEDS_ATTENTION_MESSAGE}</Text>
            {!isEditing ? (
              <Pressable style={styles.inlineActionButton} onPress={startEditing} disabled={isSaving}>
                <Text style={styles.smallButtonText}>Edit schedule</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {actionError && <Text style={styles.inlineError}>{actionError}</Text>}
        {notice ? (
          <View
            style={[
              styles.noticeBox,
              {
                borderColor: receiverStatusColor(notice.tone),
                backgroundColor: receiverStatusColor(notice.tone) + '12',
              },
            ]}
          >
            <Text style={styles.noticeText}>{notice.message}</Text>
          </View>
        ) : null}

        {isEditing && draft ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Edit receiver</Text>
            <View style={styles.form}>
              <TextInput
                label="Receiver name"
                value={draft.name}
                onChangeText={(name) => setDraft({ ...draft, name })}
              />

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
                      <Text
                        style={[
                          styles.optionText,
                          draft.relationshipType === option.value && styles.optionTextSelected,
                        ]}
                      >
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
                      <Text
                        style={[styles.optionText, draft.techProfile === option.value && styles.optionTextSelected]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <CountrySelect
                label="Country"
                value={draft.countryCode}
                onChange={(countryCode) => setDraft({ ...draft, countryCode })}
                disabled={isSaving}
                showDialCode={false}
              />
              <LanguageSelect
                label="Language"
                value={draft.language}
                onChange={(language) => setDraft({ ...draft, language })}
                disabled={isSaving}
              />

              <TimezoneSelect
                label="Timezone"
                value={draft.timezone}
                onChange={(timezone) => setDraft({ ...draft, timezone })}
              />

              <Text style={styles.fieldHint}>Check-in window uses the receiver timezone selected above.</Text>
              <View style={styles.row}>
                <View style={styles.rowItem}>
                  <TimeSelect
                    label="From"
                    value={draft.scheduleTimeWindow.start}
                    onChange={(start) =>
                      setDraft({ ...draft, scheduleTimeWindow: { ...draft.scheduleTimeWindow, start } })
                    }
                    disabled={isSaving}
                  />
                </View>
                <View style={styles.rowItem}>
                  <TimeSelect
                    label="To"
                    value={draft.scheduleTimeWindow.end}
                    onChange={(end) => setDraft({ ...draft, scheduleTimeWindow: { ...draft.scheduleTimeWindow, end } })}
                    disabled={isSaving}
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
          {needsAttention ? (
            <View style={styles.attentionPanel}>
              <Text style={styles.attentionTitle}>Receiver did not respond</Text>
              <Text style={styles.attentionText}>
                Nearby tried the available check-in channels. Choose whether to retry, alert backup contacts, or close
                this check-in.
              </Text>
            </View>
          ) : null}
          <InfoRow label="Status" value={formatCheckInStatus(receiver.latestCheckIn?.status)} />
          <InfoRow label="Scheduled" value={formatDateTime(receiver.latestCheckIn?.scheduledAt)} />
          <InfoRow label="Sent" value={formatDateTime(receiver.latestCheckIn?.sentAt)} />
          <InfoRow label="Responded" value={formatDateTime(receiver.latestCheckIn?.respondedAt)} />
          <InfoRow label="Resolved" value={formatDateTime(receiver.latestCheckIn?.resolvedAt)} />
          {receiver.latestCheckIn?.resolutionNote ? (
            <InfoRow label="Note" value={receiver.latestCheckIn.resolutionNote} />
          ) : null}
          {canAlertBackupForLatestCheckIn || canTryLatestCheckInLater || canResolveLatestCheckIn ? (
            <View style={styles.checkInActionStack}>
              {canAlertBackupForLatestCheckIn ? (
                <Pressable style={styles.resolveButton} onPress={alertBackupForLatestCheckIn} disabled={isSaving}>
                  <Text style={styles.resolveButtonText}>{isSaving ? 'Saving...' : 'Alert backup contacts'}</Text>
                </Pressable>
              ) : null}
              {canTryLatestCheckInLater ? (
                <Pressable style={styles.secondaryActionButton} onPress={tryLatestCheckInLater} disabled={isSaving}>
                  <Text style={styles.secondaryButtonText}>{isSaving ? 'Saving...' : 'Try again later'}</Text>
                </Pressable>
              ) : null}
              {canResolveLatestCheckIn && !isResolving ? (
                <Pressable style={styles.secondaryActionButton} onPress={startResolving} disabled={isSaving}>
                  <Text style={styles.secondaryButtonText}>Mark resolved</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {isResolving ? (
            <View style={styles.resolveForm}>
              <TextInput
                label="Note (optional)"
                placeholder="e.g. Spoke to her, all fine"
                value={resolutionNoteDraft}
                onChangeText={(value) => {
                  setResolutionNoteDraft(value);
                  setResolutionNoteError(null);
                }}
                error={resolutionNoteError ?? undefined}
                multiline
                maxLength={MAX_RESOLUTION_NOTE_LENGTH}
              />
              <Text style={styles.fieldHint}>
                {resolutionNoteCounter(resolutionNoteDraft)} - stored encrypted; only you can read it.
              </Text>
              <View style={styles.editActionRow}>
                <Pressable style={styles.secondaryButton} onPress={cancelResolving} disabled={isSaving}>
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.primaryActionButton} onPress={resolveLatestCheckIn} disabled={isSaving}>
                  <Text style={styles.primaryButtonText}>{isSaving ? 'Saving...' : 'Mark resolved'}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Schedule</Text>
          <InfoRow label="Frequency" value={capitalize(receiver.scheduleFrequency)} />
          <InfoRow
            label="Window"
            value={`${receiver.scheduleTimeWindow.start ?? '09:00'} - ${receiver.scheduleTimeWindow.end ?? '11:00'}`}
          />
          <InfoRow label="Timezone" value={receiver.timezone} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Channels</Text>
          <InfoRow label="Primary" value={formatChannel(receiver.primaryChannel)} />
          <InfoRow label="Fallbacks" value={receiver.fallbackChannels.map(formatChannel).join(', ') || 'None'} />
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Backup Contacts</Text>
            {!isAddingBackupContact && backupContacts.length < 5 ? (
              <Pressable style={styles.smallButton} onPress={startAddingBackupContact} disabled={isSaving}>
                <Text style={styles.smallButtonText}>Add</Text>
              </Pressable>
            ) : null}
          </View>

          {backupContacts.length > 0 ? (
            <View style={styles.backupContactList}>
              {backupContacts.map((contact) => (
                <View key={contact.id} style={styles.backupContactItem}>
                  <View>
                    <Text style={styles.backupContactName}>{contact.displayName}</Text>
                    <Text style={styles.backupContactMeta}>
                      {contact.relationshipToReceiver} - {contact.phoneMasked}
                    </Text>
                  </View>
                  <Text style={styles.backupContactMeta}>
                    {contact.hasLocationInstructions ? 'Instructions saved' : 'No instructions'}
                  </Text>
                  <View style={styles.backupContactActions}>
                    <Pressable
                      style={styles.smallButton}
                      onPress={() => startEditingBackupContact(contact)}
                      disabled={isSaving}
                    >
                      <Text style={styles.smallButtonText}>Edit</Text>
                    </Pressable>
                    <Pressable
                      style={styles.smallButton}
                      onPress={() => removeBackupContact(contact)}
                      disabled={isSaving}
                    >
                      <Text style={styles.smallButtonText}>Remove</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.placeholderText}>{receiver.escalation.nextStep}</Text>
          )}

          {isAddingBackupContact ? (
            <View style={styles.backupContactForm}>
              <TextInput
                label={editingBackupContactId ? 'Backup name' : 'Backup name'}
                value={backupDraft.name}
                onChangeText={(name) => setBackupDraft({ ...backupDraft, name })}
              />
              <ReceiverPhoneInput
                label="Backup contact phone"
                phoneCountry={backupDraft.phoneCountry ?? 'AE'}
                phone={backupDraft.phone}
                onChangePhoneCountry={(phoneCountry) => setBackupDraft({ ...backupDraft, phoneCountry })}
                onChangePhone={(phone) => setBackupDraft({ ...backupDraft, phone: phone.replace(/\D/g, '') })}
                error={backupPhoneError}
                disabled={isSaving}
              />
              {editingBackupContactId ? (
                <Text style={styles.fieldHint}>Leave phone blank to keep the current number.</Text>
              ) : null}
              <View>
                <TextInput
                  label="Relationship"
                  value={backupDraft.relationshipToReceiver}
                  onChangeText={(relationshipToReceiver) => setBackupDraft({ ...backupDraft, relationshipToReceiver })}
                />
              </View>
              <TextInput
                label="Location instructions"
                value={backupDraft.locationInstructions}
                onChangeText={(locationInstructions) => setBackupDraft({ ...backupDraft, locationInstructions })}
              />
              <View style={styles.editActionRow}>
                <Pressable style={styles.secondaryButton} onPress={cancelAddingBackupContact} disabled={isSaving}>
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.primaryActionButton} onPress={saveBackupContact} disabled={isSaving}>
                  <Text style={styles.primaryButtonText}>
                    {isSaving ? 'Saving...' : editingBackupContactId ? 'Update' : 'Save'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.actionRow}>
          <Pressable style={styles.secondaryButton} onPress={togglePause} disabled={isSaving}>
            <Text style={styles.secondaryButtonText}>{isPaused ? 'Resume' : 'Pause'}</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={startEditing} disabled={isSaving || isEditing}>
            <Text style={styles.secondaryButtonText}>Edit</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={removeReceiver} disabled={isSaving}>
            <Text style={styles.secondaryButtonText}>Remove</Text>
          </Pressable>
        </View>
      </ScrollView>
      <StepUpCodeModal
        visible={Boolean(stepUpPrompt)}
        title={stepUpPrompt?.title ?? ''}
        message={stepUpPrompt?.message ?? ''}
        code={stepUpCode}
        onChangeCode={setStepUpCode}
        onCancel={() => resolveStepUpPrompt(null)}
        onSubmit={() => resolveStepUpPrompt(stepUpCode.trim() || null)}
      />
    </>
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

function receiverStatusColor(tone: ReceiverStatusTone): string {
  if (tone === 'error') return colors.error;
  if (tone === 'warning') return colors.warning;
  if (tone === 'muted') return colors.textLight;
  return colors.success;
}

function formatCheckInStatus(status?: string): string {
  if (!status) return 'No check-ins yet';
  if (status === 'NEEDS_ATTENTION') return 'Needs attention';
  return status.split('_').map(capitalize).join(' ');
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
  consentRow: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  consentText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  inlineActionButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
    marginTop: spacing.xs,
  },
  noticeBox: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  noticeText: {
    color: colors.text,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  resolveForm: {
    gap: spacing.sm,
    marginTop: spacing.md,
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
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
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
  fieldHint: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
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
  attentionPanel: {
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: borderRadius.md,
    backgroundColor: colors.warning + '12',
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  attentionTitle: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  attentionText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  backupContactList: {
    gap: spacing.sm,
  },
  backupContactItem: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    gap: spacing.xs,
    backgroundColor: colors.background,
  },
  backupContactName: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  backupContactMeta: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  backupContactActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  backupContactForm: {
    gap: spacing.md,
    marginTop: spacing.md,
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
  smallButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
  },
  smallButtonText: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  resolveButton: {
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  resolveButtonText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  checkInActionStack: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  secondaryActionButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.surface,
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
