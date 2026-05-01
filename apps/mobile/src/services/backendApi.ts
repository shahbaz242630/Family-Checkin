import { Platform } from 'react-native';
import { getSession } from './supabase';

const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL;

export type BackendRelationshipType = 'PARENT' | 'GRANDPARENT' | 'SIBLING' | 'SPOUSE' | 'CHILD' | 'FRIEND' | 'OTHER';
export type BackendTechProfile = 'WHATSAPP' | 'SMS' | 'VOICE_ONLY';
export type BackendChannel = 'WHATSAPP' | 'SMS' | 'VOICE';
export type BackendConsentStatus = 'PENDING' | 'GRANTED' | 'DECLINED' | 'REVOKED';
export type BackendCheckInAttemptStatus = 'PENDING' | 'SENT' | 'RESPONDED' | 'FAILED' | 'TIMED_OUT' | 'SKIPPED';
export type BackendSensitiveAction = 'EXPORT_DATA' | 'DELETE_ACCOUNT';
export type BackendCheckInStatus =
  | 'PENDING'
  | 'SENT'
  | 'RESPONDED_OK'
  | 'RESPONDED_HELP'
  | 'ESCALATED'
  | 'NEEDS_ATTENTION'
  | 'RESOLVED'
  | 'FAILED'
  | 'SKIPPED';
export type BackendAbuseReportStatus = 'PENDING' | 'REVIEWED_SAFE' | 'REVIEWED_ACTION_TAKEN';

export interface SyncedBackendUser {
  id: string;
  country: string;
  preferredLanguage: string;
  timezone: string;
}

export interface BackendAdminMe {
  id: string;
  role: 'SUPER_ADMIN' | 'OPERATOR' | 'SUPPORT_READONLY';
}

export interface BackendStepUpRequestResult {
  ok: true;
  challengeId: string;
  action: BackendSensitiveAction;
  expiresAt: string;
}

export interface BackendStepUpVerifyResult {
  ok: true;
  stepUpToken: string;
  action: BackendSensitiveAction;
  expiresAt: string;
}

export interface BackendOperationsRecentCheckIn {
  checkInId: string;
  receiverId: string;
  status: BackendCheckInStatus;
  scheduledAt: string;
  sentAt?: string;
  respondedAt?: string;
  resolvedAt?: string;
  escalationAttemptCount: number;
  successfulEscalationCount: number;
}

export interface BackendOperationsSummary {
  ok: true;
  windowHours: number;
  generatedAt: string;
  statusCounts: Partial<Record<BackendCheckInStatus, number>>;
  recent: BackendOperationsRecentCheckIn[];
}

export type BackendEscalationResult = 'SUCCESS' | 'NO_RESPONSE' | 'ERROR';

export interface BackendOperationsEscalationDetail {
  id: string;
  attemptNumber: number;
  channel: BackendChannel;
  startedAt: string;
  completedAt?: string;
  result?: BackendEscalationResult;
  senderNotifiedAt?: string;
  backupAlertedAt?: string;
}

export interface BackendOperationsCheckInAttemptDetail {
  id: string;
  attemptNumber: number;
  channel: BackendChannel;
  status: BackendCheckInAttemptStatus;
  scheduledAt: string;
  sentAt?: string;
  completedAt?: string;
  providerStatus?: string;
  failureReason?: string;
}

export interface BackendOperationsCheckInDetail {
  checkInId: string;
  receiverId: string;
  status: BackendCheckInStatus;
  channelUsed?: BackendChannel;
  scheduledAt: string;
  sentAt?: string;
  respondedAt?: string;
  responseDetectedAs?: string;
  resolvedAt?: string;
  escalationAttemptCount: number;
  successfulEscalationCount: number;
  attempts: BackendOperationsCheckInAttemptDetail[];
  escalations: BackendOperationsEscalationDetail[];
}

