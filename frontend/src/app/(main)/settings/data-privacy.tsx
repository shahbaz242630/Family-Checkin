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
  deleteUserDataOnly,
  deleteUserAccount,
} from '../../../services';

export default function DataPrivacyScreen() {
  const router = useRouter();
  const { user } = useAuthContext();
  const [isExporting, setIsExporting] = useState(false);
  const [isDeletingData, setIsDeletingData] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const handleExportData = async () => {
    if (!user?.id) return;

    setIsExporting(true);
    try {
      const success = await downloadUserData();
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

  const handleDeleteDataOnly = () => {
    Alert.alert(
      'Delete All Data',
      'This will permanently delete all your check-ins, loved ones, schedules, and escalation data. Your account will remain active.\n\nThis action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Data',
          style: 'destructive',
          onPress: confirmDeleteData,
        },
      ]
    );
  };

  const confirmDeleteData = () => {
    Alert.alert(
      'Are you absolutely sure?',
      'All your data will be permanently deleted. This cannot be recovered.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, Delete All Data',
          style: 'destructive',
          onPress: executeDeleteData,
        },
      ]
    );
  };

  const executeDeleteData = async () => {
    if (!user?.id) return;

    setIsDeletingData(true);
    try {
      const result = await deleteUserDataOnly();
      if (result.success) {
        Alert.alert('Success', result.message || 'All your data has been deleted. Your account is still active.');
      } else {
        Alert.alert('Error', result.error || 'Failed to delete data. Please try again.');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to delete data. Please try again.');
    } finally {
      setIsDeletingData(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account and all associated data including:\n\n• Your profile\n• All loved ones\n• All check-in history\n• All escalation data\n• Your subscription\n\nThis action cannot be undone.',
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
      const result = await deleteUserAccount();
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
              Download a copy of all your data in JSON format including your profile, loved ones, check-ins, and settings.
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

      {/* Delete Data Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Data Management</Text>

        <View style={styles.card}>
          <Text style={styles.cardIcon}>🗑️</Text>
          <View style={styles.cardContent}>
            <Text style={styles.cardTitle}>Delete All Data</Text>
            <Text style={styles.cardDescription}>
              Remove all your check-ins, loved ones, and schedules. Your account will remain active.
            </Text>
          </View>
          <Pressable
            style={[styles.actionButton, styles.deleteDataButton]}
            onPress={handleDeleteDataOnly}
            disabled={isDeletingData}
          >
            {isDeletingData ? (
              <ActivityIndicator size="small" color={colors.error} />
            ) : (
              <Text style={styles.deleteDataButtonText}>Delete</Text>
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
          • You can export or delete your data at any time{'\n'}
          • Deleted data cannot be recovered
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
  deleteDataButton: {
    backgroundColor: colors.error + '15',
    borderWidth: 1,
    borderColor: colors.error,
  },
  deleteDataButtonText: {
    color: colors.error,
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
