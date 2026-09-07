# Sprint 4 wave 1 — acceptance

Date: 2026-09-07
Merged: #45 (CB-027 partial), #46 (CB-032, CB-033, CB-036, CB-037), #44 (CB-029,
CB-039), #43 (CB-034, CB-035, CB-041). `master` green at `5811e59`.
Method: three worktree agents with disjoint file ownership, lead review of each
diff before merge, `npm run verify` and `npm run test:coverage` locally on every
rebase, all required CI checks on every PR.

## Baseline and result

| | Before | After |
|---|---|---|
| Spec files | 87 | 95 |
| Tests | 894 | **1002** |
| Mobile project | 14 files / 100 tests | 22 files / 194 tests |
| Coverage (stmts/branches/funcs/lines) | 59.65 / 53.0 / 60.7 / 58.96 | 61.69 / 55.87 / 62.28 / 62.5 |

## Checks

| # | Check | Item | Result |
|---|---|---|---|
| S4-1 | A 401 or network failure shows an error state with retry | CB-032 | `describeReceiversFailure` classifies network, `PHONE_REQUIRED` 401 and plain 401; dashboard renders it with **Try again**. Previously rendered "No receivers yet" — a lie. Dead "Review receivers" action removed. |
| S4-2 | Profile shows current name/phone; Save disabled with no edits | CB-033 | `profileFormValues(null)` is null so nothing seeds while loading; `profileFormChanged` false until a real edit; `buildProfileMetadataUpdate` never blanks a stored value. |
| S4-3 | Detail shows the last 30 days with a status per day; pause accepts an end date | CB-036 | `GET /receivers/:id/check-ins?days=30` with escalation events, owner-scoped, `days` bounded 1–90 by schema and rows capped at 200. Day-per-row history, `lastHeardFrom` on cards. |
| S4-4 | `backendApi` covers timeout, 401 → sign-out, `PHONE_REQUIRED` → profile, 429 copy | CB-037 | All four covered plus a coded-429 case. `AppState` drives `startAutoRefresh`/`stopAutoRefresh`. |
| S4-5 | Email confirmation opens the app once and never flashes "Verification Failed" | CB-029 | `useDeepLinks` is the only caller of `getInitialURL`/`addEventListener('url')`/`handleAuthDeepLink` and dedupes URLs. 17 specs. Warm-start recovery fixed because the screen no longer reads the *launch* URL. |
| S4-6 | A non-admin sees no admin entries | CB-039 | `sidebarMenu.spec.ts` proves a non-admin gets exactly the two non-admin paths. `getAdminMe` cached per user id; a 403 is cached so it cannot repeat; a transport failure is not cached, so an offline admin retries. |
| S4-7 | No control on any settings screen is a no-op | CB-034 | Appearance, Language, the biometric toggle and `services/biometric.ts` removed outright, and their menu entries with them. Terms/Privacy deferred — see below. |
| S4-8 | Siren test schedules on the right channel with the right sound | CB-035 | Asserted at the schedule-call level: channel, sound, `interruptionLevel`, trigger, permission refusal, Expo Go refusal, every DND mapping. |
| S4-9 | A purchase shows as active without leaving the screen | CB-041 | `/billing/status` polled up to 60 s on a fake clock; `Purchases.logIn`/`logOut` replace a second `configure()`; export type keys renamed to `checkIns`/`escalations`. |
| S4-10 | Sign-out clears the RevenueCat identity | CB-041 | `signOutEverywhere` (this PR): RevenueCat first, then Supabase, with the store SDK unable to block the sign-out. See "A bug found during the close". |
| S4-11 | The Play submit key is not the Firebase file, and is not committable | CB-027 (partial) | `serviceAccountKeyPath` resolves outside the repository; `.gitignore` covers service-account filenames. `docs/providers/store-and-push-keys.md`. |

## A bug found during the close

Agent C built `logOutRevenueCat()` and could not call it: its caller lives in the
sign-out path, which belonged to another agent's branch. Wiring it up at close
surfaced a defect in the obvious implementation.

`logOutRevenueCat()` has no internal `try`/`catch`. Awaiting it directly inside
`signOut` means a throw from `Purchases.logOut()` skips the Supabase sign-out
**and** skips `setLoading(false)` — the sender is left on a spinner, still
signed in, because a billing SDK failed. The first draft of this change had
exactly that bug, with a comment claiming the opposite.

The shipped version extracts `signOutEverywhere()`: RevenueCat first (so the
next account cannot inherit the identity), its failure swallowed, Supabase
sign-out always attempted, `setLoading(false)` in a `finally`. Three specs cover
the ordering, the swallow and the propagation of a genuine Supabase failure.

The general rule this is an instance of: a third-party SDK must never be able to
prevent a user from signing out.

