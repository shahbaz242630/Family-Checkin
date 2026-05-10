import type {
  Channel,
  CheckInStatus,
  ConsentStatus,
  Platform,
  RelationshipType,
  SubscriptionStatus,
  SubscriptionTier,
  SupportedLanguage,
  TechProfile,
} from './index';

export interface User {
  id: string;
  email: string | null;
  locale: SupportedLanguage;
  timezone: string;
  country: string;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
}

export interface Receiver {
  id: string;
  user_id: string;
  display_name?: string;
  phone_masked?: string;
  country_code: string;
  relationship_type: RelationshipType;
  language: SupportedLanguage;
  timezone: string;
  tech_profile: TechProfile;
  primary_channel: Channel;
  fallback_channels: Channel[];
  schedule_frequency: string;
  schedule_time_window: Record<string, unknown>;
  schedule_custom_cron: string | null;
  consent_status: ConsentStatus;
  consent_requested_at: string | null;
  consent_granted_at: string | null;
  paused_until: string | null;
  paused_reason: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BackupContact {
  id: string;
  receiver_id: string;
  display_name?: string;
  phone_masked?: string;
  relationship_type: RelationshipType | string;
  priority: number;
  channels: Channel[];
  created_at: string;
  updated_at: string;
}

export interface CheckIn {
  id: string;
  receiver_id: string;
  status: CheckInStatus;
  scheduled_at: string;
  channel_used: Channel | null;
  sent_at: string | null;
  responded_at: string | null;
  response_detected_as: string | null;
  resolved_at: string | null;
  resolution_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EscalationEvent {
  id: string;
  check_in_id: string;
  target_receiver_id: string;
  target_backup_contact_id: string | null;
  channel: Channel;
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED';
  provider_message_id: string | null;
  error_code: string | null;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
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
