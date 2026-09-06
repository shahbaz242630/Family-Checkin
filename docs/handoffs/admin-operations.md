# Admin operations and abuse review — feature handoff

Status: Built · Last verified: routes 2026-09-06 (specs) · review-safe unpausing 2026-09-06 (acceptance run, via service) · mobile admin screens 2026-05-18 (emulator: Admin Operations and Abuse Reports loaded for the super-admin account)
BRD: FR-ADM-01, FR-ADM-02 (admin surface), FR-SAF-05 (abuse review) · Open backlog: CB-039, CB-062

## What it does

- Treats a signed-in Supabase user as an admin only when `admin_users.authProviderId` equals their Supabase user id and `active = true`; roles are `SUPER_ADMIN`, `OPERATOR`, `SUPPORT_READONLY`.
- Admin Operations shows the admin's role, 24-hour check-in status counts and the 25 newest operational check-ins, and opens a per-check-in detail with timeline, attempts and escalation rows.
- Abuse Reports shows the pending queue oldest first, the admin's review access state, and `Mark safe` / `Action taken` buttons enabled only for review-capable roles.
- A receiver `REPORT` reply files a `PENDING` abuse report and pauses the receiver; `REVIEWED_SAFE` lifts that pause, `REVIEWED_ACTION_TAKEN` keeps it (CB-007).
- Every review appends a PII-safe admin audit event (`reviewed_safe` / `reviewed_action_taken`, actor `ADMIN`, metadata `receiverId`, `reviewStatus`, `receiverResumed`).
- Every admin response carries operational identifiers, timestamps and counts only — no names, phone numbers, report bodies, transcripts, encrypted values, hashes or provider payloads.

## Where it lives

| Layer   | Paths                                    |
| ------- | ---------------------------------------- |
| Backend | `apps/backend/src/modules/admin-abuse/` (all files); `apps/backend/src/modules/operations/operations.controller.ts`, `operations-visibility.service.ts`, `prisma-operations-visibility.repository.ts`; `apps/backend/src/modules/auth/admin-auth.service.ts`, `admin-users.repository.ts`, `prisma-admin-users.repository.ts`, `auth.controller.ts`; `apps/backend/src/modules/receivers/abuse-review-pause.ts` (pause constants), `receiver-reply.service.ts` (REPORT handler) |
| Mobile  | `apps/mobile/src/app/(main)/admin-operations.tsx`, `apps/mobile/src/app/(main)/admin-operations/[checkInId].tsx`, `apps/mobile/src/app/(main)/admin-abuse-reports.tsx`, `apps/mobile/src/app/(main)/_layout.tsx` (stack screens), `apps/mobile/src/components/layout/Sidebar.tsx` (`MENU_ITEMS`), `apps/mobile/src/utils/adminOperations.ts`, `apps/mobile/src/services/backendApi.ts` |
| Data    | `admin_users` (`AdminRole`), `abuse_reports` (`AbuseReportStatus`), `receivers.pausedUntil` / `pausedReason`; DDL in `apps/backend/prisma/migrations/202604260001_initial_nearby_schema/migration.sql`; RLS in `apps/backend/prisma/20260430_internal_tables_rls.sql` (`admin_users` is deny-by-default, backend/service-role only) |
| Tests   | `admin-auth.service.spec.ts`, `prisma-admin-users.repository.spec.ts`, `auth.controller.spec.ts`, `operations.controller.spec.ts`, `operations-visibility.service.spec.ts`, `prisma-operations-visibility.repository.spec.ts`, `admin-abuse.controller.spec.ts`, `admin-abuse.service.spec.ts`, `prisma-admin-abuse.repository.spec.ts`, `app.module.spec.ts` (route table), `apps/mobile/src/utils/adminOperations.spec.ts` |

## Routes and contracts

All routes below take `Authorization: Bearer <Supabase access token>`. Missing or non-`Bearer` header → 401; token valid but no active `admin_users` row, or role not allowed → 403 `Active admin access is required`.

- `GET /auth/admin/me` — any active admin. Returns `admin.id` and `admin.role` only.
- `GET /operations/check-ins/summary` — any active admin. `ok`, `windowHours: 24`, `generatedAt`, `statusCounts`, `recent[]` (25 newest, soft-deleted receivers excluded).
- `GET /operations/check-ins/:checkInId` — any active admin. Check-in fields plus `attempts[]` and `escalations[]`; unknown id → 404.
- `GET /admin/abuse-reports` — any active admin. Up to 50 `PENDING` reports, oldest first, receiver not soft-deleted.
- `GET /admin/abuse-reports/:abuseReportId` — any active admin. Any status; unknown id → 404.
- `PATCH /admin/abuse-reports/:abuseReportId/review-safe` — `SUPER_ADMIN` or `OPERATOR` only. Sets `REVIEWED_SAFE` and clears the abuse-review pause.
- `PATCH /admin/abuse-reports/:abuseReportId/review-action-taken` — `SUPER_ADMIN` or `OPERATOR` only. Sets `REVIEWED_ACTION_TAKEN`, receiver stays paused.
- Report fields returned by all three abuse routes: `id`, `receiverId`, `reportedAt`, `reviewStatus`, `reviewerAdminId?`, `reviewedAt?`, `hasReportContent` (boolean).
- Not owned by this feature: `POST /operations/check-ins/run` is the scheduler tick, authorised by `OPERATIONS_CRON_SECRET` (timing-safe compare) and `@SkipThrottle()`.

