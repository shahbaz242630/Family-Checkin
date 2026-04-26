// User data service - export, delete data, delete account
// Uses Edge Functions for server-side operations
import { supabase } from './supabase';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export interface UserDataExport {
  exportedAt: string;
  exportVersion: string;
  user: any;
  lovedOnes: any[];
  relationships: any[];
  checkinSchedules: any[];
  checkins: any[];
  escalationPlans: any[];
  escalationEvents: any[];
  contactPoints: any[];
  subscriptions: any[];
  deviceTokens: any[];
}

/**
 * Export all user data via Edge Function
 */
export async function exportUserData(): Promise<UserDataExport | null> {
  try {
    const { data, error } = await supabase.functions.invoke('export-data');

    if (error) {
      console.error('Export function error:', error);
      return null;
    }

    return data as UserDataExport;
  } catch (error) {
    console.error('Error exporting user data:', error);
    return null;
  }
}

/**
 * Save exported data to file and share
 */
export async function downloadUserData(): Promise<boolean> {
  try {
    const data = await exportUserData();
    if (!data) return false;

    const fileName = `family-checkin-data-${new Date().toISOString().split('T')[0]}.json`;
    const filePath = `${FileSystem.documentDirectory}${fileName}`;

    // Write JSON to file
    await FileSystem.writeAsStringAsync(filePath, JSON.stringify(data, null, 2));

    // Check if sharing is available
    const isAvailable = await Sharing.isAvailableAsync();
    if (isAvailable) {
      await Sharing.shareAsync(filePath, {
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
 * Delete all user data but keep the account via Edge Function
 */
export async function deleteUserDataOnly(): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('delete-data');

    if (error) {
      console.error('Delete data function error:', error);
      return { success: false, error: error.message || 'Failed to delete data' };
    }

    return { success: true, message: data?.message || 'Data deleted successfully' };
  } catch (error) {
    console.error('Error deleting user data:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
}

/**
 * Delete entire account and all data via Edge Function
 */
export async function deleteUserAccount(): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('delete-account');

    if (error) {
      console.error('Delete account function error:', error);
      return { success: false, error: error.message || 'Failed to delete account' };
    }

    // Sign out locally after successful deletion
    await supabase.auth.signOut();

    return { success: true, message: data?.message || 'Account deleted successfully' };
  } catch (error) {
    console.error('Error deleting user account:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
}
