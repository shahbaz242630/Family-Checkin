// Shared types between frontend and backend
// Based on BRD Step 15 - Data Models

export type RelationshipType =
  | 'mother'
  | 'father'
  | 'child'
  | 'partner'
  | 'brother'
  | 'sister'
  | 'relative'
  | 'other';

export type RelationshipMode = 'one_way' | 'two_way';

export type SubscriptionTier = 'free' | 'one_way' | 'two_way' | 'pro_family';

export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'expired';

export type CheckinStatus =
  | 'pending'
  | 'snoozed'
  | 'confirmed'
  | 'escalating'
  | 'escalated'
  | 'resolved'
  | 'canceled';

export type EscalationChannel = 'push' | 'whatsapp' | 'sms' | 'voice' | 'email';

export type ResponseMethod = 'app' | 'whatsapp' | 'sms' | 'voice';

export type SupportedLanguage = 'en' | 'ar' | 'ur';

export type Platform = 'ios' | 'android';

export interface PreferredChannels {
  push: boolean;
  whatsapp: boolean;
  sms: boolean;
  voice: boolean;
  email: boolean;
}

export interface EscalationStep {
  channel: EscalationChannel;
  delay_min: number;
}

// API Response types
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
