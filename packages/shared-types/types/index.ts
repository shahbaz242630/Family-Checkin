// Shared API/domain types aligned with the current receiver-first backend model.

export type RelationshipType =
  | 'PARENT'
  | 'GRANDPARENT'
  | 'SIBLING'
  | 'SPOUSE'
  | 'CHILD'
  | 'FRIEND'
  | 'OTHER';

export type Channel = 'WHATSAPP' | 'SMS' | 'VOICE';

export type TechProfile = 'WHATSAPP' | 'SMS' | 'VOICE_ONLY' | 'LANDLINE';

export type ConsentStatus = 'PENDING' | 'GRANTED' | 'DECLINED' | 'REVOKED';

export type CheckInStatus =
  | 'PENDING'
  | 'SENT'
  | 'RESPONDED_OK'
  | 'RESPONDED_HELP'
  | 'NO_RESPONSE'
  | 'FAILED'
  | 'SKIPPED'
  | 'NEEDS_ATTENTION'
  | 'ESCALATED'
  | 'RESOLVED';

export type EscalationChannel = Channel;

export type SupportedLanguage = 'en' | 'ar' | 'ur' | string;

export type Platform = 'ios' | 'android';

export type SubscriptionTier = 'TIER_1' | 'TIER_2' | 'TIER_3';

export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'SUSPENDED';

export interface EscalationStep {
  channel: EscalationChannel;
  delay_min: number;
}

export interface ApiResponse<T> {
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}
