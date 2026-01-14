-- Family Check-In Database Schema
-- Based on BRD Step 15 - Data Models

-- Use gen_random_uuid() which is built into PostgreSQL 13+

-- ============================================
-- ENUM TYPES
-- ============================================

CREATE TYPE relationship_type AS ENUM (
  'mother', 'father', 'child', 'partner',
  'brother', 'sister', 'relative', 'other'
);

CREATE TYPE relationship_mode AS ENUM ('one_way', 'two_way');

CREATE TYPE subscription_tier AS ENUM ('free', 'one_way', 'two_way', 'pro_family');

CREATE TYPE subscription_status AS ENUM ('active', 'trialing', 'past_due', 'canceled', 'expired');

CREATE TYPE checkin_status AS ENUM (
  'pending', 'snoozed', 'confirmed',
  'escalating', 'escalated', 'resolved', 'canceled'
);

CREATE TYPE escalation_channel AS ENUM ('push', 'whatsapp', 'sms', 'voice', 'email');

CREATE TYPE response_method AS ENUM ('app', 'whatsapp', 'sms', 'voice');

CREATE TYPE pairing_code_status AS ENUM ('active', 'used', 'expired', 'revoked');

CREATE TYPE platform_type AS ENUM ('ios', 'android');

CREATE TYPE supported_language AS ENUM ('en', 'ar', 'ur');

-- ============================================
-- TABLES
-- ============================================

-- Users table (extends Supabase auth.users)
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE,
  phone_e164 TEXT UNIQUE,
  full_name TEXT NOT NULL,
  locale supported_language DEFAULT 'en',
  timezone TEXT NOT NULL DEFAULT 'Asia/Dubai',
  country TEXT NOT NULL DEFAULT 'AE',
  role_default TEXT DEFAULT 'owner',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ
);

-- Loved one profiles
CREATE TABLE public.loved_one_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  linked_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  relationship_type relationship_type NOT NULL,
  preferred_channels JSONB DEFAULT '{"push": true, "whatsapp": true, "sms": false, "voice": false, "email": false}',
  preferred_language supported_language DEFAULT 'en',
  timezone TEXT NOT NULL DEFAULT 'Asia/Dubai',
  phone_e164 TEXT,
  email TEXT,
  large_text_enabled BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Relationships between users and loved ones
CREATE TABLE public.relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  loved_one_profile_id UUID NOT NULL REFERENCES public.loved_one_profiles(id) ON DELETE CASCADE,
  relationship_mode relationship_mode DEFAULT 'one_way',
  can_initiate_checkin BOOLEAN DEFAULT TRUE,
  can_receive_alerts BOOLEAN DEFAULT TRUE,
  subscription_tier_required subscription_tier DEFAULT 'free',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(owner_user_id, loved_one_profile_id)
);

-- Pairing codes for app-to-app linking
CREATE TABLE public.pairing_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  generated_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_owner_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_profile_id UUID REFERENCES public.loved_one_profiles(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  status pairing_code_status DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Check-in schedules
CREATE TABLE public.checkin_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id UUID NOT NULL REFERENCES public.relationships(id) ON DELETE CASCADE,
  schedule_type TEXT DEFAULT 'daily' CHECK (schedule_type IN ('daily', 'multi_daily', 'temporary')),
  time_local TIME NOT NULL DEFAULT '09:00',
  days_of_week INTEGER[] DEFAULT '{0,1,2,3,4,5,6}',
  start_date DATE,
  end_date DATE,
  grace_period_minutes INTEGER DEFAULT 30,
  max_retries INTEGER DEFAULT 2,
  retry_interval_minutes INTEGER DEFAULT 10,
  is_enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Check-in instances
CREATE TABLE public.checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id UUID NOT NULL REFERENCES public.relationships(id) ON DELETE CASCADE,
  schedule_id UUID NOT NULL REFERENCES public.checkin_schedules(id) ON DELETE CASCADE,
  due_at TIMESTAMPTZ NOT NULL,
  status checkin_status DEFAULT 'pending',
  responded_at TIMESTAMPTZ,
  response_method response_method,
  snooze_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Escalation plans
CREATE TABLE public.escalation_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id UUID NOT NULL REFERENCES public.relationships(id) ON DELETE CASCADE,
  plan_name TEXT NOT NULL DEFAULT 'Default',
  steps JSONB NOT NULL DEFAULT '[
    {"channel": "push", "delay_min": 0},
    {"channel": "whatsapp", "delay_min": 10},
    {"channel": "sms", "delay_min": 20}
  ]',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Escalation events (audit log)
