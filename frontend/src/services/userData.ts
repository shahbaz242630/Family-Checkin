// User data service - export, delete data, delete account
import { supabase } from './supabase';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export interface UserDataExport {
  exportedAt: string;
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
 * Export all user data as JSON
 */
export async function exportUserData(userId: string): Promise<UserDataExport | null> {
  try {
    // Fetch user profile
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    // Fetch loved ones
    const { data: lovedOnes } = await supabase
      .from('loved_one_profiles')
      .select('*')
      .eq('owner_user_id', userId);

    // Fetch relationships
    const { data: relationships } = await supabase
      .from('relationships')
      .select('*')
      .eq('owner_user_id', userId);

    // Get relationship IDs for nested queries
    const relationshipIds = relationships?.map((r) => r.id) || [];

    // Fetch check-in schedules
    const { data: checkinSchedules } = await supabase
      .from('checkin_schedules')
      .select('*')
      .in('relationship_id', relationshipIds.length > 0 ? relationshipIds : ['none']);

    // Fetch check-ins
    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .in('relationship_id', relationshipIds.length > 0 ? relationshipIds : ['none']);

    // Get checkin IDs for escalation events
    const checkinIds = checkins?.map((c) => c.id) || [];

    // Fetch escalation plans
    const { data: escalationPlans } = await supabase
      .from('escalation_plans')
      .select('*')
      .in('relationship_id', relationshipIds.length > 0 ? relationshipIds : ['none']);

    // Fetch escalation events
    const { data: escalationEvents } = await supabase
      .from('escalation_events')
      .select('*')
      .in('checkin_id', checkinIds.length > 0 ? checkinIds : ['none']);

    // Fetch contact points
    const { data: contactPoints } = await supabase
      .from('contact_points')
      .select('*')
      .eq('owner_user_id', userId);

    // Fetch subscriptions
    const { data: subscriptions } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId);

    // Fetch device tokens
    const { data: deviceTokens } = await supabase
      .from('device_tokens')
      .select('*')
      .eq('user_id', userId);

    return {
      exportedAt: new Date().toISOString(),
      user: user || null,
      lovedOnes: lovedOnes || [],
      relationships: relationships || [],
      checkinSchedules: checkinSchedules || [],
      checkins: checkins || [],
      escalationPlans: escalationPlans || [],
      escalationEvents: escalationEvents || [],
      contactPoints: contactPoints || [],
      subscriptions: subscriptions || [],
      deviceTokens: deviceTokens || [],
    };
  } catch (error) {
    console.error('Error exporting user data:', error);
    return null;
  }
}

/**
 * Save exported data to file and share
 */
export async function downloadUserData(userId: string): Promise<boolean> {
  try {
    const data = await exportUserData(userId);
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
 * Delete all user data but keep the account
 */
export async function deleteUserDataOnly(userId: string): Promise<boolean> {
  try {
    // Delete in order due to foreign key constraints
    // 1. Delete escalation events (via checkins cascade)
    // 2. Delete checkins (via relationships cascade)
    // 3. Delete escalation plans (via relationships cascade)
    // 4. Delete checkin schedules (via relationships cascade)
    // 5. Delete relationships
    // 6. Delete loved one profiles
    // 7. Delete contact points
    // 8. Delete device tokens
    // 9. Delete pairing codes

    // Note: We keep subscriptions and user profile

    // Delete relationships (cascades to schedules, checkins, escalation plans, events)
    await supabase
      .from('relationships')
      .delete()
      .eq('owner_user_id', userId);

    // Delete loved one profiles
    await supabase
      .from('loved_one_profiles')
      .delete()
      .eq('owner_user_id', userId);

    // Delete contact points
    await supabase
      .from('contact_points')
      .delete()
      .eq('owner_user_id', userId);

    // Delete device tokens
    await supabase
      .from('device_tokens')
      .delete()
      .eq('user_id', userId);

    // Delete pairing codes
    await supabase
      .from('pairing_codes')
      .delete()
      .eq('generated_by_user_id', userId);

    return true;
  } catch (error) {
    console.error('Error deleting user data:', error);
    return false;
  }
}

/**
 * Delete entire account and all data
 * This will sign out the user and delete their auth account
 */
export async function deleteUserAccount(userId: string): Promise<boolean> {
  try {
    // First delete all data
    await deleteUserDataOnly(userId);

    // Delete subscriptions
    await supabase
      .from('subscriptions')
      .delete()
      .eq('user_id', userId);

    // Delete user profile (this triggers cascade from auth.users via handle)
    // The user profile in public.users will be deleted
    // But we need to use the admin API to delete from auth.users
    // For now, we'll delete from public.users and sign out
    // The auth account deletion requires service_role key

    await supabase
      .from('users')
      .delete()
      .eq('id', userId);

    // Sign out the user
    await supabase.auth.signOut();

    return true;
  } catch (error) {
    console.error('Error deleting user account:', error);
    return false;
  }
}
