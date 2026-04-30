import type { BackendCheckInStatus, BackendConsentStatus } from '../services/backendApi';

export type ReceiverStatusTone = 'success' | 'warning' | 'error' | 'muted';

export interface ReceiverStatusDisplay {
  label: string;
  tone: ReceiverStatusTone;
}

export function getReceiverStatusDisplay(
  consentStatus: BackendConsentStatus | string,
  latestCheckInStatus?: BackendCheckInStatus | string,
  isPaused = false,
): ReceiverStatusDisplay {
  if (isPaused) return { label: 'Paused', tone: 'warning' };
  if (consentStatus === 'PENDING') return { label: 'Pending consent', tone: 'warning' };
  if (consentStatus === 'DECLINED') return { label: 'Consent declined', tone: 'muted' };
  if (consentStatus === 'REVOKED') return { label: 'Opted out', tone: 'muted' };

  switch (latestCheckInStatus) {
    case 'RESPONDED_OK':
      return { label: 'OK', tone: 'success' };
    case 'RESPONDED_HELP':
      return { label: 'Needs help', tone: 'error' };
    case 'ESCALATED':
      return { label: 'Backup alerted', tone: 'error' };
    case 'FAILED':
      return { label: 'Escalation failed', tone: 'error' };
    case 'SKIPPED':
      return { label: 'No backup available', tone: 'warning' };
    case 'SENT':
      return { label: 'Awaiting reply', tone: 'warning' };
    default:
      return { label: 'Active', tone: 'success' };
  }
}
