# Placement Intelligence Platform

Personal **AI Placement Intelligence** system for the VIT Training & Placement
portal (`tpo.vierp.in`). It monitors the college T&P backend, detects new or
changed placement opportunities, extracts structured information, compares
opportunities against a student profile, and notifies — **without keeping a
browser open**.

```
College T&P API  →  Monitor (cron)  →  Normalize  →  PostgreSQL
      →  change detection (SHA-256)  →  attachments + PDF text
      →  AI structured extraction  →  deterministic eligibility
      →  email digest  →  Next.js dashboard
```

The product is **MONITOR + UNDERSTAND + MATCH + NOTIFY** — not a chatbot.

## Setup

Requirements: Node 24+, PostgreSQL 16 (`brew install postgresql@16` works).

```bash
npm install                      # installs backend + dashboard workspace
cp .env.example .env             # then edit (see Security below)
npx prisma migrate deploy        # create schema

npm run login                    # first-party login (device key + ALTCHA + ECDSA signing)
npm run sync:once                # one-shot sync: T&P API → PostgreSQL → log
npm run monitor                  # long-running: sync every SYNC_INTERVAL_MINUTES

npm run profile -- set cgpa=8.2 branch="Computer Science" graduationYear=2028
npm run eligibility              # deterministic fit report vs your profile
npm run dashboard:dev            # Next.js dashboard → http://localhost:3300
```

Useful dev commands:

```bash
npm run seed:fixtures            # seed DB from saved live fixtures (offline dev)
npm test                         # 100 tests, no network needed
npm run dashboard:build
```

## Safety and security model

This system touches a **real college server**. The guardrails are not optional:

- Live API calls are **opt-in**: set `ALLOW_LIVE_API=true` in `.env` explicitly.
- Hard per-run budget (`MAX_API_CALLS_PER_RUN`) plus a daily cap, enforced in code.
- Minimum request spacing (`API_MIN_REQUEST_INTERVAL_MS`, default 1s).
- Every live request is appended to `var/api-audit.log` (metadata only).
- `DRY_RUN=true` (default) suppresses all external side effects such as emails.

**Secrets never leave the machine.** `.env` and `var/` are gitignored; the HAR
file and captures are never committed. Auth is fully first-party: we generate
our own ECDSA P-256 device key, solve the ALTCHA proof-of-work, and sign every
request exactly like the browser does — no credential bypass of any kind.
See `docs/tpo-api-analysis.md` for the complete derived API contract.

## Architecture

Modular monolith (`src/`):

| Module            | Responsibility |
|-------------------|----------------|
| `config/`         | Zod-validated env config |
| `tpo/`            | API client, session, crypto, headers, audit (external system boundary — no business logic) |
| `placement/`      | Domain model, normalization, canonical hashing |
| `sync/`           | Deterministic sync engine (idempotent, per-item error isolation) |
| `scheduler/`      | Cron monitor with overlap guard |
| `documents/`      | Attachment download + PDF text extraction |
| `ai/`             | LLM structured extraction + deterministic anti-hallucination verification |
| `eligibility/`    | Pure rules engine — no LLM involved |
| `notifications/`  | `NotificationChannel` interface, email digest (DRY_RUN-aware) |
| `scripts/`        | CLI entry points (`login`, `probe`, `sync:once`, `monitor`, `profile`, `eligibility`, `seed:fixtures`) |
| `apps/dashboard/` | Next.js 15 + Tailwind dashboard (reads the same PostgreSQL directly) |

Key engineering decisions:

1. **Identity = TPO offering id**, never the company name (same company
   appears in many drives).
2. **Change detection is deterministic**: canonical SHA-256 of the sorted
   projection of an opportunity; `PlacementChange` rows record field-level diffs.
3. **The LLM never decides eligibility and never invents criteria.** AI output
   is Zod-validated and every reported number must verifiably occur in the
   source text, or it is removed (`src/ai/verify.ts`).
4. **AI is optional**: leave `AI_API_KEY` empty and the whole pipeline stays
   deterministic.
5. **Signed S3 URLs are never persisted** — only object keys, local files, hashes.

## Data model

`User → StudentProfile`, `PlacementOpportunity → PlacementRequirement /
PlacementAttachment / PlacementChange`, `SyncRun` (observability for every run).

## Monitoring pipeline

```
npm run monitor
```

- Syncs immediately at startup, then every `SYNC_INTERVAL_MINUTES` (default 30).
- Skips a tick if the previous run is still in flight (never queues).
- A failed run is logged and retried on the next tick; one broken opportunity
  never aborts the run.
- Sends the email digest for new/changed opportunities (per DRY_RUN config).
- Graceful SIGINT/SIGTERM shutdown.

## Running as a background service (launchd)

The monitor runs as a macOS LaunchAgent — **independent of any terminal**. It
starts at login, keeps running in the background, relaunches automatically if
it crashes, and polls the portal every `SYNC_INTERVAL_MINUTES`.

```bash
mkdir -p var/logs
cp deploy/placement-monitor.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.sarthakmarkad.placement-monitor.plist
```

- Logs: `tail -f var/logs/launchd.out.log` (errors in `launchd.err.log`)
- Stop: `launchctl bootout gui/$(id -u)/com.sarthakmarkad.placement-monitor`
- Start again: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.sarthakmarkad.placement-monitor.plist`
- Restart after refreshing the portal session: `npm run login` then
  `launchctl kickstart -k gui/$(id -u)/com.sarthakmarkad.placement-monitor`

The plist pins the project as the working directory (`.env` and `var/` are
resolved relative to it) and restarts the job on non-zero exit, throttled to
one restart per minute so a failing session cannot spin against the API.
All guardrails (per-run budget, daily cap, 1s spacing, audit log) apply to the
background job exactly as to manual runs.

## Notifications (email digest)

After every sync tick the monitor emails a digest of new/changed
opportunities — field-level diffs, deadlines, eligibility at a glance.
Configure in `.env`:

```
NOTIFY_EMAIL_TO=you@example.com   # recipient (channel disabled while empty)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com           # sending account
SMTP_PASS=<app password>          # app password, never commit
DRY_RUN=false                     # actually send (default true = log only)
```

With `DRY_RUN=true` the digest is logged instead of sent, so wiring is
verifiable without side effects. The same change feed is always visible in the
dashboard at `/changes`.

## V1 definition of done

- [x] Backend starts, DB connects, T&P client works (live-verified)
- [x] Placement list + details fetched and normalized
- [x] Stored in PostgreSQL; duplicates impossible (idempotent sync)
- [x] Change detection with field-level diffs
- [x] Scheduled sync with overlap guard
- [x] Attachments + PDF text + (optional) AI extraction, persisted with provenance
- [x] Deterministic eligibility engine + profile
- [x] Email notifications behind a channel interface
- [x] Next.js dashboard (overview, companies, eligible-for-you, deadlines, changes, profile, settings)
- [x] Errors logged (pino, redacted) + `SyncRun` observability
- [x] 100 offline tests; secrets and HAR never committed
