// Database types - will be auto-generated from Supabase later
// For now, manual types based on our BRD schema

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string | null;
          phone_e164: string | null;
          full_name: string;
          locale: string;
          timezone: string;
          country: string;
          role_default: string;
          created_at: string;
          updated_at: string;
          last_seen_at: string | null;
        };
        Insert: {
          id?: string;
          email?: string | null;
          phone_e164?: string | null;
          full_name: string;
          locale?: string;
          timezone: string;
          country: string;
          role_default?: string;
          created_at?: string;
          updated_at?: string;
          last_seen_at?: string | null;
        };
        Update: {
          id?: string;
          email?: string | null;
          phone_e164?: string | null;
          full_name?: string;
          locale?: string;
          timezone?: string;
          country?: string;
          role_default?: string;
          created_at?: string;
          updated_at?: string;
          last_seen_at?: string | null;
        };
      };
      loved_one_profiles: {
        Row: {
          id: string;
          owner_user_id: string;
          linked_user_id: string | null;
          display_name: string;
          relationship_type: string;
          preferred_channels: Json;
          preferred_language: string;
          timezone: string;
          phone_e164: string | null;
          email: string | null;
          large_text_enabled: boolean;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_user_id: string;
          linked_user_id?: string | null;
          display_name: string;
          relationship_type: string;
          preferred_channels?: Json;
          preferred_language?: string;
          timezone: string;
          phone_e164?: string | null;
          email?: string | null;
          large_text_enabled?: boolean;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_user_id?: string;
          linked_user_id?: string | null;
          display_name?: string;
          relationship_type?: string;
          preferred_channels?: Json;
          preferred_language?: string;
          timezone?: string;
          phone_e164?: string | null;
          email?: string | null;
          large_text_enabled?: boolean;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      checkins: {
        Row: {
          id: string;
          relationship_id: string;
          schedule_id: string;
          due_at: string;
          status: string;
          responded_at: string | null;
          response_method: string | null;
          snooze_until: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          relationship_id: string;
          schedule_id: string;
          due_at: string;
          status?: string;
          responded_at?: string | null;
          response_method?: string | null;
          snooze_until?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          relationship_id?: string;
          schedule_id?: string;
          due_at?: string;
          status?: string;
          responded_at?: string | null;
          response_method?: string | null;
          snooze_until?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
    Views: {};
    Functions: {};
    Enums: {};
  };
}
