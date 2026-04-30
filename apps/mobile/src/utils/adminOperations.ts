import type { BackendCheckInStatus } from '../services/backendApi';

const statusPriority: BackendCheckInStatus[] = [
  'RESPONDED_HELP',
  'ESCALATED',
  'FAILED',
  'SKIPPED',
  'SENT',
  'PENDING',
  'RESOLVED',
  'RESPONDED_OK',
];

export function operationsStatusLabel(status: BackendCheckInStatus | string): string {
  switch (status) {
    case 'RESPONDED_HELP':
      return 'Needs help';
    case 'ESCALATED':
      return 'Backup alerted';
    case 'FAILED':
      return 'Escalation failed';
    case 'SKIPPED':
      return 'No backup available';
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

export function formatOperationsDateTime(value?: string): string {
  if (!value) return 'Not yet';
  return new Date(value).toLocaleString();
}

export function sortStatusCounts(counts: Partial<Record<BackendCheckInStatus, number>>): Array<{ status: BackendCheckInStatus; count: number }> {
  return Object.entries(counts)
    .map(([status, count]) => ({ status: status as BackendCheckInStatus, count: count ?? 0 }))
    .sort((a, b) => statusOrder(a.status) - statusOrder(b.status));
}

function statusOrder(status: BackendCheckInStatus): number {
  const index = statusPriority.indexOf(status);
  return index === -1 ? statusPriority.length : index;
}
