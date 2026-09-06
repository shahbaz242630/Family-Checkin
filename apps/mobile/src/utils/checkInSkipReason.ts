// Why a check-in ended SKIPPED. The backend writes these reasons on the cascade attempts it cancels
// (`check_in_attempts.failureReason`) and in the audit trail, but no API payload carries a reason on the
// check-in itself yet (CB-077). Label from a reason when one is available; otherwise say "Skipped" rather
// than guess.
export const CHECK_IN_SKIP_REASONS = {
  NO_BACKUP_CONTACTS: 'no_backup_contacts',
  RECEIVER_OPTED_OUT: 'receiver_opted_out',
  ABUSE_REPORTED: 'abuse_reported',
  RECEIVER_PAUSED: 'receiver_paused',
  RECEIVER_DELETED: 'receiver_deleted',
} as const;

export type CheckInSkipReason = (typeof CHECK_IN_SKIP_REASONS)[keyof typeof CHECK_IN_SKIP_REASONS];

const CANCELLATION_REASONS: readonly string[] = [
  CHECK_IN_SKIP_REASONS.RECEIVER_OPTED_OUT,
  CHECK_IN_SKIP_REASONS.ABUSE_REPORTED,
  CHECK_IN_SKIP_REASONS.RECEIVER_PAUSED,
  CHECK_IN_SKIP_REASONS.RECEIVER_DELETED,
];

export function isCheckInSkipReason(value: unknown): value is CheckInSkipReason {
  return typeof value === 'string' && (Object.values(CHECK_IN_SKIP_REASONS) as readonly string[]).includes(value);
}

/** Short status label for a SKIPPED check-in. "No backup available" is reserved for the escalation-skipped case. */
export function skippedCheckInLabel(reason?: string): string {
  switch (reason) {
    case CHECK_IN_SKIP_REASONS.NO_BACKUP_CONTACTS:
      return 'No backup available';
    case CHECK_IN_SKIP_REASONS.RECEIVER_OPTED_OUT:
      return 'Opted out';
    case CHECK_IN_SKIP_REASONS.ABUSE_REPORTED:
      return 'Reported';
    case CHECK_IN_SKIP_REASONS.RECEIVER_PAUSED:
      return 'Paused';
    case CHECK_IN_SKIP_REASONS.RECEIVER_DELETED:
      return 'Removed';
    default:
      return 'Skipped';
  }
}

/**
 * Derives the skip reason of a check-in from its cascade attempts: STOP, REPORT, pause and delete cancel the
 * pending attempts with the same reason they close the check-in (CB-008), so the first cancellation reason found
 * on a SKIPPED attempt is the check-in's reason. Returns undefined when no attempt carries one (for example every
 * attempt had already gone out), so callers fall back to the plain "Skipped" label.
 */
export function inferCheckInSkipReason(
  attempts: readonly { status?: string; failureReason?: string }[],
): CheckInSkipReason | undefined {
  for (const attempt of attempts) {
    if (attempt.status === 'SKIPPED' && attempt.failureReason && CANCELLATION_REASONS.includes(attempt.failureReason)) {
      return attempt.failureReason as CheckInSkipReason;
    }
  }
  return undefined;
}
