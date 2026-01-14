// Edge Function: Export all user data as JSON
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

    // Create Supabase client
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

    // Fetch all user data (RLS will ensure only user's data is returned)
    const [
      userProfile,
      lovedOnes,
      relationships,
      contactPoints,
      subscriptions,
      deviceTokens,
    ] = await Promise.all([
      supabase.from('users').select('*').eq('id', userId).single(),
      supabase.from('loved_one_profiles').select('*').eq('owner_user_id', userId),
      supabase.from('relationships').select('*').eq('owner_user_id', userId),
      supabase.from('contact_points').select('*').eq('owner_user_id', userId),
      supabase.from('subscriptions').select('*').eq('user_id', userId),
      supabase.from('device_tokens').select('*').eq('user_id', userId),
    ]);

    // Get relationship IDs for nested data
    const relationshipIds = relationships.data?.map((r: any) => r.id) || [];

    // Fetch relationship-dependent data
    let checkinSchedules = { data: [] };
    let checkins = { data: [] };
    let escalationPlans = { data: [] };

    if (relationshipIds.length > 0) {
      [checkinSchedules, checkins, escalationPlans] = await Promise.all([
        supabase.from('checkin_schedules').select('*').in('relationship_id', relationshipIds),
        supabase.from('checkins').select('*').in('relationship_id', relationshipIds),
        supabase.from('escalation_plans').select('*').in('relationship_id', relationshipIds),
      ]);
    }

    // Get checkin IDs for escalation events
    const checkinIds = checkins.data?.map((c: any) => c.id) || [];
    let escalationEvents = { data: [] };

    if (checkinIds.length > 0) {
      escalationEvents = await supabase
        .from('escalation_events')
        .select('*')
        .in('checkin_id', checkinIds);
    }

    // Compile export data
    const exportData = {
      exportedAt: new Date().toISOString(),
      exportVersion: '1.0',
      user: {
        id: user.id,
        email: user.email,
        profile: userProfile.data,
      },
      lovedOnes: lovedOnes.data || [],
      relationships: relationships.data || [],
      checkinSchedules: checkinSchedules.data || [],
      checkins: checkins.data || [],
      escalationPlans: escalationPlans.data || [],
      escalationEvents: escalationEvents.data || [],
      contactPoints: contactPoints.data || [],
      subscriptions: subscriptions.data || [],
      deviceTokens: deviceTokens.data || [],
    };

    return new Response(
      JSON.stringify(exportData, null, 2),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="family-checkin-export-${new Date().toISOString().split('T')[0]}.json"`,
        },
      }
    );

  } catch (error) {
    console.error('Export data error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to export data' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
