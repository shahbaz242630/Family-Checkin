import { describe, expect, it } from 'vitest';
import {
  backupAlertNotice,
  CONSENT_REQUEST_FAILED_NOTICE,
  consentResendNotice,
  MAX_RESOLUTION_NOTE_LENGTH,
  normalizeResolutionNote,
  resolutionNoteCounter,
} from './receiverActions';

describe('backupAlertNotice (CB-074)', () => {
  it('tells the sender to add a backup contact when there was none to alert', () => {
    expect(backupAlertNotice({ outcome: 'no_backup_contacts', alerted: 0, failed: 0 })).toEqual({
      message: 'No backup contacts to alert — add one below',
      tone: 'warning',
    });
  });

  it('counts the contacts that were alerted, singular and plural', () => {
    expect(backupAlertNotice({ outcome: 'alerted', alerted: 1, failed: 0 })).toEqual({
      message: 'Alerted 1 backup contact',
      tone: 'success',
    });
    expect(backupAlertNotice({ outcome: 'alerted', alerted: 3, failed: 0 })).toEqual({
      message: 'Alerted 3 backup contacts',
      tone: 'success',
    });
  });

  it('mentions the contacts that could not be reached when some were alerted', () => {
    expect(backupAlertNotice({ outcome: 'alerted', alerted: 2, failed: 1 })).toEqual({
      message: 'Alerted 2 backup contacts; 1 could not be reached',
      tone: 'warning',
    });
  });

  it('says when no backup contact could be reached', () => {
    expect(backupAlertNotice({ outcome: 'all_failed', alerted: 0, failed: 2 })).toEqual({
      message: 'Could not reach any backup contact',
      tone: 'error',
    });
  });
});

describe('consent notices (CB-009)', () => {
  it('confirms a resend and explains a failed one', () => {
    expect(consentResendNotice('requested')).toEqual({
      message: 'Invitation sent again. Check-ins start once they reply YES.',
      tone: 'success',
    });
    expect(consentResendNotice('failed')).toEqual({
      message: 'The invitation could not be sent. Try again in a moment.',
      tone: 'error',
    });
  });

  it('points the sender at Resend when the first invitation failed on create', () => {
    expect(CONSENT_REQUEST_FAILED_NOTICE.tone).toBe('error');
    expect(CONSENT_REQUEST_FAILED_NOTICE.message).toContain('Resend invitation');
  });
});

describe('normalizeResolutionNote (CB-018)', () => {
  it('treats blank input as no note', () => {
    expect(normalizeResolutionNote('')).toEqual({ ok: true, note: undefined });
    expect(normalizeResolutionNote('   \n ')).toEqual({ ok: true, note: undefined });
  });

  it('trims the note it sends', () => {
    expect(normalizeResolutionNote('  Spoke to her, all fine.  ')).toEqual({
      ok: true,
      note: 'Spoke to her, all fine.',
    });
  });

  it('accepts exactly 200 characters and refuses 201, counting code points like the API', () => {
    expect(MAX_RESOLUTION_NOTE_LENGTH).toBe(200);
    expect(normalizeResolutionNote('x'.repeat(200))).toEqual({ ok: true, note: 'x'.repeat(200) });
    expect(normalizeResolutionNote('x'.repeat(201))).toEqual({
      ok: false,
      message: 'Keep the note to 200 characters or fewer',
    });
    // 200 emoji are 400 UTF-16 units but 200 code points, which the backend accepts.
    expect(normalizeResolutionNote('😀'.repeat(200)).ok).toBe(true);
    expect(normalizeResolutionNote('😀'.repeat(201)).ok).toBe(false);
  });

  it('shows the running count against the cap', () => {
    expect(resolutionNoteCounter('')).toBe('0/200');
    expect(resolutionNoteCounter('  hello ')).toBe('5/200');
    expect(resolutionNoteCounter('😀😀')).toBe('2/200');
  });
});
