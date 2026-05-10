// Shared API/domain types aligned with the current receiver-first backend model.

export type RelationshipType =
  | 'PARENT'
  | 'GRANDPARENT'
  | 'SPOUSE'
  | 'SIBLING'
  | 'CHILD'
  | 'AUNT_UNCLE'
  | 'COUSIN'
  | 'FRIEND'
  | 'OTHER';

export type Channel = 'WHATSAPP' | 'SMS' | 'VOICE';

export type TechProfile = 'WHATSAPP' | 'SMS' | 'VOICE_ONLY';

export type ConsentStatus = 'PENDING' | 'GRANTED' | 'REVOKED' | 'ABUSE_REPORTED' | 'EXPIRED';

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

export type SubscriptionTier = 'free' | 'single_receiver' | 'family';

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'expired';

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
