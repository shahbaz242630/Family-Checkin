import { describe, expect, it } from 'vitest';
import {
  CHECK_IN_SKIP_REASONS,
  inferCheckInSkipReason,
  isCheckInSkipReason,
  skippedCheckInLabel,
} from './checkInSkipReason';

describe('skippedCheckInLabel', () => {
  it('labels an opted-out, reported, paused or removed receiver by the reason, never as a missing backup', () => {
    expect(skippedCheckInLabel(CHECK_IN_SKIP_REASONS.RECEIVER_OPTED_OUT)).toBe('Opted out');
    expect(skippedCheckInLabel(CHECK_IN_SKIP_REASONS.ABUSE_REPORTED)).toBe('Reported');
    expect(skippedCheckInLabel(CHECK_IN_SKIP_REASONS.RECEIVER_PAUSED)).toBe('Paused');
    expect(skippedCheckInLabel(CHECK_IN_SKIP_REASONS.RECEIVER_DELETED)).toBe('Removed');
  });

  it('keeps "No backup available" for the escalation-skipped case only', () => {
    expect(skippedCheckInLabel(CHECK_IN_SKIP_REASONS.NO_BACKUP_CONTACTS)).toBe('No backup available');
  });

  it('falls back to a plain "Skipped" when the API gives no reason', () => {
    expect(skippedCheckInLabel()).toBe('Skipped');
    expect(skippedCheckInLabel(undefined)).toBe('Skipped');
    expect(skippedCheckInLabel('')).toBe('Skipped');
    expect(skippedCheckInLabel('something_new')).toBe('Skipped');
  });
});

describe('isCheckInSkipReason', () => {
  it('accepts only the known reasons', () => {
    expect(isCheckInSkipReason('receiver_opted_out')).toBe(true);
    expect(isCheckInSkipReason('no_backup_contacts')).toBe(true);
    expect(isCheckInSkipReason('response_window_elapsed')).toBe(false);
    expect(isCheckInSkipReason(undefined)).toBe(false);
    expect(isCheckInSkipReason(42)).toBe(false);
  });
});

describe('inferCheckInSkipReason', () => {
  it('reads the cancellation reason off a skipped cascade attempt', () => {
    expect(
      inferCheckInSkipReason([
        { status: 'TIMED_OUT', failureReason: 'response_window_elapsed' },
        { status: 'SKIPPED', failureReason: 'receiver_opted_out' },
      ]),
    ).toBe('receiver_opted_out');
    expect(inferCheckInSkipReason([{ status: 'SKIPPED', failureReason: 'abuse_reported' }])).toBe('abuse_reported');
    expect(inferCheckInSkipReason([{ status: 'SKIPPED', failureReason: 'receiver_paused' }])).toBe('receiver_paused');
    expect(inferCheckInSkipReason([{ status: 'SKIPPED', failureReason: 'receiver_deleted' }])).toBe('receiver_deleted');
  });

  it('ignores attempts skipped for engine reasons and attempts that are not skipped', () => {
    expect(inferCheckInSkipReason([{ status: 'SKIPPED', failureReason: 'cascade_closed' }])).toBeUndefined();
    expect(inferCheckInSkipReason([{ status: 'SKIPPED', failureReason: 'superseded_by_response' }])).toBeUndefined();
    expect(inferCheckInSkipReason([{ status: 'FAILED', failureReason: 'receiver_opted_out' }])).toBeUndefined();
    expect(
      inferCheckInSkipReason([{ status: 'SENT' }, { status: 'TIMED_OUT', failureReason: 'response_window_elapsed' }]),
    ).toBeUndefined();
    expect(inferCheckInSkipReason([])).toBeUndefined();
  });
});
