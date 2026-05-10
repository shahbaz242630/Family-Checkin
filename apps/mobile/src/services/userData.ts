// User data service - export, delete data, delete account
import { supabase } from './supabase';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { deleteAccount, exportAccountData } from './backendApi';

export interface UserDataExport {
  exportedAt: string;
  exportVersion: string;
  user: any;
  receivers?: any[];
  backupContacts?: any[];
  checkins: any[];
  attempts?: any[];
  escalationEvents: any[];
  subscriptions: any[];
  auditLogs?: any[];
}

/**
 * Export all user data via backend account privacy endpoint.
 */
export async function exportUserData(stepUpToken: string): Promise<UserDataExport | null> {
  try {
    return (await exportAccountData(stepUpToken)) as UserDataExport;
  } catch (error) {
    console.error('Error exporting user data:', error);
    return null;
  }
}

/**
 * Save exported data to file and share
 */
export async function downloadUserData(stepUpToken: string): Promise<boolean> {
  try {
    const data = await exportUserData(stepUpToken);
    if (!data) return false;

    const fileName = `family-checkin-data-${new Date().toISOString().split('T')[0]}.json`;
    const file = new File(Paths.document, fileName);

    file.create({ overwrite: true });
    file.write(JSON.stringify(data, null, 2));

    // Check if sharing is available
    const isAvailable = await Sharing.isAvailableAsync();
    if (isAvailable) {
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        dialogTitle: 'Export Your Data',
      });
    }

    return true;
  } catch (error) {
    console.error('Error downloading user data:', error);
    return false;
  }
}

/**
 * Delete entire account and all data via backend account privacy endpoint.
 */
export async function deleteUserAccount(stepUpToken: string): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const data = await deleteAccount(stepUpToken);
    // Sign out locally after successful deletion
    await supabase.auth.signOut();

    return { success: true, message: `Account deleted successfully at ${data.deletedAt}` };
  } catch (error) {
    console.error('Error deleting user account:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
}
