# Sprint 4 wave 2 — acceptance

Date: 2026-09-08. PRs #49, #51, #52, #53. Master green at each merge.

The wave that produced the first installable build of this app, and the first
time any of it ran on a device.

## What was verified on a device

Android development build `8085bafa-fcb0-41b1-bbcb-c5d626456e34`, installed on a
fresh `Nearby_Test` AVD (Android 16, API 36, x86_64), Metro on `10.0.2.2:8081`,
backend in fake-provider mode against a throwaway Postgres, signed in as the
founder's test account.

| ID | Claim before | Result | Evidence |
| --- | --- | --- | --- |
| CB-031 | "Android push impossible: no FCM `googleServicesFile`" | **Works** | `device_tokens`: one `android` row, `active = true`, `ExponentPushToken[XLOC6WHx4Lcy…]`, 41 chars. An Expo push token for Android cannot be issued without a valid FCM sender config, so this is end-to-end proof that `google-services.json` reached the builder through the EAS secret file variable and survived into the binary. |
| CB-078 | "Supabase PKCE downgrades to `plain` (`WebCrypto API is not supported`)" | **Fixed, no code change** | Sign-in with email and password succeeded and the session persisted. Zero `WebCrypto` lines in logcat. The defect was Expo Go's missing WebCrypto, not our code; a development build has it. |
| CB-082 | "Lazily imported `expo-notifications` chunk failed to parse" | **Fixed, no code change** | The chunk parsed: the app reached `ensurePushPermission`, Android showed the notification permission dialog, and registration completed. A parse failure would have stopped it before the dialog. Also an Expo Go artefact. |
| CB-028 | "Google/Apple sign-in rejects every callback" | **Not tested** | The OAuth flow was not driven. The emulator image is `google_apis` without the Play Store, so a failure there would not have been conclusive about our code. Still open. |

Also confirmed in the same run: `POST /auth/sync-user` created the `users` row,
so the full mobile → backend → Postgres path works from a real binary.

Two of the four rows above were already fixed before this session started. They
were unverifiable rather than broken, and the build is what proved it. The
backlog said "blocked by X" when it should have said "unobserved".

## What the build attempts found

Three attempts. The two failures were both real defects that no amount of config
review would have surfaced, and both were invisible to CI.

1. **`expo-dev-client` was not installed** (#52). The `development` profile sets
   `developmentClient: true`; that shell is the package, and it was missing. EAS
   refused in the pre-flight check, ~1 minute.
2. **`escalation-siren.wav` broke the Android resource-name rule** (#53, CB-089).
   `expo-notifications` copies the filename into a `res/raw` resource name, which
   accepts only `[a-z0-9_]`. The hyphen failed prebuild. **No Android build of
   this app had ever been possible**, and CI could not have caught it: CI runs
   unit tests and a backend build, never a native one.

Renamed to `escalation_siren.wav` across the four places that must match.

## What is still not proven

- **CB-028** — social login, untested.
- **iOS entirely.** No iOS build has been attempted. APNs needs an Apple push
  key on EAS, which does not exist.
- **The siren actually sounding.** CB-035's device pass is still owed; this run
  proved the token, not the sound.
- **The other five sprint 4 wave 1 device items** listed in the handoff.
- **A `preview` or `production` build.** Only `development` has been built.

## Corrections made to the record

- CB-031's row claimed "no DND detection or guidance". Both existed already from
  CB-035 (`toDoNotDisturbState`, `doNotDisturbRow`). Only the `bypassDnd` request
  was missing. Row corrected.
- CB-027's row is marked part done, not done: no `eas build` had been run when
  the config landed, so its "Done when" was unobserved at that point. It is now
  observed for `development` only.
- During this session I asserted "the backend received zero requests" from an
  empty log. That was wrong: a control test (curl the API, watch the log not
  grow) showed this backend logs events, not requests. The database was the
  correct evidence and showed both calls had landed. Check what a log actually
  records before reading silence as absence.

## Environment findings

Neither of these is a defect in the project; both cost time and are now in the
handoff gotchas.

- **The `Pixel_7` AVD renders a black screen.** Its log shows
  `Failed to load opengl32sw (The specified module could not be found.)` — the
  emulator's software-OpenGL library is missing on this machine, and GPU
  passthrough on the host's Intel UHD Graphics does not work. A new AVD booted
  with `-gpu swiftshader_indirect` renders correctly.
- **A locked Android device cannot start an app.** `monkey` and
  `cmd package resolve-activity` both report "no activities found" while
  `dumpsys package` simultaneously shows the MAIN/LAUNCHER filter registered.
  That contradiction means the lockscreen, not a broken install. `dumpsys package`
  showing `ceDataInode=0` is the corroborating signal. Unlock before launching.

`Pixel_7` was deliberately not wiped: it is shared with another project.
