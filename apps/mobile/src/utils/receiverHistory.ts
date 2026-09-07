import type { BackendReceiverCheckIn, BackendReceiverCheckInEscalation } from '../services/backendApi';
import type { ReceiverStatusDisplay, ReceiverStatusTone } from './receiverStatus';

/**
 * The receiver detail's 30-day history (CB-036, FR-DSB-01/02, BRD-4.6).
 *
 * The backend returns the check-ins themselves; turning them into one row per day is the app's job, and it is
 * done here rather than in the screen so it can be tested. Days are the receiver's own calendar days, not the
 * sender's: a daughter in London looking at a mother in Dubai must see the mother's Tuesday.
 */

/** How significant a check-in outcome is, so a day with several check-ins is described by its worst one. */
const CHECK_IN_SEVERITY: Record<string, number> = {
  RESPONDED_HELP: 6,
  NEEDS_ATTENTION: 5,
  FAILED: 5,
  ESCALATED: 4,
  SKIPPED: 3,
  SENT: 2,
  PENDING: 2,
  RESOLVED: 1,
  RESPONDED_OK: 0,
};

const CHECK_IN_DAY_STATUS: Record<string, ReceiverStatusDisplay> = {
  RESPONDED_OK: { label: 'Answered OK', tone: 'success' },
  RESOLVED: { label: 'Resolved', tone: 'success' },
  RESPONDED_HELP: { label: 'Asked for help', tone: 'error' },
  ESCALATED: { label: 'Backup alerted', tone: 'error' },
  NEEDS_ATTENTION: { label: 'No answer', tone: 'error' },
  FAILED: { label: 'Escalation failed', tone: 'error' },
  SKIPPED: { label: 'Skipped', tone: 'muted' },
  SENT: { label: 'Awaiting reply', tone: 'warning' },
  PENDING: { label: 'Scheduled', tone: 'muted' },
};

export const NO_CHECK_IN_DAY: ReceiverStatusDisplay = { label: 'No check-in', tone: 'muted' };

export interface ReceiverHistoryDay {
  /** `YYYY-MM-DD` in the receiver's timezone; also the React key. */
  date: string;
  /** Short human label for the row, for example `Sun 7 Sep`. */
  label: string;
  status: ReceiverStatusDisplay;
  /** What happened, in one line: the times that matter for that day. */
  detail: string;
  /** Escalation events recorded across the day's check-ins, in the order they were attempted. */
  escalations: ReceiverHistoryEscalation[];
  /** `escalations.length`, kept as its own field because the row leads with the count. */
  escalationCount: number;
  checkInIds: string[];
}

export interface ReceiverHistoryEscalation {
  id: string;
  /** "Attempt 2 - Voice - Reached you" — what the sender needs to read in one line. */
  label: string;
}

const CHANNEL_LABELS: Record<string, string> = {
  SMS: 'SMS',
  WHATSAPP: 'WhatsApp',
  VOICE: 'Voice',
};

const ESCALATION_RESULTS: Record<string, string> = {
  SUCCESS: 'reached you',
  NO_RESPONSE: 'no response',
  ERROR: 'failed',
};

/** One escalation attempt in words: which try, which channel, and how it ended when it has ended. */
export function describeEscalation(escalation: BackendReceiverCheckInEscalation): string {
  const channel = CHANNEL_LABELS[escalation.channel] ?? escalation.channel;
  const outcome = escalation.result
    ? (ESCALATION_RESULTS[escalation.result] ?? escalation.result.toLowerCase())
    : escalation.completedAt
      ? 'completed'
      : 'in progress';

  return `Attempt ${escalation.attemptNumber} - ${channel} - ${outcome}`;
}

/** The label for a single check-in status, used by the day rows and by the detail's latest-check-in panel. */
export function checkInStatusDisplay(status?: string): ReceiverStatusDisplay {
  if (!status) {
    return NO_CHECK_IN_DAY;
  }

  return CHECK_IN_DAY_STATUS[status] ?? { label: humanizeStatus(status), tone: 'muted' as ReceiverStatusTone };
}

/**
 * The receiver's local calendar date (`YYYY-MM-DD`) for an instant. Mirrors the backend's
 * `localDateInTimeZone`, and falls back to the UTC date when the platform cannot evaluate the zone (a receiver
 * saved with a bad timezone is a known state, CB-069 — the history must still render).
 */
export function localDateKey(instant: Date, timeZone: string): string {
  if (Number.isNaN(instant.getTime())) {
    return '';
  }

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(instant);
    const read = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? '';
    const year = read('year');
    const month = read('month');
    const day = read('day');
    if (!year || !month || !day) {
      return instant.toISOString().slice(0, 10);
    }

    return `${year.padStart(4, '0')}-${month}-${day}`;
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}

