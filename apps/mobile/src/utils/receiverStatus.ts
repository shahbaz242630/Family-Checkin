import type { BackendCheckInStatus, BackendConsentStatus } from '../services/backendApi';
import { skippedCheckInLabel } from './checkInSkipReason';

export type ReceiverStatusTone = 'success' | 'warning' | 'error' | 'muted';

export interface ReceiverStatusDisplay {
  label: string;
  tone: ReceiverStatusTone;
}

/**
 * Status chip for a receiver. Consent and pause win over the latest check-in. A SKIPPED check-in is labelled by
 * `skipReason` when the caller has one; the receiver payloads do not carry it yet (CB-077), so the dashboard and
 * the detail screen read "Skipped" rather than the old catch-all "No backup available".
 */
export function getReceiverStatusDisplay(
  consentStatus: BackendConsentStatus | string,
  latestCheckInStatus?: BackendCheckInStatus | string,
  isPaused = false,
  skipReason?: string,
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
    case 'NEEDS_ATTENTION':
      return { label: 'Needs attention', tone: 'error' };
    case 'FAILED':
      return { label: 'Escalation failed', tone: 'error' };
    case 'SKIPPED':
      return {
        label: skippedCheckInLabel(skipReason),
        tone: skipReason === 'no_backup_contacts' ? 'warning' : 'muted',
      };
    case 'RESOLVED':
      return { label: 'Resolved', tone: 'success' };
    case 'SENT':
      return { label: 'Awaiting reply', tone: 'warning' };
    default:
      return { label: 'Active', tone: 'success' };
  }
}

export const SCHEDULE_NEEDS_ATTENTION_LABEL = 'Schedule needs attention';
export const SCHEDULE_NEEDS_ATTENTION_MESSAGE =
  "Nearby could not work out this receiver's check-in time from the saved timezone and window, so no check-ins are being sent. Tap Edit to correct the schedule.";

/**
 * Warning chip for a receiver the scheduler has stamped `scheduleInvalidAt` (CB-069): the stored timezone or
 * window could not be evaluated, so check-ins are on hold until the sender edits the schedule. Shown next to the
 * status chip, never instead of it — consent and pause still describe the receiver.
 */
export function getScheduleAttentionDisplay(scheduleInvalidAt?: string | null): ReceiverStatusDisplay | null {
  return scheduleInvalidAt ? { label: SCHEDULE_NEEDS_ATTENTION_LABEL, tone: 'warning' } : null;
}
