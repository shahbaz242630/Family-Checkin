import type { BackendChannel, BackendTechProfile } from '../services';

export interface ChannelProfileOption {
  value: BackendTechProfile;
  label: string;
  primaryChannel: BackendChannel;
  fallbackChannels: BackendChannel[];
}

export const CHANNEL_PROFILE_OPTIONS: ChannelProfileOption[] = [
  { value: 'WHATSAPP', label: 'WhatsApp if available', primaryChannel: 'WHATSAPP', fallbackChannels: ['SMS', 'VOICE'] },
  { value: 'SMS', label: 'SMS', primaryChannel: 'SMS', fallbackChannels: ['VOICE'] },
  { value: 'VOICE_ONLY', label: 'Voice call', primaryChannel: 'VOICE', fallbackChannels: [] },
  { value: 'LANDLINE', label: 'Landline', primaryChannel: 'VOICE', fallbackChannels: [] },
];
