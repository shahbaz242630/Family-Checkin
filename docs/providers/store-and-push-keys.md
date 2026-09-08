# Store and push credentials (Expo, Play, Firebase, Apple)

What each credential is, which one goes where, and why none of them may be
committed. The repository is public.

## The two files that get confused

They come from different consoles and do different jobs. Confusing them is the
bug that shipped in `eas.json` until 2026-09-07: the submit step pointed at the
build-time file, so the first `eas submit` would have failed.

| File | Comes from | Used at | Purpose |
|---|---|---|---|
| `google-services.json` | Firebase console → project settings → Android app | **build** time | Bakes FCM sender config into the Android binary so it can receive push (CB-031) |
| Play service-account key (`api-<project>-<id>.json`) | Play Console → Setup → API access → Google Cloud service account → JSON key | **submit** time | Authorises uploading a build to the Play track (CB-027) |

A third, `GoogleService-Info.plist`, is the iOS Firebase equivalent. iOS push
goes through APNs and does not need it unless Firebase is used for something
else, which we do not do.

## Where each one lives

### Play service-account key — outside the repository

`apps/mobile/eas.json` points at `../../../nearby-play-service-account.json`,
which resolves to the directory **above** the repository, not inside it. The
file is never in a working tree, so it cannot be committed, staged or archived
by accident.

After the first successful `eas submit`, EAS keeps the key on Expo's servers,
encrypted with Google KMS, and reuses it for later submissions. The local file
is only needed to hand it over the first time and can be deleted afterwards.

The `.gitignore` patterns (`*service-account*.json`, `api-*-*.json` and
friends) are defence in depth for the case where someone copies the file into
the repo anyway. They are not the plan.

**This key can publish to the Play listing.** Treat it like a password.

### `google-services.json` — an EAS file environment variable

Not yet wired up; it needs the Firebase file to exist. The mechanism, confirmed
against the Expo SDK 54 docs on 2026-09-07:

1. Upload it as a **file-type** EAS environment variable named
   `GOOGLE_SERVICES_JSON`, secret visibility.
2. Read it from the app config:
   ```js
   android: {
     googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
   }
   ```

Step 2 only works from a **dynamic** config (`app.config.js`). That conversion
is **done** — the founder approved it on 2026-09-08 and `apps/mobile/app.json`
is now `apps/mobile/app.config.js` (#49, CB-027). `app.config.js` inherited
`app.json`'s place on the protected list in
`docs/handoffs/auth-and-accounts.md`, so it still needs explicit approval to
change.

The `googleServicesFile` line itself is deliberately **not** in the config yet.
Pointing at a file that does not exist fails an Android build outright, and no
Firebase project has been created. Adding those three lines is the whole of
CB-031's config work once `google-services.json` exists.

## Identifiers, which are not secrets

These are public by design and belong in committed config:

| Value | Where it goes | Status |
|---|---|---|
| iOS bundle identifier | `app.config.js` → `ios.bundleIdentifier` | set: `com.familycheckin.app` |
| Android package | `app.config.js` → `android.package` | set: `com.familycheckin.app` |
| Expo slug | `app.config.js` → `expo.slug` | set: `family-checkin` |
| EAS project ID (UUID) | `app.config.js` → `extra.eas.projectId` | set: `ddb699e2-f321-4f9e-8c17-64eeefc4cfd3` (2026-09-08) |
| Expo owner | `app.config.js` → `expo.owner` | set: `shahbaz242630` (2026-09-08) |
| Apple Team ID | `eas.json` submit profile | **absent** — needed for the first `eas submit --platform ios` (CB-027) |
| Firebase project ID | inside `google-services.json` | **absent** (CB-031) |

## What is still open

Closed on 2026-09-08 (#49): the `${VAR}` interpolation is gone — each build
profile now names an `environment` and EAS supplies the values — and
`projectId`, `owner`, `versionCode`, `buildNumber` and
`ITSAppUsesNonExemptEncryption` are all set. `scripts/check-mobile-config.mjs`
fails CI if any of that regresses.

Still open:

- **No `eas build` has ever been run.** Everything above is config that reads
  correctly; none of it is proven until a build completes. CB-027's "Done when"
  is still unobserved.
- **`EXPO_PUBLIC_BACKEND_URL` exists only in the `development` environment**,
  carrying the local value, because nothing is hosted. Preview and production
  builds have no backend to reach; set it when hosting exists.
- **The three RevenueCat keys are not set** in any environment. There are no
  live products yet, so there are no values to set. `revenueCat.ts` degrades
  without them; billing simply will not work in a build until they exist.
- **Apple Team ID** is absent from the `eas.json` submit profile. Needed for
  the first iOS submission, not for a build.
- `android.googleServicesFile` and the Firebase project. CB-031.

## A trap in `.gitignore`

Line 81 is `*Credentials*`, and git's ignore matching is **case-insensitive on
Windows**. It therefore swallows any path containing "credentials" in any case —
including documentation. This file was first written as
`app-store-credentials.md` and was silently not staged by `git add -A`; nothing
warned, it simply never appeared in `git status`.

If a file you just wrote does not show up in `git status`, run
`git check-ignore -v <path>` before assuming anything else is wrong. Do not
narrow the pattern to make a file fit: rename the file. The pattern protects a
public repository, and the founder's `Credentials.xlsx` sits in the repo root.

## Rules

1. No credential file is ever committed. The repo is public and history is
   permanent — a leaked key means rotating it, not deleting the commit.
2. Identifiers may be committed. Keys, tokens and service-account JSON may not.
3. `Credentials.xlsx` in the repo root is the founder's, is untracked, and is
   ignored by `*Credentials*`. Nothing reads it without the founder asking.
