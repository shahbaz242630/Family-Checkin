/**
 * A REPORT reply pauses the receiver until an admin reviews the abuse report (CB-007).
 *
 * The scheduler decides eligibility from `pausedUntil` alone (`CheckInsService.isEligible`,
 * `PrismaCheckInsRepository.findReceiversDueForCheckIn`), so the review pause is stored as a far-future
 * `pausedUntil` plus this reason. `AdminAbuseService` clears both on REVIEWED_SAFE, and only while the reason
 * still matches, so a sender's own pause (`pauseForUserById`) is never clobbered by an abuse review.
 */
export const ABUSE_REVIEW_PAUSE_REASON = 'abuse_report_pending_review';
export const ABUSE_REVIEW_PAUSE_UNTIL = new Date('9999-12-31T00:00:00.000Z');
