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

Step 2 only works from a **dynamic** config (`app.config.js`). Our config is
static `app.json`, which cannot read `process.env`, so adopting this means
converting `app.json` → `app.config.js`.

`app.json` is on the protected list in `docs/handoffs/auth-and-accounts.md`, so
that conversion needs the founder's explicit approval. It is part of CB-031 and
has not been done.

## Identifiers, which are not secrets

These are public by design and belong in committed config:

| Value | Where it goes | Status |
|---|---|---|
| iOS bundle identifier | `app.json` → `ios.bundleIdentifier` | set: `com.familycheckin.app` |
| Android package | `app.json` → `android.package` | set: `com.familycheckin.app` |
| Expo slug | `app.json` → `expo.slug` | set: `family-checkin` |
| EAS project ID (UUID) | `app.json` → `extra.eas.projectId` | **empty** — `npx eas init` prints it (CB-027) |
| Expo owner | `app.json` → `expo.owner` | **absent** (CB-027) |
| Apple Team ID | `eas.json` submit profile | **absent** (CB-027) |
| Firebase project ID | inside `google-services.json` | **absent** (CB-031) |

## What is still open

- `eas.json` build profiles use `${VAR}` interpolation in `env`. EAS does not
  expand shell syntax there, so those builds would receive the literal string
  `${EXPO_PUBLIC_SUPABASE_URL}`. The fix is EAS environment variables
  (`eas env:create`), which needs the Expo account. CB-027.
- `extra.eas.projectId`, `owner`, `versionCode`/`buildNumber` and
  `ITSAppUsesNonExemptEncryption` are all still missing from `app.json`
  (protected file, needs approval). CB-027.
- `android.googleServicesFile` and the `app.config.js` conversion. CB-031.

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
