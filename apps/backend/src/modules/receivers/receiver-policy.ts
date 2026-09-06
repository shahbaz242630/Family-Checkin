/**
 * Consent, opt-out and sender-action rules shared by the receivers services and controller. The numbers come
 * from BRD v2.1: an opted-out receiver cannot be re-invited for 7 days and invitations are rate-limited to one
 * per receiver per week (FR-SAF-07, BRD-4.5); "try later" retries the check-in two hours on (BRD-4.3).
 */
import { ConsentStatus } from '@prisma/client';

/** Days a STOP keeps the phone off-limits for new consent invitations (CB-009). */
export const OPT_OUT_COOLDOWN_DAYS = 7;
/**
 * Hours after the first consent invitation before the sender may resend it once. The first invitation does not
 * count toward the weekly cap (founder decision 2026-09-06, CB-081).
 */
export const CONSENT_FIRST_RESEND_DELAY_HOURS = 24;
/** Days between consent resends once one has been used: the BRD's "one per week max" (CB-009, CB-081). */
export const CONSENT_RESEND_MIN_INTERVAL_DAYS = 7;
/** Sender "try later" schedules the retry cascade this many minutes ahead (CB-017). */
export const TRY_LATER_RETRY_OFFSET_MINUTES = 120;
/** FR-CSC-06: the sender's resolution note is short free text, encrypted at rest (CB-018). */
export const MAX_RESOLUTION_NOTE_LENGTH = 200;
export const RESOLUTION_NOTE_TOO_LONG_MESSAGE = `Resolution note must be ${MAX_RESOLUTION_NOTE_LENGTH} characters or fewer`;

export const HOUR_IN_MS = 60 * 60 * 1000;
export const DAY_IN_MS = 24 * HOUR_IN_MS;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_IN_MS);
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * HOUR_IN_MS);
}

/** The consent fields the resend rule reads; `consentResendCount` is how many resends already went out. */
export interface ConsentResendState {
  consentStatus: ConsentStatus;
  consentRequestedAt?: Date;
  consentResendCount?: number;
}

/**
 * When the sender may next resend the consent invitation (CB-081): 24 hours after the first invitation, then
 * 7 days after each resend. `null` means nothing restricts a resend: consent is no longer PENDING (there is
 * nothing to resend), or no invitation ever left (the first send failed), so the sender may try right away.
 * A time in the past also means "now"; callers compare against their clock.
 */
export function consentResendAllowedAt(state: ConsentResendState): Date | null {
  if (state.consentStatus !== ConsentStatus.PENDING || !state.consentRequestedAt) {
    return null;
  }

  return (state.consentResendCount ?? 0) > 0
    ? addDays(state.consentRequestedAt, CONSENT_RESEND_MIN_INTERVAL_DAYS)
    : addHours(state.consentRequestedAt, CONSENT_FIRST_RESEND_DELAY_HOURS);
}

/**
 * Error text fit for audit metadata: bounded, and anything shaped like a phone number is masked so a provider
 * message that echoes the destination never lands in the append-only trail.
 */
export function auditSafeErrorMessage(error: unknown, fallback = 'Unknown failure'): string {
  const message = error instanceof Error ? error.message : fallback;
  return message.replace(/\+?\d[\d\s().-]{6,}\d/g, '[number]').slice(0, 200) || fallback;
}

/**
 * A request the sender made that the receiver's state forbids. The controller turns these into an HTTP error
 * with `{ code, message, ...details }` so the app can explain the refusal instead of showing a generic failure.
 */
export class ReceiverRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: 409 | 429,
    readonly details: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ReceiverRequestError';
  }
}

/** 409: the phone opted out (STOP) and the cooldown has not lapsed (CB-009). */
export class OptOutCooldownError extends ReceiverRequestError {
  constructor(readonly cooldownUntil: Date) {
    super(
      'OPT_OUT_COOLDOWN',
      'This person opted out of Nearby check-ins recently and cannot be invited again yet',
      409,
      { cooldownUntil: cooldownUntil.toISOString() },
    );
    this.name = 'OptOutCooldownError';
  }
}

/** 409: another sender already monitors this phone; co-monitoring is a later BRD phase (CB-014). */
export class ReceiverAlreadyMonitoredError extends ReceiverRequestError {
  constructor() {
    super('RECEIVER_ALREADY_MONITORED', 'This person is already receiving Nearby check-ins from another sender', 409);
    this.name = 'ReceiverAlreadyMonitoredError';
  }
}

/** 409: the latest check-in is still being sent or waiting on the receiver (CB-017). */
export class CheckInInProgressError extends ReceiverRequestError {
  constructor() {
    super('CHECK_IN_IN_PROGRESS', 'The current check-in is still in progress; wait for it to finish first', 409);
    this.name = 'CheckInInProgressError';
  }
}

/** 409: consent can only be re-requested while the receiver has not answered (CB-009). */
export class ConsentNotPendingError extends ReceiverRequestError {
  constructor(readonly consentStatus: string) {
    super('CONSENT_NOT_PENDING', 'Consent can only be re-requested while the receiver has not answered', 409, {
      consentStatus,
    });
    this.name = 'ConsentNotPendingError';
  }
}

/** 429: the resend window has not opened yet; `nextAllowedAt` says when it does (CB-009, CB-081). */
export class ConsentResendLimitError extends ReceiverRequestError {
  constructor(readonly nextAllowedAt: Date) {
    super('CONSENT_RESEND_LIMIT', 'A consent invitation was sent to this receiver recently', 429, {
      nextAllowedAt: nextAllowedAt.toISOString(),
    });
    this.name = 'ConsentResendLimitError';
  }
}