Provisioning an admin: there is no invite endpoint, seed or script. Insert a row into `admin_users` by hand over a service-role connection (RLS denies everything else). The code requires `authProviderId` = the Supabase auth user's id (`user.id`, as read by `SupabaseAuthService.verifyAccessToken`), `active = true`, and `role` set to one of the three enum values. `emailEncrypted` and `emailHash` are `NOT NULL` (and `emailHash` is unique), so the insert must supply both, but the admin auth path never selects or returns them.

## How to exercise it locally (fake mode)

- Bring up the throwaway database, backend and emulator per `docs/EMULATOR_RUNBOOK.md` §2–§4.
- Fake mode does not stub Supabase, so the admin HTTP routes need a real Supabase access token. Sign into the app as the Supabase user whose id is in `admin_users`, then open the drawer → `Admin Operations` / `Abuse Reports`.
- Runbook scenario 8: fake `REPORT` reply → the next `POST /operations/check-ins/run` creates no check-in for that receiver; after `Mark safe`, the next tick creates one.
- Without a Supabase JWT, drive the review through the DI graph instead of HTTP: boot the real `AppModule` and call `AdminAbuseService.markSafe(abuseReportId, { adminId })` — this is what the acceptance run did (`docs/audits/2026-09-06/sprint1-acceptance.md`, driver `review-safe.ts`).
- Specs: `npm.cmd --prefix apps/backend test -- admin-abuse admin-auth.service.spec.ts operations.controller.spec.ts` and `npx.cmd vitest run apps/mobile/src/utils/adminOperations.spec.ts`.

## Invariants — do not break

- Admin responses stay PII-free. `reportContent` is never selected past `abuseReportSafeSelect`; it is exposed only as the boolean `hasReportContent`. The operations summary and detail carry ids, statuses, timestamps and counts only.
- `verifyAdminAccessToken` defaults to all three roles. Review mutations must keep passing the explicit `[SUPER_ADMIN, OPERATOR]` list; dropping it silently grants `SUPPORT_READONLY` write access.
- Admin rows are never auto-created from sender auth, and `GET /auth/admin/me` must not start returning admin email, encrypted email or email hash.
- The review-safe unpause is conditional: `receiver.updateMany` matches only `pausedReason = 'abuse_report_pending_review'` and `abuseReports: { none: { reviewStatus: PENDING } }`. This is what stops an abuse review clearing a sender's own pause, and what keeps a receiver paused while a second report is still open.
- Scheduler eligibility reads `pausedUntil` alone, so the abuse pause must keep writing both the `9999-12-31T00:00:00.000Z` sentinel and the reason (`abuse-review-pause.ts`); clearing one without the other breaks CB-007 in either direction.
- `reviewPending` is an `updateMany` guarded on `reviewStatus = PENDING`, so a repeat review returns 404 rather than overwriting an existing verdict or re-firing the unpause.
- `REVIEWED_ACTION_TAKEN` must not resume the receiver.
- Listing, detail and review all exclude soft-deleted receivers (`receiver: { deletedAt: null }`).
- `OPERATIONS_CRON_SECRET` never reaches an admin or client surface; the admin GET routes stay throttled while only the cron POST skips the limiter.

## Known gaps

- CB-039 — the drawer lists `Admin Operations` and `Abuse Reports` for every signed-in user; a non-admin reaches the screen and gets the access-denied state instead of never seeing the entry. Fix is to gate `MENU_ITEMS` on a cached `getAdminMe` result.
- CB-062 — no health metrics beyond check-in counts (receivers, channel error rates, abuse, billing), no reviewer note, no report-content view, and no pause-account / contact-sender abuse actions.
- Founder decision 4 (`docs/COMPLETION_BACKLOG.md`) is open: keep the admin screens inside the sender app or build a separate Next.js panel. It shapes both CB-039 and CB-062.
- No admin provisioning, invite or deactivation endpoint; `admin_users` rows are inserted and edited by hand.

## History

- Archived handoff: `docs/archive/PROJECT_HANDOFF_2026-04-26_to_2026-09-06.md` §22 (lines 1865–1916, operations visibility), §23 (1917–1963, admin auth foundation), §26 (2033–2100, dashboard and check-in detail UI), §26b (2101–2151, abuse review queue), §0a (793–804, sprint 1).
- Acceptance: `docs/audits/2026-09-06/sprint1-acceptance.md` scenario S7 (REPORT → pause → `AdminAbuseService.markSafe` on the real DI graph → resumed).
- PRs: #17 (CB-007 REPORT pauses check-ins, reviewed-safe unpauses).
