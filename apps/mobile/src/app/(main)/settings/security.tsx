// Alerts & security settings.
//
// CB-034 removed the biometric toggle: it stored a flag no login path ever read.
// CB-035 replaced it with the one check a sender actually needs — proving the
// escalation siren can reach this phone.
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, fontSize, borderRadius } from '../../../theme';
import { ScreenHeader } from '../../../components/common';
import {
  readSirenReadiness,
  scheduleSirenTest,
  SIREN_TEST_DELAY_SECONDS,
  type CriticalAlertState,
  type DoNotDisturbState,
  type EmergencyChannelState,
  type PushPermissionState,
  type SirenReadiness,
} from '../../../services/pushNotifications';

/** Android `AndroidImportance.HIGH`; below this the channel does not make a sound. */
const AUDIBLE_IMPORTANCE = 6;

type Tone = 'good' | 'warn' | 'bad' | 'muted';

interface StatusRow {
  label: string;
  value: string;
  tone: Tone;
  hint?: string;
}

export default function SecurityScreen() {
  const insets = useSafeAreaInsets();
  const [readiness, setReadiness] = useState<SirenReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: Tone } | null>(null);

  const loadReadiness = useCallback(async () => {
    try {
      setReadiness(await readSirenReadiness());
    } catch {
      setReadiness(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Senders leave for the phone's notification settings and come back, so the
  // status has to be re-read on focus rather than only on first mount.
  useFocusEffect(
    useCallback(() => {
      loadReadiness();
    }, [loadReadiness]),
  );

  async function handleTestSiren() {
    setTesting(true);
    setNotice(null);
    try {
      const outcome = await scheduleSirenTest();
      if (outcome.scheduled) {
        setNotice({
          text: `Siren scheduled. Lock your phone or switch apps now — it plays in ${outcome.delaySeconds} seconds.`,
          tone: 'good',
        });
      } else {
        setNotice({ text: outcome.reason, tone: 'bad' });
      }
    } catch (error) {
      setNotice({
        text: error instanceof Error ? error.message : 'The siren test could not be started.',
        tone: 'bad',
      });
    } finally {
      setTesting(false);
      await loadReadiness();
    }
  }

  const available = readiness?.availability.available ?? false;
  const rows = readiness ? statusRows(readiness) : [];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader title="Alerts & security" showBack />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Emergency siren</Text>
          <Text style={styles.sectionDescription}>
            When a check-in goes unanswered Nearby sends you a siren alert. Test it here so you know what it sounds like
            and that it reaches this phone.
          </Text>

          {loading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <>
              {!available && readiness?.availability.reason && (
                <Text style={styles.blockedText}>{readiness.availability.reason}</Text>
              )}

              <Pressable
                style={[styles.testButton, (!available || testing) && styles.buttonDisabled]}
                disabled={!available || testing}
                onPress={handleTestSiren}
              >
                <Text style={styles.testButtonText}>{testing ? 'Scheduling...' : 'Play test siren'}</Text>
              </Pressable>

              <Text style={styles.hint}>
                The test alert waits {SIREN_TEST_DELAY_SECONDS} seconds so you can lock the phone first. It goes to you
                only — no receiver or backup contact is contacted.
              </Text>

              {notice && <Text style={[styles.notice, toneStyle(notice.tone)]}>{notice.text}</Text>}
            </>
          )}
        </View>

        {!loading && rows.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Alert delivery</Text>
            {rows.map((row) => (
              <View key={row.label} style={styles.infoRow}>
                <View style={styles.infoLabelGroup}>
                  <Text style={styles.infoLabel}>{row.label}</Text>
                  {row.hint && <Text style={styles.infoHint}>{row.hint}</Text>}
                </View>
                <Text style={[styles.infoValue, toneStyle(row.tone)]}>{row.value}</Text>
              </View>
            ))}
            <Pressable style={styles.recheckButton} onPress={loadReadiness}>
              <Text style={styles.recheckButtonText}>Recheck</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Security tips</Text>
          <View style={styles.tipsList}>
            <Text style={styles.tip}>• Keep your device passcode secure</Text>
            <Text style={styles.tip}>• Don&apos;t share your login credentials</Text>
            <Text style={styles.tip}>• Log out when using shared devices</Text>
            <Text style={styles.tip}>• Nearby is not an emergency service — call local emergency numbers first</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function statusRows(readiness: SirenReadiness): StatusRow[] {
  if (!readiness.availability.available) {
    return [];
  }

  const rows: StatusRow[] = [permissionRow(readiness.permission, readiness.canAskAgain)];

  if (readiness.doNotDisturb !== 'unknown') {
    rows.push(doNotDisturbRow(readiness.doNotDisturb, readiness.channel));
  }

  if (readiness.channel) {
    rows.push(channelRow(readiness.channel));
  }

  if (readiness.criticalAlerts !== 'unknown') {
    rows.push({
      label: 'Critical alerts',
      value: readiness.criticalAlerts === 'allowed' ? 'Allowed' : 'Not allowed',
      tone: readiness.criticalAlerts === 'allowed' ? 'good' : 'muted',
      hint: 'Critical alerts would ring through Focus. Nearby has not been granted this by Apple.',
    });
  }

  return rows;
}

function permissionRow(permission: PushPermissionState, canAskAgain: boolean): StatusRow {
  switch (permission) {
    case 'granted':
      return { label: 'Notifications', value: 'Allowed', tone: 'good' };
    case 'denied':
      return {
        label: 'Notifications',
        value: 'Blocked',
        tone: 'bad',
        hint: canAskAgain
          ? 'Nearby cannot alert you. Allow notifications when asked.'
          : 'Nearby cannot alert you. Turn notifications on in your phone settings.',
      };
    case 'undetermined':
      return {
        label: 'Notifications',
        value: 'Not asked yet',
        tone: 'warn',
        hint: 'The siren test will ask for permission.',
      };
    default:
      return { label: 'Notifications', value: 'Unknown', tone: 'muted' };
  }
}

function doNotDisturbRow(state: DoNotDisturbState, channel: EmergencyChannelState | null): StatusRow {
  const bypasses = channel?.bypassesDoNotDisturb === true;

  switch (state) {
    case 'off':
      return { label: 'Do Not Disturb', value: 'Off', tone: 'good' };
    case 'priority-only':
      return {
        label: 'Do Not Disturb',
        value: 'Priority only',
        tone: bypasses ? 'good' : 'warn',
        hint: bypasses
          ? 'Emergency alerts are allowed through.'
          : 'A siren may be silenced. Allow Nearby emergency alerts in your Do Not Disturb exceptions.',
      };
    case 'alarms-only':
      return {
        label: 'Do Not Disturb',
        value: 'Alarms only',
        tone: 'bad',
        hint: 'Only alarms make a sound. A siren will arrive silently.',
      };
    case 'silent':
      return {
        label: 'Do Not Disturb',
        value: 'Total silence',
        tone: 'bad',
        hint: 'Nothing makes a sound while this is on. A siren will arrive silently.',
      };
    default:
      return { label: 'Do Not Disturb', value: 'Unknown', tone: 'muted' };
  }
}

function channelRow(channel: EmergencyChannelState): StatusRow {
  if (!channel.exists) {
    return {
      label: 'Emergency alerts channel',
      value: 'Not created yet',
      tone: 'warn',
      hint: 'Run the siren test to create it.',
    };
  }

  const audible = channel.importance === null || channel.importance >= AUDIBLE_IMPORTANCE;

  if (!audible) {
    return {
      label: 'Emergency alerts channel',
      value: 'Turned down',
      tone: 'bad',
      hint: 'You lowered this channel in Android settings, so the siren will not make a sound.',
    };
  }

  if (channel.sound === 'custom') {
    return { label: 'Emergency alerts channel', value: 'Siren sound', tone: 'good' };
  }

  return {
    label: 'Emergency alerts channel',
    value: channel.sound === 'silent' ? 'Silent' : 'Default sound',
    tone: channel.sound === 'silent' ? 'bad' : 'warn',
    hint: 'This channel is not using the Nearby siren. Check its sound in Android settings.',
  };
}

function toneStyle(tone: Tone) {
  switch (tone) {
    case 'good':
      return { color: colors.success };
    case 'warn':
      return { color: colors.warning };
    case 'bad':
      return { color: colors.error };
    default:
      return { color: colors.textSecondary };
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
  },
  section: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
  },
  sectionDescription: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  blockedText: {
    fontSize: fontSize.sm,
    color: colors.warning,
    lineHeight: 20,
  },
  testButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  testButtonText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  hint: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  notice: {
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  infoLabelGroup: {
    flex: 1,
  },
  infoLabel: {
    fontSize: fontSize.md,
    color: colors.text,
  },
  infoHint: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 18,
  },
  infoValue: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  recheckButton: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  recheckButtonText: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  tipsList: {
    gap: spacing.xs,
  },
  tip: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 22,
  },
});