CREATE TABLE public.escalation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkin_id UUID NOT NULL REFERENCES public.checkins(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  channel escalation_channel NOT NULL,
  target TEXT NOT NULL,
  status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'failed')),
  provider_message_id TEXT,
  error_code TEXT,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Emergency/backup contacts
CREATE TABLE public.contact_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  phone_e164 TEXT,
  email TEXT,
  preferred_channels JSONB DEFAULT '{"push": false, "whatsapp": true, "sms": true, "voice": false, "email": false}',
  priority INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Subscriptions
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  platform platform_type NOT NULL,
  product_id TEXT NOT NULL,
  tier subscription_tier NOT NULL DEFAULT 'free',
  status subscription_status NOT NULL DEFAULT 'active',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  external_transaction_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Device tokens for push notifications
CREATE TABLE public.device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  platform platform_type NOT NULL,
  token TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  last_registered_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, token)
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_loved_one_profiles_owner ON public.loved_one_profiles(owner_user_id);
CREATE INDEX idx_relationships_owner ON public.relationships(owner_user_id);
CREATE INDEX idx_checkins_relationship ON public.checkins(relationship_id);
CREATE INDEX idx_checkins_status ON public.checkins(status);
CREATE INDEX idx_checkins_due_at ON public.checkins(due_at);
CREATE INDEX idx_pairing_codes_code ON public.pairing_codes(code) WHERE status = 'active';
CREATE INDEX idx_device_tokens_user ON public.device_tokens(user_id);

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables with updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.loved_one_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.relationships
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.checkin_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.checkins
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.escalation_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.contact_points
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.device_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loved_one_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pairing_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkin_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escalation_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escalation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS POLICIES
-- ============================================

-- USERS: Users can only see/edit their own profile
CREATE POLICY "Users can view own profile"
  ON public.users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.users FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.users FOR INSERT
  WITH CHECK (auth.uid() = id);

-- LOVED_ONE_PROFILES: Owners can manage, linked users can view
CREATE POLICY "Owners can view loved one profiles"
  ON public.loved_one_profiles FOR SELECT
  USING (
    owner_user_id = auth.uid()
    OR linked_user_id = auth.uid()
  );

CREATE POLICY "Owners can insert loved one profiles"
  ON public.loved_one_profiles FOR INSERT
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "Owners can update loved one profiles"
  ON public.loved_one_profiles FOR UPDATE
  USING (owner_user_id = auth.uid());

CREATE POLICY "Owners can delete loved one profiles"
  ON public.loved_one_profiles FOR DELETE
  USING (owner_user_id = auth.uid());

-- RELATIONSHIPS: Participants can view, owners can manage
CREATE POLICY "Participants can view relationships"
  ON public.relationships FOR SELECT
  USING (
    owner_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.loved_one_profiles lop
      WHERE lop.id = loved_one_profile_id
      AND lop.linked_user_id = auth.uid()
    )
  );

CREATE POLICY "Owners can insert relationships"
  ON public.relationships FOR INSERT
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "Owners can update relationships"
  ON public.relationships FOR UPDATE
  USING (owner_user_id = auth.uid());

CREATE POLICY "Owners can delete relationships"
  ON public.relationships FOR DELETE
  USING (owner_user_id = auth.uid());

-- PAIRING_CODES: Generators can manage their codes
CREATE POLICY "Generators can view pairing codes"
  ON public.pairing_codes FOR SELECT
  USING (generated_by_user_id = auth.uid());

CREATE POLICY "Users can insert pairing codes"
  ON public.pairing_codes FOR INSERT
  WITH CHECK (generated_by_user_id = auth.uid());

CREATE POLICY "Generators can update pairing codes"
  ON public.pairing_codes FOR UPDATE
  USING (generated_by_user_id = auth.uid());

