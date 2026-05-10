// Data & Privacy settings screen
import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { colors, spacing, fontSize, borderRadius } from '../../../theme';
import { useAuthContext } from '../../../contexts/AuthContext';
import {
  downloadUserData,
  deleteUserAccount,
  requestAccountStepUp,
  verifyAccountStepUp,
  type BackendSensitiveAction,
} from '../../../services';

export default function DataPrivacyScreen() {
  const router = useRouter();
  const { user } = useAuthContext();
  const [isExporting, setIsExporting] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const handleExportData = async () => {
    if (!user?.id) return;

    setIsExporting(true);
    try {
      const stepUpToken = await completeStepUp('EXPORT_DATA');
      if (!stepUpToken) return;

      const success = await downloadUserData(stepUpToken);
      if (success) {
        Alert.alert('Success', 'Your data has been exported successfully.');
      } else {
        Alert.alert('Error', 'Failed to export data. Please try again.');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to export data. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account and all associated data including:\n\n• Your profile\n• All receivers\n• All check-in history\n• All escalation data\n• Your subscription\n\nThis action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: confirmDeleteAccount,
        },
      ]
    );
  };

  const confirmDeleteAccount = () => {
    Alert.alert(
      'Final Confirmation',
      'Your account will be permanently deleted. You will be signed out immediately.\n\nAre you sure you want to proceed?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, Delete My Account',
          style: 'destructive',
          onPress: executeDeleteAccount,
        },
      ]
    );
  };

  const executeDeleteAccount = async () => {
    if (!user?.id) return;

    setIsDeletingAccount(true);
    try {
      const stepUpToken = await completeStepUp('DELETE_ACCOUNT');
      if (!stepUpToken) {
        setIsDeletingAccount(false);
        return;
      }

      const result = await deleteUserAccount(stepUpToken);
      if (result.success) {
        // User will be signed out automatically
        router.replace('/(auth)/welcome');
      } else {
        Alert.alert('Error', result.error || 'Failed to delete account. Please try again.');
        setIsDeletingAccount(false);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to delete account. Please try again.');
      setIsDeletingAccount(false);
    }
  };

  const completeStepUp = async (action: BackendSensitiveAction): Promise<string | null> => {
    const requested = await requestAccountStepUp(action);
    const code = await promptForOtp(action, requested.expiresAt);

    if (!code) {
      Alert.alert('Verification required', 'Enter the SMS code to continue.');
      return null;
    }

    const verified = await verifyAccountStepUp({ challengeId: requested.challengeId, code });
    return verified.stepUpToken;
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Back Button */}
      <Pressable onPress={() => router.back()} style={styles.backButton}>
        <Text style={styles.backButtonText}>← Back</Text>
      </Pressable>

      <Text style={styles.title}>Data & Privacy</Text>
      <Text style={styles.subtitle}>Manage your data and account</Text>

      {/* Export Data Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Your Data</Text>
        <View style={styles.card}>
          <Text style={styles.cardIcon}>📦</Text>
          <View style={styles.cardContent}>
            <Text style={styles.cardTitle}>Export Data</Text>
            <Text style={styles.cardDescription}>
              Download a copy of all your data in JSON format including your profile, receivers, check-ins, and settings.
            </Text>
          </View>
          <Pressable
            style={[styles.actionButton, styles.exportButton]}
            onPress={handleExportData}
            disabled={isExporting}
          >
            {isExporting ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={styles.exportButtonText}>Export</Text>
            )}
          </Pressable>
        </View>
      </View>

      {/* Delete Account Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, styles.dangerTitle]}>Danger Zone</Text>

        <View style={[styles.card, styles.dangerCard]}>
          <Text style={styles.cardIcon}>⚠️</Text>
          <View style={styles.cardContent}>
            <Text style={styles.cardTitle}>Delete Account</Text>
            <Text style={styles.cardDescription}>
              Permanently delete your account and all associated data. This action cannot be undone.
            </Text>
          </View>
          <Pressable
            style={[styles.actionButton, styles.deleteAccountButton]}
            onPress={handleDeleteAccount}
            disabled={isDeletingAccount}
          >
            {isDeletingAccount ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.deleteAccountButtonText}>Delete</Text>
            )}
          </Pressable>
        </View>
      </View>

      {/* Privacy Info */}
      <View style={styles.infoSection}>
        <Text style={styles.infoTitle}>Privacy Information</Text>
        <Text style={styles.infoText}>
          • Your data is stored securely on Supabase servers{'\n'}
          • We use Row Level Security to protect your data{'\n'}
          • You can export your data or delete your account at any time{'\n'}
          • Nearby is not an emergency service
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
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
  },
  backButton: {
    marginBottom: spacing.lg,
  },
  backButtonText: {
    color: colors.primary,
    fontSize: fontSize.md,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.md,
  },
  dangerTitle: {
    color: colors.error,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  dangerCard: {
    borderColor: colors.error + '40',
    backgroundColor: colors.error + '05',
  },
  cardIcon: {
    fontSize: 24,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  cardDescription: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  actionButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    minWidth: 70,
    alignItems: 'center',
  },
  exportButton: {
    backgroundColor: colors.primary + '15',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  exportButtonText: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  deleteAccountButton: {
    backgroundColor: colors.error,
  },
  deleteAccountButtonText: {
    color: '#FFFFFF',
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  infoSection: {
    backgroundColor: colors.primary + '10',
    padding: spacing.md,
    borderRadius: borderRadius.md,
    marginTop: spacing.md,
  },
  infoTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  infoText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
  },
});

async function promptForOtp(action: BackendSensitiveAction, expiresAt: string): Promise<string | null> {
  const title = action === 'DELETE_ACCOUNT' ? 'Confirm account deletion' : 'Confirm data export';
  const message = `Enter the SMS verification code. It expires at ${new Date(expiresAt).toLocaleTimeString()}.`;
  const browserPrompt = globalThis.prompt;

  if (typeof browserPrompt === 'function') {
    return browserPrompt(`${title}\n\n${message}`)?.trim() || null;
  }

  const nativePrompt = (Alert as unknown as { prompt?: Function }).prompt;
  if (typeof nativePrompt === 'function') {
    return await new Promise((resolve) => {
      nativePrompt(
        title,
        message,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
          { text: 'Verify', onPress: (value?: string) => resolve(value?.trim() || null) },
        ],
        'plain-text',
      );
    });
  }

  Alert.alert('Verification required', 'SMS code entry is not available on this platform yet.');
  return null;
}