/** The calendar day `offset` days before `date` (`YYYY-MM-DD` in, `YYYY-MM-DD` out). */
export function shiftDateKey(date: string, offset: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  parsed.setUTCDate(parsed.getUTCDate() + offset);
  return parsed.toISOString().slice(0, 10);
}

export function formatHistoryDayLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return parsed.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export interface BuildReceiverHistoryDaysInput {
  checkIns: BackendReceiverCheckIn[];
  /** The receiver's IANA timezone; days are theirs, not the sender's. */
  timeZone: string;
  /** How many days the list covers, ending on the day of `endAt`. */
  days: number;
  /** Normally "now"; injected so the rows are testable. */
  endAt: Date;
}

/**
 * One row per day, newest first, covering the whole window — including the days on which nothing happened,
 * because "no check-in went out on Tuesday" is exactly what a sender is looking for.
 */
export function buildReceiverHistoryDays(input: BuildReceiverHistoryDaysInput): ReceiverHistoryDay[] {
  const byDate = new Map<string, BackendReceiverCheckIn[]>();
  for (const checkIn of input.checkIns) {
    const date = checkIn.scheduledLocalDate ?? localDateKey(new Date(checkIn.scheduledAt), input.timeZone);
    if (!date) {
      continue;
    }
    byDate.set(date, [...(byDate.get(date) ?? []), checkIn]);
  }

  const today = localDateKey(input.endAt, input.timeZone);
  const rows: ReceiverHistoryDay[] = [];
  for (let offset = 0; offset < Math.max(input.days, 0); offset += 1) {
    const date = shiftDateKey(today, -offset);
    rows.push(toHistoryDay(date, byDate.get(date) ?? []));
  }

  return rows;
}

function toHistoryDay(date: string, checkIns: BackendReceiverCheckIn[]): ReceiverHistoryDay {
  const escalations = checkIns
    .flatMap((checkIn) => checkIn.escalations)
    .sort((a, b) => a.attemptNumber - b.attemptNumber)
    .map((escalation) => ({ id: escalation.id, label: describeEscalation(escalation) }));
  const worst = [...checkIns].sort(
    (a, b) => (CHECK_IN_SEVERITY[b.status] ?? 0) - (CHECK_IN_SEVERITY[a.status] ?? 0),
  )[0];

  return {
    date,
    label: formatHistoryDayLabel(date),
    status: checkInStatusDisplay(worst?.status),
    detail: describeCheckInDay(checkIns, worst),
    escalations,
    escalationCount: escalations.length,
    checkInIds: checkIns.map((checkIn) => checkIn.id),
  };
}

function describeCheckInDay(checkIns: BackendReceiverCheckIn[], worst?: BackendReceiverCheckIn): string {
  if (!worst) {
    return 'No check-in was scheduled.';
  }

  const parts: string[] = [];
  if (worst.sentAt) {
    parts.push(`Sent ${formatClockTime(worst.sentAt)}`);
  }
  if (worst.respondedAt) {
    parts.push(`answered ${formatClockTime(worst.respondedAt)}`);
  }
  if (worst.resolvedAt) {
    parts.push(`resolved ${formatClockTime(worst.resolvedAt)}`);
  }
  if (checkIns.length > 1) {
    parts.push(`${checkIns.length} check-ins`);
  }

  return parts.length > 0 ? `${parts.join(', ')}.` : 'Scheduled, nothing sent yet.';
}

function formatClockTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }

  return parsed.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export const NEVER_HEARD_FROM_LABEL = 'No reply yet';

/**
 * "Last heard from" for a dashboard card or the detail header: how long ago the receiver last answered, in the
 * words a person would use. Anything older than a week becomes a date, because "23 days ago" stops being useful.
 */
export function formatLastHeardFrom(lastHeardFrom: string | null | undefined, now: Date): string {
  if (!lastHeardFrom) {
    return NEVER_HEARD_FROM_LABEL;
  }

  const answeredAt = new Date(lastHeardFrom);
  if (Number.isNaN(answeredAt.getTime())) {
    return NEVER_HEARD_FROM_LABEL;
  }

  const minutes = Math.floor((now.getTime() - answeredAt.getTime()) / 60_000);
  if (minutes < 0) {
    // A clock skew between the device and the server must not read "in -3 minutes".
    return 'Just now';
  }
  if (minutes < 1) {
    return 'Just now';
  }
  if (minutes < 60) {
    return `${minutes} ${plural(minutes, 'minute')} ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} ${plural(hours, 'hour')} ago`;
  }

  const days = Math.floor(hours / 24);
  if (days <= 7) {
    return `${days} ${plural(days, 'day')} ago`;
  }

  return answeredAt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

function humanizeStatus(status: string): string {
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}
