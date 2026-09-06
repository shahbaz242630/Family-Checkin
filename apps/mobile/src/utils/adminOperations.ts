import type { BackendCheckInStatus } from '../services/backendApi';
import { skippedCheckInLabel } from './checkInSkipReason';

const statusPriority: BackendCheckInStatus[] = [
  'RESPONDED_HELP',
  'ESCALATED',
  'NEEDS_ATTENTION',
  'FAILED',
  'SKIPPED',
  'SENT',
  'PENDING',
  'RESOLVED',
  'RESPONDED_OK',
];

/**
 * Operational label for a check-in status. A SKIPPED check-in is labelled by `skipReason` when the caller has
 * one (the check-in detail derives it from the cancelled attempts); the summary payload carries none, so its
 * counts and rows read "Skipped" (CB-077).
 */
export function operationsStatusLabel(status: BackendCheckInStatus | string, skipReason?: string): string {
  switch (status) {
    case 'RESPONDED_HELP':
      return 'Needs help';
    case 'ESCALATED':
      return 'Backup alerted';
    case 'NEEDS_ATTENTION':
      return 'Needs attention';
    case 'FAILED':
      return 'Escalation failed';
    case 'SKIPPED':
      return skippedCheckInLabel(skipReason);
    case 'RESOLVED':
      return 'Resolved';
    case 'SENT':
      return 'Awaiting reply';
    case 'RESPONDED_OK':
      return 'OK';
    case 'PENDING':
      return 'Pending';
    default:
      return status
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ');
  }
}

export function escalationResultLabel(result?: string): string {
  switch (result) {
    case 'SUCCESS':
      return 'Delivered';
    case 'NO_RESPONSE':
      return 'No response';
    case 'ERROR':
      return 'Error';
    default:
      return 'Pending';
  }
}

export function attemptStatusLabel(status?: string): string {
  switch (status) {
    case 'PENDING':
      return 'Scheduled';
    case 'SENT':
      return 'Sent';
    case 'RESPONDED':
      return 'Responded';
    case 'FAILED':
      return 'Failed';
    case 'TIMED_OUT':
      return 'Timed out';
    case 'SKIPPED':
      return 'Skipped';
    default:
      return status ? operationsStatusLabel(status) : 'Unknown';
  }
}

export function failureReasonLabel(reason?: string): string {
  switch (reason) {
    case 'response_window_elapsed':
      return 'Response window elapsed';
    case 'provider_send_failed':
      return 'Provider send failed';
    case 'cascade_closed':
      return 'Check-in already closed';
    case 'superseded_by_response':
      return 'Receiver responded';
    case 'receiver_opted_out':
      return 'Receiver opted out';
    case 'abuse_reported':
      return 'Receiver reported abuse';
    case 'receiver_paused':
      return 'Receiver paused';
    case 'receiver_deleted':
      return 'Receiver removed';
    default:
      return reason ? operationsStatusLabel(reason) : 'None';
  }
}

export function formatOperationsDateTime(value?: string): string {
  if (!value) return 'Not yet';
  return new Date(value).toLocaleString();
}

export function sortStatusCounts(
  counts: Partial<Record<BackendCheckInStatus, number>>,
): Array<{ status: BackendCheckInStatus; count: number }> {
  return Object.entries(counts)
    .map(([status, count]) => ({ status: status as BackendCheckInStatus, count: count ?? 0 }))
    .sort((a, b) => statusOrder(a.status) - statusOrder(b.status));
}

function statusOrder(status: BackendCheckInStatus): number {
  const index = statusPriority.indexOf(status);
  return index === -1 ? statusPriority.length : index;
}
