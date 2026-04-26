// Database model types - mirrors Supabase tables
// Based on BRD Step 15

import type {
  RelationshipType,
  RelationshipMode,
  SubscriptionTier,
  SubscriptionStatus,
  CheckinStatus,
  EscalationChannel,
  ResponseMethod,
  SupportedLanguage,
  Platform,
  PreferredChannels,
  EscalationStep,
} from './index';

export interface User {
  id: string;
  email: string | null;
  phone_e164: string | null;
  full_name: string;
  locale: SupportedLanguage;
  timezone: string;
  country: string;
  role_default: 'owner' | 'loved_one' | 'peer';
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
}

export interface LovedOneProfile {
  id: string;
  owner_user_id: string;
  linked_user_id: string | null;
  display_name: string;
  relationship_type: RelationshipType;
  preferred_channels: PreferredChannels;
  preferred_language: SupportedLanguage;
  timezone: string;
  phone_e164: string | null;
  email: string | null;
  large_text_enabled: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Relationship {
  id: string;
  owner_user_id: string;
  loved_one_profile_id: string;
  relationship_mode: RelationshipMode;
  can_initiate_checkin: boolean;
  can_receive_alerts: boolean;
  subscription_tier_required: SubscriptionTier;
  created_at: string;
  updated_at: string;
}

export interface PairingCode {
  id: string;
  code: string;
  generated_by_user_id: string;
  target_owner_user_id: string;
  target_profile_id: string | null;
  expires_at: string;
  used_at: string | null;
  status: 'active' | 'used' | 'expired' | 'revoked';
  created_at: string;
}

export interface CheckinSchedule {
  id: string;
  relationship_id: string;
  schedule_type: 'daily' | 'multi_daily' | 'temporary';
  time_local: string;
  days_of_week: number[] | null;
  start_date: string | null;
  end_date: string | null;
  grace_period_minutes: number;
  max_retries: number;
  retry_interval_minutes: number;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface Checkin {
  id: string;
  relationship_id: string;
  schedule_id: string;
  due_at: string;
  status: CheckinStatus;
  responded_at: string | null;
  response_method: ResponseMethod | null;
  snooze_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface EscalationPlan {
  id: string;
  relationship_id: string;
  plan_name: string;
  steps: EscalationStep[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EscalationEvent {
  id: string;
  checkin_id: string;
  step_index: number;
  channel: EscalationChannel;
  target: string;
  status: 'queued' | 'sent' | 'delivered' | 'failed';
  provider_message_id: string | null;
  error_code: string | null;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface ContactPoint {
  id: string;
  owner_user_id: string;
  display_name: string;
  phone_e164: string | null;
  email: string | null;
  preferred_channels: PreferredChannels;
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: string;
  user_id: string;
  platform: Platform;
  product_id: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  external_transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeviceToken {
  id: string;
  user_id: string;
  platform: Platform;
  token: string;
  is_active: boolean;
  last_registered_at: string;
  created_at: string;
  updated_at: string;
}