-- CHECKIN_SCHEDULES: Relationship participants can view, owners manage
CREATE POLICY "Participants can view schedules"
  ON public.checkin_schedules FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.relationships r
      WHERE r.id = relationship_id
      AND (
        r.owner_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.loved_one_profiles lop
          WHERE lop.id = r.loved_one_profile_id
          AND lop.linked_user_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "Owners can insert schedules"
  ON public.checkin_schedules FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.relationships r
      WHERE r.id = relationship_id
      AND r.owner_user_id = auth.uid()
    )
  );

CREATE POLICY "Owners can update schedules"
  ON public.checkin_schedules FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.relationships r
      WHERE r.id = relationship_id
      AND r.owner_user_id = auth.uid()
    )
  );

CREATE POLICY "Owners can delete schedules"
  ON public.checkin_schedules FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.relationships r
      WHERE r.id = relationship_id
      AND r.owner_user_id = auth.uid()
    )
  );

-- CHECKINS: Participants can view, loved ones can confirm
CREATE POLICY "Participants can view checkins"
  ON public.checkins FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.relationships r
      WHERE r.id = relationship_id
      AND (
        r.owner_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.loved_one_profiles lop
          WHERE lop.id = r.loved_one_profile_id
          AND lop.linked_user_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "Participants can update checkins"
  ON public.checkins FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.relationships r
      WHERE r.id = relationship_id
      AND (
        r.owner_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.loved_one_profiles lop
          WHERE lop.id = r.loved_one_profile_id
          AND lop.linked_user_id = auth.uid()
        )
      )
    )
  );

-- ESCALATION_PLANS: Participants can view, owners manage
CREATE POLICY "Participants can view escalation plans"
  ON public.escalation_plans FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.relationships r
      WHERE r.id = relationship_id
      AND (
        r.owner_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.loved_one_profiles lop
          WHERE lop.id = r.loved_one_profile_id
          AND lop.linked_user_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "Owners can insert escalation plans"
  ON public.escalation_plans FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.relationships r
      WHERE r.id = relationship_id
      AND r.owner_user_id = auth.uid()
    )
  );

CREATE POLICY "Owners can update escalation plans"
  ON public.escalation_plans FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.relationships r
      WHERE r.id = relationship_id
      AND r.owner_user_id = auth.uid()
    )
  );

-- ESCALATION_EVENTS: Participants can view (read-only for users)
CREATE POLICY "Participants can view escalation events"
  ON public.escalation_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.checkins c
      JOIN public.relationships r ON r.id = c.relationship_id
      WHERE c.id = checkin_id
      AND (
        r.owner_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.loved_one_profiles lop
          WHERE lop.id = r.loved_one_profile_id
          AND lop.linked_user_id = auth.uid()
        )
      )
    )
  );

-- CONTACT_POINTS: Owners only
CREATE POLICY "Owners can view contacts"
  ON public.contact_points FOR SELECT
  USING (owner_user_id = auth.uid());

CREATE POLICY "Owners can insert contacts"
  ON public.contact_points FOR INSERT
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "Owners can update contacts"
  ON public.contact_points FOR UPDATE
  USING (owner_user_id = auth.uid());

CREATE POLICY "Owners can delete contacts"
  ON public.contact_points FOR DELETE
  USING (owner_user_id = auth.uid());

-- SUBSCRIPTIONS: Users can view own subscription
CREATE POLICY "Users can view own subscription"
  ON public.subscriptions FOR SELECT
  USING (user_id = auth.uid());

-- DEVICE_TOKENS: Users manage own tokens
CREATE POLICY "Users can view own device tokens"
  ON public.device_tokens FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert device tokens"
  ON public.device_tokens FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own device tokens"
  ON public.device_tokens FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own device tokens"
  ON public.device_tokens FOR DELETE
  USING (user_id = auth.uid());

-- ============================================
-- HELPER FUNCTION: Create user profile on signup
-- ============================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, timezone, country)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'timezone', 'Asia/Dubai'),
    COALESCE(NEW.raw_user_meta_data->>'country', 'AE')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-create user profile
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
