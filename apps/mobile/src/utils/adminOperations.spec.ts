import { describe, expect, it } from 'vitest';
import {
  attemptStatusLabel,
  escalationResultLabel,
  failureReasonLabel,
  formatOperationsDateTime,
  operationsStatusLabel,
  sortStatusCounts,
} from './adminOperations';

describe('admin operations formatting', () => {
  it('maps operational check-in statuses to readable labels', () => {
    expect(operationsStatusLabel('RESPONDED_HELP')).toBe('Needs help');
    expect(operationsStatusLabel('ESCALATED')).toBe('Backup alerted');
    expect(operationsStatusLabel('FAILED')).toBe('Escalation failed');
    expect(operationsStatusLabel('SKIPPED')).toBe('No backup available');
    expect(operationsStatusLabel('RESOLVED')).toBe('Resolved');
    expect(operationsStatusLabel('SENT')).toBe('Awaiting reply');
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

  it('sorts needs-attention before failed and skipped operational states', () => {
    expect(sortStatusCounts({ SKIPPED: 1, NEEDS_ATTENTION: 2, FAILED: 3 }).map((item) => item.status)).toEqual([
      'NEEDS_ATTENTION',
      'FAILED',
      'SKIPPED',
    ]);
  });
});
