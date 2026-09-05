# Security Policy

## Reporting a vulnerability

Please report security issues privately through GitHub's "Report a vulnerability"
feature (Security tab, then Advisories) on this repository. Do not open a public
issue for security reports.

We aim to acknowledge reports within 3 working days.

## Scope

Nearby is a family check-in service that stores receiver contact details and
delivers check-ins over SMS, WhatsApp, and voice. The most valuable reports:

- One account reading or changing another account's receivers, check-ins, or escalations (Supabase RLS or backend authorisation bypass)
- Authentication bypass, including the step-up flow for sensitive actions
- Forged provider webhooks (Twilio signature, WhatsApp shared secret, RevenueCat token)
- Abuse of the operations cron endpoint
- Exposure of receiver PII in logs, audit records, or responses

## How we test

See `docs/SECURITY.md` for the CI gates (secret scanning, dependency audit,
CodeQL, workflow hygiene, RLS invariants) and the local hooks that mirror them.