export interface BackendAdminAbuseReport {
  id: string;
  receiverId: string;
  reportedAt: string;
  reviewStatus: BackendAbuseReportStatus;
  reviewerAdminId?: string;
  reviewedAt?: string;
  hasReportContent: boolean;
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
    resolvedAt?: string;
    resolutionByUserId?: string;
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

export interface BackendBackupContact {
  id: string;
  displayName: string;
  phoneMasked: string;
  relationshipToReceiver: string;
  priorityOrder: number;
  hasLocationInstructions: boolean;
  createdAt: string;
}

export interface BackupContactSetupInput {
  name: string;
  phone: string;
  phoneCountry?: string;
  relationshipToReceiver: string;
  locationInstructions?: string;
}

export interface BackupContactUpdateInput {
  name: string;
  phone?: string;
  phoneCountry?: string;
  relationshipToReceiver: string;
  locationInstructions?: string;
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

export async function deleteReceiver(receiverId: string): Promise<void> {
  await backendRequest<{ receiver: BackendReceiverDetail }>(`/receivers/${receiverId}`, {
    method: 'DELETE',
  });
}

export async function getAdminMe(): Promise<BackendAdminMe> {
  const response = await backendRequest<{ admin: BackendAdminMe }>('/auth/admin/me', {
    method: 'GET',
  });

  return response.admin;
}

export async function requestAccountStepUp(action: BackendSensitiveAction): Promise<BackendStepUpRequestResult> {
  return await backendRequest<BackendStepUpRequestResult>('/account/step-up/request', {
    method: 'POST',
    body: JSON.stringify({ action }),
  });
}

export async function verifyAccountStepUp(input: { challengeId: string; code: string }): Promise<BackendStepUpVerifyResult> {
  return await backendRequest<BackendStepUpVerifyResult>('/account/step-up/verify', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function exportAccountData(stepUpToken: string): Promise<unknown> {
  return await backendRequest<unknown>('/account/export', {
    method: 'GET',
    headers: {
      'x-nearby-step-up-token': stepUpToken,
    },
  });
}

export async function deleteAccount(stepUpToken: string): Promise<{ ok: true; deletedAt: string }> {
  return await backendRequest<{ ok: true; deletedAt: string }>('/account', {
    method: 'DELETE',
    headers: {
      'x-nearby-step-up-token': stepUpToken,
    },
  });
}

export async function getOperationsCheckInSummary(): Promise<BackendOperationsSummary> {
  return await backendRequest<BackendOperationsSummary>('/operations/check-ins/summary', {
    method: 'GET',
  });
}

export async function getOperationsCheckInDetail(checkInId: string): Promise<BackendOperationsCheckInDetail> {
  const response = await backendRequest<{ ok: true; checkIn: BackendOperationsCheckInDetail }>(
    `/operations/check-ins/${encodeURIComponent(checkInId)}`,
    {
      method: 'GET',
    },
  );

  return response.checkIn;
}

export async function listAdminAbuseReports(): Promise<BackendAdminAbuseReport[]> {
  const response = await backendRequest<{ ok: true; abuseReports: BackendAdminAbuseReport[] }>('/admin/abuse-reports', {
    method: 'GET',
  });

  return response.abuseReports;
}

export async function markAdminAbuseReportSafe(abuseReportId: string): Promise<BackendAdminAbuseReport> {
  const response = await backendRequest<{ ok: true; abuseReport: BackendAdminAbuseReport }>(
    `/admin/abuse-reports/${encodeURIComponent(abuseReportId)}/review-safe`,
    {
      method: 'PATCH',
    },
  );

  return response.abuseReport;
}

export async function markAdminAbuseReportActionTaken(abuseReportId: string): Promise<BackendAdminAbuseReport> {
  const response = await backendRequest<{ ok: true; abuseReport: BackendAdminAbuseReport }>(
    `/admin/abuse-reports/${encodeURIComponent(abuseReportId)}/review-action-taken`,
    {
      method: 'PATCH',
    },
  );

  return response.abuseReport;
}

export async function resolveReceiverCheckIn(receiverId: string, checkInId: string): Promise<BackendReceiverDetail> {
  const response = await backendRequest<{ receiver: BackendReceiverDetail }>(`/receivers/${receiverId}/check-ins/${checkInId}/resolve`, {
    method: 'PATCH',
  });

  return response.receiver;
}

export async function alertBackupForReceiverCheckIn(receiverId: string, checkInId: string): Promise<BackendReceiverDetail> {
  const response = await backendRequest<{ receiver: BackendReceiverDetail }>(
    `/receivers/${receiverId}/check-ins/${checkInId}/alert-backup`,
    {
      method: 'PATCH',
    },
  );

  return response.receiver;
}

export async function tryReceiverCheckInLater(receiverId: string, checkInId: string): Promise<BackendReceiverDetail> {
  const response = await backendRequest<{ receiver: BackendReceiverDetail }>(
    `/receivers/${receiverId}/check-ins/${checkInId}/try-later`,
    {
      method: 'PATCH',
    },
  );

  return response.receiver;
}

export async function listBackupContacts(receiverId: string): Promise<BackendBackupContact[]> {
  const response = await backendRequest<{ backupContacts: BackendBackupContact[] }>(`/receivers/${receiverId}/backup-contacts`, {
    method: 'GET',
  });

  return response.backupContacts;
}

export async function createBackupContact(receiverId: string, input: BackupContactSetupInput): Promise<BackendBackupContact> {
  const response = await backendRequest<{ backupContact: BackendBackupContact }>(`/receivers/${receiverId}/backup-contacts`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

  return response.backupContact;
}

export async function updateBackupContact(
  receiverId: string,
  backupContactId: string,
  input: BackupContactUpdateInput,
): Promise<BackendBackupContact> {
  const response = await backendRequest<{ backupContact: BackendBackupContact }>(
    `/receivers/${receiverId}/backup-contacts/${backupContactId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );

  return response.backupContact;
}

export async function deleteBackupContact(receiverId: string, backupContactId: string): Promise<void> {
  await backendRequest<{ backupContact: BackendBackupContact }>(`/receivers/${receiverId}/backup-contacts/${backupContactId}`, {
    method: 'DELETE',
  });
}

export async function createReceiver(input: ReceiverSetupInput): Promise<CreatedReceiver> {
  const response = await backendRequest<{ receiver: CreatedReceiver }>('/receivers', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  return response.receiver;
}

async function backendRequest<T>(path: string, init: RequestInit): Promise<T> {
  const resolvedBackendUrl = resolveBackendUrl();
  if (!resolvedBackendUrl) {
    throw new Error('Missing EXPO_PUBLIC_BACKEND_URL');
  }

  const session = await getSession();
  const accessToken = session?.access_token;

  if (!accessToken) {
    throw new Error('You need to sign in again');
  }

  const response = await fetch(`${resolvedBackendUrl.replace(/\/$/, '')}${path}`, {
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

function resolveBackendUrl(): string | undefined {
  if (!backendUrl) {
    return undefined;
  }

  if (Platform.OS === 'android') {
    return backendUrl.replace('://localhost:', '://10.0.2.2:').replace('://127.0.0.1:', '://10.0.2.2:');
  }

  return backendUrl;
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
