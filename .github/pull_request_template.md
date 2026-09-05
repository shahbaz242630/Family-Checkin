## What this PR does

<!-- One paragraph a non-technical reviewer can understand. -->

## Why

<!-- Which BRD section, handoff item, or bug does this address? -->

## How to verify

<!-- Exact commands or clicks, e.g. `npm run verify`, or "open the Checks tab below; all must be green". -->

## Checklist

- [ ] Tests added or updated and `npm test` passes
- [ ] `npm run lint`, `npm run typecheck`, `npm run build` pass
- [ ] No secrets, real phone numbers, or real credentials in any file
- [ ] Database changes ship as a Prisma migration (and RLS policy if a new table is user-readable)
- [ ] Dependency audit allowlist (`security/dependency-audit-allowlist.json`) updated only with a reason and expiry

## Security considerations

<!-- Anything touching auth, RLS, receiver PII, provider webhooks, cron secret, or CI? What could go wrong? -->

## Known limitations

<!-- What this PR deliberately does not do. -->
