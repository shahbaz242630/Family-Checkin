// Edge Function: Delete user account and all data
// Uses anon key + user JWT - RLS policies ensure data security

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get auth token from request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with user's JWT (RLS policies apply)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Get user from token
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;

    // Delete all user data in order (respecting foreign keys)
    // RLS policies ensure user can only delete their own data

    // 1. Delete relationships (cascades to schedules, checkins, escalation plans)
    await supabase.from('relationships').delete().eq('owner_user_id', userId);

    // 2. Delete loved one profiles
    await supabase.from('loved_one_profiles').delete().eq('owner_user_id', userId);

    // 3. Delete contact points
    await supabase.from('contact_points').delete().eq('owner_user_id', userId);

    // 4. Delete device tokens
    await supabase.from('device_tokens').delete().eq('user_id', userId);

    // 5. Delete pairing codes
    await supabase.from('pairing_codes').delete().eq('generated_by_user_id', userId);

    // 6. Delete user profile from public.users
    await supabase.from('users').delete().eq('id', userId);

    // 7. Sign out the user
    await supabase.auth.signOut();

    return new Response(
      JSON.stringify({ success: true, message: 'Account deleted successfully' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Delete account error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to delete account' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
