import { getSession } from './supabase';

const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL;

export type BackendRelationshipType = 'PARENT' | 'GRANDPARENT' | 'SIBLING' | 'SPOUSE' | 'CHILD' | 'FRIEND' | 'OTHER';
export type BackendTechProfile = 'WHATSAPP' | 'SMS' | 'VOICE_ONLY';
export type BackendChannel = 'WHATSAPP' | 'SMS' | 'VOICE';
export type BackendConsentStatus = 'PENDING' | 'GRANTED' | 'DECLINED' | 'REVOKED';
export type BackendCheckInStatus =
  | 'PENDING'
  | 'SENT'
  | 'RESPONDED_OK'
  | 'RESPONDED_HELP'
  | 'ESCALATED'
  | 'RESOLVED'
  | 'FAILED'
  | 'SKIPPED';

export interface SyncedBackendUser {
  id: string;
  country: string;
  preferredLanguage: string;
  timezone: string;
}

export interface ReceiverSetupInput {
  name: string;
  phone: string;
  phoneCountry?: string;
  countryCode: string;
  relationshipType: BackendRelationshipType;
  language: string;
  timezone: string;
  techProfile: BackendTechProfile;
  primaryChannel: BackendChannel;
  fallbackChannels: BackendChannel[];
  scheduleFrequency: string;
  scheduleTimeWindow: {
    start: string;
    end: string;
  };
  personalNote?: string;
}

export interface ReceiverUpdateInput {
  name: string;
  countryCode: string;
  relationshipType: BackendRelationshipType;
  language: string;
  timezone: string;
  techProfile: BackendTechProfile;
  primaryChannel: BackendChannel;
  fallbackChannels: BackendChannel[];
  scheduleFrequency: string;
  scheduleTimeWindow: {
    start: string;
    end: string;
  };
}

export interface CreatedReceiver {
  id: string;
  consentStatus: BackendConsentStatus;
  consentRequestStatus: 'requested';
  countryCode: string;
  relationshipType: BackendRelationshipType;
  language: string;
  timezone: string;
  techProfile: BackendTechProfile;
  primaryChannel: BackendChannel;
  fallbackChannels: BackendChannel[];
  scheduleFrequency: string;
  scheduleTimeWindow: {
    start: string;
    end: string;
  };
}

export interface BackendReceiverSummary {
  id: string;
  displayName: string;
  phoneMasked: string;
  countryCode: string;
  relationshipType: BackendRelationshipType;
  language: string;
  timezone: string;
  techProfile: BackendTechProfile;
  primaryChannel: BackendChannel;
  fallbackChannels: BackendChannel[];
  scheduleFrequency: string;
  scheduleTimeWindow: {
    start?: string;
    end?: string;
  };
  consentStatus: BackendConsentStatus;
  consentGrantedAt?: string;
  pausedUntil?: string;
  pausedReason?: string;
  latestCheckIn?: {
    id: string;
    status: BackendCheckInStatus;
    scheduledAt: string;
    channelUsed?: BackendChannel;
    sentAt?: string;
    respondedAt?: string;
    responseDetectedAs?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface BackendReceiverDetail extends BackendReceiverSummary {
  backupContacts: [];
  escalation: {
    configured: boolean;
    nextStep: string;
  };
}

export async function syncAuthenticatedUser(): Promise<SyncedBackendUser> {
  const response = await backendRequest<{ user: SyncedBackendUser }>('/auth/sync-user', {
    method: 'POST',
  });

  return response.user;
}

export async function listReceivers(): Promise<BackendReceiverSummary[]> {
  const response = await backendRequest<{ receivers: BackendReceiverSummary[] }>('/receivers', {
    method: 'GET',
  });

  return response.receivers;
}

export async function getReceiver(receiverId: string): Promise<BackendReceiverDetail> {
  const response = await backendRequest<{ receiver: BackendReceiverDetail }>(`/receivers/${receiverId}`, {
    method: 'GET',
  });

  return response.receiver;
}

export async function pauseReceiver(receiverId: string): Promise<BackendReceiverDetail> {
  const response = await backendRequest<{ receiver: BackendReceiverDetail }>(`/receivers/${receiverId}/pause`, {
    method: 'PATCH',
  });

  return response.receiver;
}

export async function resumeReceiver(receiverId: string): Promise<BackendReceiverDetail> {
  const response = await backendRequest<{ receiver: BackendReceiverDetail }>(`/receivers/${receiverId}/resume`, {
    method: 'PATCH',
  });

  return response.receiver;
}

export async function updateReceiver(receiverId: string, input: ReceiverUpdateInput): Promise<BackendReceiverDetail> {
  const response = await backendRequest<{ receiver: BackendReceiverDetail }>(`/receivers/${receiverId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });

  return response.receiver;
}

export async function createReceiver(input: ReceiverSetupInput): Promise<CreatedReceiver> {
  const response = await backendRequest<{ receiver: CreatedReceiver }>('/receivers', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  return response.receiver;
}

async function backendRequest<T>(path: string, init: RequestInit): Promise<T> {
  if (!backendUrl) {
    throw new Error('Missing EXPO_PUBLIC_BACKEND_URL');
  }

  const session = await getSession();
  const accessToken = session?.access_token;

  if (!accessToken) {
    throw new Error('You need to sign in again');
  }

  const response = await fetch(`${backendUrl.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new Error(await responseErrorMessage(response));
  }

  return (await response.json()) as T;
}

async function responseErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown; error?: unknown };
    if (typeof body.message === 'string') {
      return body.message;
    }
    if (typeof body.error === 'string') {
      return body.error;
    }
  } catch {
    // Fall through to generic HTTP message.
  }

  return `Backend request failed with status ${response.status}`;
}
