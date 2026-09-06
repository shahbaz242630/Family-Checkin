import { describe, expect, it } from 'vitest';
import { getReceiverStatusDisplay } from './receiverStatus';

describe('getReceiverStatusDisplay', () => {
  it('marks escalated check-ins as urgent backup alerts', () => {
    expect(getReceiverStatusDisplay('GRANTED', 'ESCALATED')).toEqual({
      label: 'Backup alerted',
      tone: 'error',
    });
  });

  it('marks failed escalation outcomes as urgent failures', () => {
    expect(getReceiverStatusDisplay('GRANTED', 'FAILED')).toEqual({
      label: 'Escalation failed',
      tone: 'error',
    });
  });

  it('labels a skipped check-in "Skipped" when the API gives no reason (CB-077)', () => {
    expect(getReceiverStatusDisplay('GRANTED', 'SKIPPED')).toEqual({
      label: 'Skipped',
      tone: 'muted',
    });
    expect(getReceiverStatusDisplay('GRANTED', 'SKIPPED').label).not.toBe('No backup available');
  });

  it('labels a skipped check-in by its reason when one is known', () => {
    expect(getReceiverStatusDisplay('GRANTED', 'SKIPPED', false, 'receiver_opted_out')).toEqual({
      label: 'Opted out',
      tone: 'muted',
    });
    expect(getReceiverStatusDisplay('GRANTED', 'SKIPPED', false, 'abuse_reported')).toEqual({
      label: 'Reported',
      tone: 'muted',
    });
    expect(getReceiverStatusDisplay('GRANTED', 'SKIPPED', false, 'receiver_paused')).toEqual({
      label: 'Paused',
      tone: 'muted',
    });
    expect(getReceiverStatusDisplay('GRANTED', 'SKIPPED', false, 'receiver_deleted')).toEqual({
      label: 'Removed',
      tone: 'muted',
    });
  });

  it('keeps "No backup available" for the escalation-skipped case only', () => {
    expect(getReceiverStatusDisplay('GRANTED', 'SKIPPED', false, 'no_backup_contacts')).toEqual({
      label: 'No backup available',
      tone: 'warning',
    });
  });

  it('lets consent and pause win over a skipped check-in', () => {
    expect(getReceiverStatusDisplay('REVOKED', 'SKIPPED')).toEqual({ label: 'Opted out', tone: 'muted' });
    expect(getReceiverStatusDisplay('GRANTED', 'SKIPPED', true)).toEqual({ label: 'Paused', tone: 'warning' });
  });

  it('marks resolved check-ins as closed', () => {
    expect(getReceiverStatusDisplay('GRANTED', 'RESOLVED')).toEqual({
      label: 'Resolved',
      tone: 'success',
    });
  });

  it('preserves existing consent, pause, and normal check-in mappings', () => {
    expect(getReceiverStatusDisplay('GRANTED', 'RESPONDED_OK')).toEqual({ label: 'OK', tone: 'success' });
    expect(getReceiverStatusDisplay('GRANTED', 'RESPONDED_HELP')).toEqual({ label: 'Needs help', tone: 'error' });
    expect(getReceiverStatusDisplay('GRANTED', 'SENT')).toEqual({ label: 'Awaiting reply', tone: 'warning' });
    expect(getReceiverStatusDisplay('PENDING')).toEqual({ label: 'Pending consent', tone: 'warning' });
    expect(getReceiverStatusDisplay('DECLINED')).toEqual({ label: 'Consent declined', tone: 'muted' });
    expect(getReceiverStatusDisplay('REVOKED')).toEqual({ label: 'Opted out', tone: 'muted' });
    expect(getReceiverStatusDisplay('GRANTED', undefined, true)).toEqual({ label: 'Paused', tone: 'warning' });
  });
});
