import type { BackendBackupAlertResult, BackendConsentRequestStatus } from '../services/backendApi';
import { formatBackendDate } from '../services/backendErrors';
import type { ReceiverStatusTone } from './receiverStatus';

/** An in-screen message shown under the status band after a sender action on the receiver detail. */
export interface ActionNotice {
  message: string;
  tone: ReceiverStatusTone;
}

/** FR-CSC-06 / CB-018: the API refuses anything longer, so the app checks first; counted in code points like the API. */
export const MAX_RESOLUTION_NOTE_LENGTH = 200;

/** What "Alert backup contacts" achieved, in the sender's words (CB-074). */
export function backupAlertNotice(result: BackendBackupAlertResult): ActionNotice {
  switch (result.outcome) {
    case 'no_backup_contacts':
      return { message: 'No backup contacts to alert — add one below', tone: 'warning' };
    case 'all_failed':
      return { message: 'Could not reach any backup contact', tone: 'error' };
    default: {
      const alerted = `Alerted ${result.alerted} backup ${result.alerted === 1 ? 'contact' : 'contacts'}`;
      return result.failed > 0
        ? { message: `${alerted}; ${result.failed} could not be reached`, tone: 'warning' }
        : { message: alerted, tone: 'success' };
    }
  }
}

/** Outcome of "Resend invitation" (CB-009). */
export function consentResendNotice(status: BackendConsentRequestStatus): ActionNotice {
  return status === 'requested'
    ? { message: 'Invitation sent again. Check-ins start once they reply YES.', tone: 'success' }
    : { message: 'The invitation could not be sent. Try again in a moment.', tone: 'error' };
}

export type ConsentResendAvailability = { available: true } | { available: false; message: string };

/**
 * Whether "Resend invitation" may be tapped, from the backend's `consentResendAllowedAt` (CB-081): null, absent,
 * unparseable or already past means the window is open; a future time disables the button and names the moment it
 * unlocks in the sender's local date and time.
 */
export function consentResendAvailability(
  allowedAt: string | null | undefined,
  now: Date = new Date(),
  formatDate: (isoDate: string) => string = formatBackendDate,
): ConsentResendAvailability {
  if (!allowedAt) {
    return { available: true };
  }
  const unlocksAt = new Date(allowedAt);
  if (Number.isNaN(unlocksAt.getTime()) || unlocksAt.getTime() <= now.getTime()) {
    return { available: true };
  }
  return { available: false, message: `Resend available ${formatDate(allowedAt)}` };
}

/** Shown on the detail the add-receiver form lands on when the first consent send failed (CB-009). */
export const CONSENT_REQUEST_FAILED_NOTICE: ActionNotice = {
  message: 'Receiver added, but the consent invitation could not be sent. Tap Resend invitation to try again.',
  tone: 'error',
};

export type ResolutionNoteCheck = { ok: true; note: string | undefined } | { ok: false; message: string };

/** Trims the note; blank means "no note"; over the cap is refused before any request is made (CB-018). */
export function normalizeResolutionNote(input: string): ResolutionNoteCheck {
  const note = input.trim();
  if (!note) {
    return { ok: true, note: undefined };
  }
  if (Array.from(note).length > MAX_RESOLUTION_NOTE_LENGTH) {
    return { ok: false, message: `Keep the note to ${MAX_RESOLUTION_NOTE_LENGTH} characters or fewer` };
  }
  return { ok: true, note };
}

/** "12/200" for the note field. */
export function resolutionNoteCounter(input: string): string {
  return `${Array.from(input.trim()).length}/${MAX_RESOLUTION_NOTE_LENGTH}`;
}
