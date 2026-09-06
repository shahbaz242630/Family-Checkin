import { describe, expect, it } from 'vitest';
import {
  attemptStatusLabel,
  escalationResultLabel,
  failureReasonLabel,
  formatOperationsDateTime,
  operationsStatusLabel,
  sortStatusCounts,
} from './adminOperations';
import { inferCheckInSkipReason } from './checkInSkipReason';

describe('admin operations formatting', () => {
  it('maps operational check-in statuses to readable labels', () => {
    expect(operationsStatusLabel('RESPONDED_HELP')).toBe('Needs help');
    expect(operationsStatusLabel('ESCALATED')).toBe('Backup alerted');
    expect(operationsStatusLabel('FAILED')).toBe('Escalation failed');
    expect(operationsStatusLabel('RESOLVED')).toBe('Resolved');
    expect(operationsStatusLabel('SENT')).toBe('Awaiting reply');
  });

  it('labels a skipped check-in "Skipped" in the summary, where no reason is available (CB-077)', () => {
    expect(operationsStatusLabel('SKIPPED')).toBe('Skipped');
    expect(operationsStatusLabel('SKIPPED')).not.toBe('No backup available');
  });

  it('labels a skipped check-in by its reason on the detail screen', () => {
    expect(operationsStatusLabel('SKIPPED', 'receiver_opted_out')).toBe('Opted out');
    expect(operationsStatusLabel('SKIPPED', 'abuse_reported')).toBe('Reported');
    expect(operationsStatusLabel('SKIPPED', 'receiver_paused')).toBe('Paused');
    expect(operationsStatusLabel('SKIPPED', 'receiver_deleted')).toBe('Removed');
    expect(operationsStatusLabel('SKIPPED', 'no_backup_contacts')).toBe('No backup available');
    expect(operationsStatusLabel('RESOLVED', 'receiver_opted_out')).toBe('Resolved');
  });

  it('derives the detail label for an opted-out receiver from the cancelled attempts', () => {
    const attempts = [
      { status: 'TIMED_OUT', failureReason: 'response_window_elapsed' },
      { status: 'SKIPPED', failureReason: 'receiver_opted_out' },
    ];

    expect(operationsStatusLabel('SKIPPED', inferCheckInSkipReason(attempts))).toBe('Opted out');
    expect(operationsStatusLabel('SKIPPED', inferCheckInSkipReason([{ status: 'SENT' }]))).toBe('Skipped');
  });

  it('formats optional timestamps with a stable fallback', () => {
    expect(formatOperationsDateTime()).toBe('Not yet');
    expect(formatOperationsDateTime('2026-04-30T07:00:00.000Z')).toContain('2026');
  });

  it('sorts status counts by operational priority', () => {
    expect(sortStatusCounts({ RESOLVED: 2, ESCALATED: 1, SENT: 3 }).map((item) => item.status)).toEqual([
      'ESCALATED',
      'SENT',
      'RESOLVED',
    ]);
  });

  it('maps escalation results to readable labels', () => {
    expect(escalationResultLabel('SUCCESS')).toBe('Delivered');
    expect(escalationResultLabel('NO_RESPONSE')).toBe('No response');
    expect(escalationResultLabel('ERROR')).toBe('Error');
    expect(escalationResultLabel(undefined)).toBe('Pending');
  });

  it('maps cascade attempt statuses and failure reasons to readable labels', () => {
    expect(attemptStatusLabel('PENDING')).toBe('Scheduled');
    expect(attemptStatusLabel('SENT')).toBe('Sent');
    expect(attemptStatusLabel('RESPONDED')).toBe('Responded');
    expect(attemptStatusLabel('FAILED')).toBe('Failed');
    expect(attemptStatusLabel('TIMED_OUT')).toBe('Timed out');
    expect(attemptStatusLabel('SKIPPED')).toBe('Skipped');
    expect(failureReasonLabel('response_window_elapsed')).toBe('Response window elapsed');
    expect(failureReasonLabel('provider_send_failed')).toBe('Provider send failed');
    expect(failureReasonLabel(undefined)).toBe('None');
  });

  it('names the cancellation reasons STOP, REPORT, pause and delete write on skipped attempts', () => {
    expect(failureReasonLabel('receiver_opted_out')).toBe('Receiver opted out');
    expect(failureReasonLabel('abuse_reported')).toBe('Receiver reported abuse');
    expect(failureReasonLabel('receiver_paused')).toBe('Receiver paused');
    expect(failureReasonLabel('receiver_deleted')).toBe('Receiver removed');
    expect(failureReasonLabel('cascade_closed')).toBe('Check-in already closed');
    expect(failureReasonLabel('superseded_by_response')).toBe('Receiver responded');
  });

  it('sorts needs-attention before failed and skipped operational states', () => {
    expect(sortStatusCounts({ SKIPPED: 1, NEEDS_ATTENTION: 2, FAILED: 3 }).map((item) => item.status)).toEqual([
      'NEEDS_ATTENTION',
      'FAILED',
      'SKIPPED',
    ]);
  });
});
