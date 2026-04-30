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

  it('marks skipped missed escalation outcomes as warning states', () => {
    expect(getReceiverStatusDisplay('GRANTED', 'SKIPPED')).toEqual({
      label: 'No backup available',
      tone: 'warning',
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
