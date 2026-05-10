// Manual database types aligned with the current receiver/check-in backend schema.
// Replace with generated Supabase types once the database contract is finalized.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Channel = 'WHATSAPP' | 'SMS' | 'VOICE';
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

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string | null;
          locale: string;
          timezone: string;
          country: string;
          created_at: string;
          updated_at: string;
          last_seen_at: string | null;
        };
        Insert: {
          id?: string;
          email?: string | null;
          locale?: string;
          timezone: string;
          country: string;
          created_at?: string;
          updated_at?: string;
          last_seen_at?: string | null;
        };
        Update: {
          email?: string | null;
          locale?: string;
          timezone?: string;
          country?: string;
          updated_at?: string;
          last_seen_at?: string | null;
        };
      };
      receivers: {
        Row: {
          id: string;
          user_id: string;
          name_encrypted: string;
          phone_encrypted: string;
          phone_hash: string;
          country_code: string;
          relationship_type: string;
          language: string;
          timezone: string;
          tech_profile: string;
          primary_channel: Channel;
          fallback_channels: Channel[];
          schedule_frequency: string;
          schedule_time_window: Json;
          schedule_custom_cron: string | null;
          consent_status: ConsentStatus;
          consent_requested_at: string | null;
          consent_granted_at: string | null;
          paused_until: string | null;
          paused_reason: string | null;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name_encrypted: string;
          phone_encrypted: string;
          phone_hash: string;
          country_code: string;
          relationship_type: string;
          language: string;
          timezone: string;
          tech_profile: string;
          primary_channel: Channel;
          fallback_channels?: Channel[];
          schedule_frequency: string;
          schedule_time_window: Json;
          schedule_custom_cron?: string | null;
          consent_status?: ConsentStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name_encrypted?: string;
          country_code?: string;
          relationship_type?: string;
          language?: string;
          timezone?: string;
          tech_profile?: string;
          primary_channel?: Channel;
          fallback_channels?: Channel[];
          schedule_frequency?: string;
          schedule_time_window?: Json;
          schedule_custom_cron?: string | null;
          consent_status?: ConsentStatus;
          paused_until?: string | null;
          paused_reason?: string | null;
          deleted_at?: string | null;
          updated_at?: string;
        };
      };
      backup_contacts: {
        Row: {
          id: string;
          receiver_id: string;
          name_encrypted: string;
          phone_encrypted: string;
          phone_hash: string;
          relationship_type: string;
          priority: number;
          channels: Channel[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          receiver_id: string;
          name_encrypted: string;
          phone_encrypted: string;
          phone_hash: string;
          relationship_type: string;
          priority: number;
          channels?: Channel[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name_encrypted?: string;
          phone_encrypted?: string;
          phone_hash?: string;
          relationship_type?: string;
          priority?: number;
          channels?: Channel[];
          updated_at?: string;
        };
      };
      check_ins: {
        Row: {
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
        };
        Insert: {
          id?: string;
          receiver_id: string;
          status?: CheckInStatus;
          scheduled_at: string;
          channel_used?: Channel | null;
          sent_at?: string | null;
          responded_at?: string | null;
          response_detected_as?: string | null;
          resolved_at?: string | null;
          resolution_by_user_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: CheckInStatus;
          channel_used?: Channel | null;
          sent_at?: string | null;
          responded_at?: string | null;
          response_detected_as?: string | null;
          resolved_at?: string | null;
          resolution_by_user_id?: string | null;
          updated_at?: string;
        };
      };
      device_tokens: {
        Row: {
          id: string;
          user_id: string;
          token: string;
          platform: string;
          device_id: string | null;
          active: boolean;
          last_registered_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          token: string;
          platform: string;
          device_id?: string | null;
          active?: boolean;
          last_registered_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          token?: string;
          platform?: string;
          device_id?: string | null;
          active?: boolean;
          last_registered_at?: string;
          updated_at?: string;
        };
      };
    };
    Views: {};
    Functions: {};
    Enums: {};
  };
}