## A flaky gate, fixed rather than re-run

`http-hardening.integration.spec.ts` failed during the closing verify with
`Hook timed out in 10000ms`. Agent C had seen it once too and reported it as a
flake that "passed on every clean run and in CI".

It is the only hook in the suite that does real I/O — it boots a Nest app and
binds a port — and vitest's default 10 s hook budget is not enough for that on a
loaded machine. Both hooks now get 60 s, with the reason in a comment.

Re-running until green would have left a gate that fails under load, which is
exactly the condition CI runs in, and which teaches people to re-run instead of
read.

## Deliberately not done

- **Terms/Privacy links** (part of CB-034) still point at an unowned domain.
  They depend on founder Decision 9 — where the real documents are hosted — and
  were explicitly out of scope. CB-034's row records this.
- **No device pass.** No emulator was started this wave; the founder renders
  video on this machine and everything here was verifiable by test. Owed on a
  device: cold-start email confirmation, warm-start recovery link, a non-admin's
  drawer, the siren with the app backgrounded, and a sandbox purchase.
- **No React Native Testing Library.** CB-032's row asked for "the first screen
  test with RNTL"; the lead overruled it. All logic was extracted to hooks,
  utils and services and tested with plain vitest, matching the existing 14 spec
  files. Nothing in nine backlog rows turned out to need a screen renderer,
  which suggests the row was wrong rather than the decision.
- **`google-services.json` wiring and `${VAR}` interpolation** (CB-027/CB-031)
  need the Expo account and an `app.json` → `app.config.js` conversion, which
  touches a protected file.

## Protected files

The founder gave explicit, narrow approval to edit four of the eight protected
mobile auth files for CB-029 and CB-039, on the terms "surgical edits only, with
a per-file account in the PR". Verified by the lead rather than accepted:

- `contexts/AuthContext.tsx` — **49 additions, 0 deletions**. No existing auth
  line could have moved.
- `app/_layout.tsx` — 5 added, 48 deleted: the duplicate handler removed.
- `app/auth/reset-password.tsx` — the existing `getSession()` fallback and its
  exact error strings preserved; cancellation and timer cleanup added, both of
  which the old effect leaked.
- `app/auth/callback.tsx` — effect replaced, all three render branches and every
  style untouched.

`app.json`, `services/supabase.ts`, `services/auth.ts` and
`components/auth/ProtectedRoute.tsx` were not touched.

`hooks/useAuth.ts` was edited in this closing PR. It appears in the auth
handoff's *ownership* table but is **not** on the protected list, which is a
different and shorter list.

### The `--no-verify` commit

Agent A committed #44 with `--no-verify`. The lead verified the reason rather
than accepting it: `reset-password.tsx`, `AuthContext.tsx` and `Sidebar.tsx` are
prettier-dirty on `master`, so the pre-commit hook would have reflowed unrelated
lines *inside protected files* — precisely what the approval forbade. The secret
scan was run by hand and the pre-push hooks ran normally. After the rebase the
lead re-checked that prettier still reports those three files as unformatted,
confirming nothing was rewritten.

This is the second wave in which the repo's formatting debt has cost real work.
The one-off Prettier commit and the `format:check` gate should be scheduled.

## Process notes

- **File-ownership splitting worked again.** Three agents, 19–37 files each,
  **zero code conflicts**. Every conflict in the wave was documentation.
- **Documentation is the bottleneck, not code.** All three agents correctly
  updated `COMPLETION_BACKLOG.md`, `mobile-app.md` and `auth-and-accounts.md`,
  and those three files conflicted on every rebase. In three separate blocks
  *neither side was correct* — master listed a file another PR had deleted, or a
  branch lacked a hook another PR had added. Next wave: have agents write their
  handoff changes to a per-agent fragment that the lead merges at close.
- **Strict status checks make parallel waves expensive at merge.** The
  `protect-master` ruleset sets `strict_required_status_checks_policy`, so every
  branch must be current with `master` before merging: four PRs cost four
  sequential rebases and four full CI runs. Two or three agents is the better
  size.
- **An agent's justification needs checking even when its conclusion is right.**
  Agent B reported the GitGuardian failure as "the documented false positive
  from `PROJECT_HANDOFF.md`". That note is about gitleaks, a different tool. The
  conclusion (not a required check) held, but the lead verified the substance
  independently: no keys, JWTs or tokens in the diff, and the required
  Security-scans gate green.
- **Lead errors this wave**, recorded so they stop repeating: writing `#PR`
  placeholders into docs before the PR existed (cost two follow-up commits), and
  using `sed -n 'Ap;Bp'` expecting the written order — it emits in *file* order,
  which scrambled a routes table and six backlog rows before being caught.
