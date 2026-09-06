# <Feature name> — feature handoff

<!--
Copy to docs/handoffs/<feature-slug>.md. Keep it under ~120 lines.
Update it in the same PR as any change to the feature.
Record only what a new session cannot get from the code in two minutes:
what is wired, what is not, how to poke it, what must not be broken.
No session logs here; those belong in docs/audits/<date>/ or the PR description.
-->

Status: Built | Partially built | Stubbed · Last verified: YYYY-MM-DD (acceptance run | specs | emulator)
BRD: <section refs> · Open backlog: <CB ids, or "none">

## What it does

- Three to six bullets. User-visible behaviour, present tense.

## Where it lives

| Layer   | Paths                                    |
| ------- | ---------------------------------------- |
| Backend | `apps/backend/src/modules/<module>/`     |
| Mobile  | `apps/mobile/src/app/<route>`            |
| Data    | tables, migrations                       |
| Tests   | the spec files that prove the behaviour  |

## Routes and contracts

- `METHOD /path` — who may call it, what it does. Only routes this feature owns.

## How to exercise it locally (fake mode)

- Concrete steps or commands. Assume the setup in `docs/EMULATOR_RUNBOOK.md`.

## Invariants — do not break

- Rules the code relies on that a refactor could silently violate.

## Known gaps

- CB-xxx — one line each, from `docs/COMPLETION_BACKLOG.md`.

## History

- Archived handoff: `docs/archive/PROJECT_HANDOFF_2026-04-26_to_2026-09-06.md` §N (lines a–b).
- PRs: #n (what).
