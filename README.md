# LoanPilot

AI mortgage loan assistant for loan officers who live in **Follow Up Boss**, **Gmail / Neo Mail**, and their phone.

LoanPilot answers **lead** emails and texts when you cannot — it skips operations/title/UW senders, drafts a safe reply (or sends when you turn drafts off), creates **Follow Up Boss tasks + notes**, and holds **Google Calendar** call slots when someone asks to talk.

The booking calendar from CallPilot remains under Booking / My week / Team for client appointments.

## What it does

| Channel | Behavior |
|---|---|
| **Gmail** | Scheduled sweep every 5 minutes; draft or send lead replies |
| **Neo Mail** | Forward Neo → Gmail (recommended) or configure IMAP env vars |
| **iPhone messages** | Via **Quo** (OpenPhone) business SMS — works in the Quo iPhone app. Apple iMessage has no public API. |
| **Follow Up Boss** | Match sender → person; create Follow Up / Appointment tasks; log notes |
| **Google Calendar** | List the next 7 days and hold a 30-minute call block when the lead asks to schedule |
| **Google Tasks** | List and create tasks (falls back to the calendar token when it includes the tasks scope) |

**Lead-only rule:** ops domains, `noreply`/`underwriting`/`title` style addresses, and FUB vendor/agent stages are never auto-answered. Sensitive topics (wire instructions, SSN, denials, attorneys, rate locks) escalate to a human task instead of a reply.

## Stack

- React 19 + TypeScript + Vite
- Netlify Functions (scheduled inbox + SMS webhook + assistant API)
- Netlify AI Gateway with **Grok (xAI)** via OpenRouter (OpenAI fallback available)
- Netlify Blobs for settings + activity
- Vitest

## Connect Google Calendar (fix)

Demo mode used to block Google even when a token was set. That is fixed. Live sync uses OAuth:

1. Google Cloud Console → create OAuth **Web** client  
2. Enable **Calendar API** + **Tasks API**  
3. Redirect URI: `https://YOUR_DOMAIN/api/google/callback` (local: `http://localhost:5173/api/google/callback`)  
4. Set `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` on Netlify (and optionally `GOOGLE_REDIRECT_URI`)  
5. Open **Hub** → **Connect Google Calendar**

Tokens refresh automatically and are stored in Netlify Blobs. The old Settings page toggle only flipped a local demo switch — it never talked to Google.

## AI model (Grok)

LoanPilot defaults to **Grok 4.5** (`x-ai/grok-4.5`) for drafting lead replies. Netlify AI Gateway routes xAI models through OpenRouter after your first production deploy — no separate xAI key.

In **Assistant settings** you can switch between:
- **Grok (xAI)** — `x-ai/grok-4.5` or `~x-ai/grok-latest`
- **OpenAI** — `gpt-4o-mini` / `gpt-4o`

Override with env: `ASSISTANT_MODEL=x-ai/grok-4.5`
## Run locally

```bash
npm install
npm run dev        # http://localhost:5173 — Netlify plugin serves /api/*
npm test
npm run typecheck
npm run build
```

Demo mode is on by default (`ASSISTANT_DEMO_MODE=true` or missing FUB key). Use **Assistant → Run inbox sweep** or the scenario buttons to see lead vs ops behavior without credentials.

## Configure for production (Netlify)

Set environment variables (Site settings → Environment variables):

```
FOLLOW_UP_BOSS_API_KEY=
FOLLOW_UP_BOSS_USER_ID=
FOLLOW_UP_BOSS_ASSIGNED_TO=

GMAIL_ACCESS_TOKEN=          # OAuth access token for the LO inbox
GOOGLE_CALENDAR_ACCESS_TOKEN=
GOOGLE_CALENDAR_ID=primary
GOOGLE_TASKS_ACCESS_TOKEN=
GOOGLE_TASKS_LIST_ID=@default

LOANPILOT_API_KEY=            # Bearer token for /api/v1 (demo mode also accepts demo-key)

QUO_API_KEY=
QUO_FROM_NUMBER=+1…          # Your Quo inbox number
QUO_WEBHOOK_SECRET=          # Optional; protect POST /api/webhooks/sms

NEO_ENABLED=true
NEO_IMAP_HOST=               # Optional if Neo forwards to Gmail
NEO_IMAP_USER=
NEO_IMAP_PASSWORD=

ASSISTANT_DEMO_MODE=false
ASSISTANT_MODEL=x-ai/grok-4.5
```

After the first production deploy, enable Netlify AI Gateway. Grok is served via OpenRouter (`OPENROUTER_*` vars are auto-injected — do not set your own provider keys if you want gateway routing).
Point Quo’s inbound message webhook to `https://<your-site>/api/webhooks/sms`.

## App routes

| Path | Purpose |
|---|---|
| `/hub` | Home desk: calendar, Google + FUB tasks, assistant activity, quick actions |
| `/assistant` | Activity feed, inbox sweep, reply previews |
| `/assistant/settings` | Auto-reply, draft-only, channels, voice, env checklist |
| `/week`, `/book`, `/settings` | Appointment booking calendar (CallPilot) |
| `/team` | Team calendars (still available; not in the primary nav) |

## Hub API (app)

Used by the Hub screen. Same JSON envelope as the public API: `{ "ok": true, "data": ... }`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/hub/summary` | Events (7 days), Google + FUB tasks, recent activity, counts |
| POST | `/api/hub/tasks` | Create a Google Task and/or Follow Up Boss task |
| POST | `/api/hub/events` | Create a calendar event, or hold the next morning slot when `leadName` is sent without times |

```json
{ "title": "Send checklist", "source": "both", "due": "2026-09-26", "personId": 1001 }
```

```json
{ "summary": "Call: Alex Buyer", "startIso": "2026-09-26T14:00:00.000Z", "endIso": "2026-09-26T14:30:00.000Z" }
```

## Public API (`/api/v1`)

For other software. Send `Authorization: Bearer <LOANPILOT_API_KEY>` or `X-Api-Key`. A missing or wrong key returns `401` `{ "ok": false, "error": "Unauthorized" }`.

Demo mode (`ASSISTANT_DEMO_MODE` is not `false`, or `FOLLOW_UP_BOSS_API_KEY` is unset) also accepts `demo-key`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/health` | Service, demo flag, and the configured reply model (Grok by default) |
| GET | `/api/v1/activity` | Recent assistant activity (`?limit=40`) |
| GET | `/api/v1/calendar/events` | Upcoming events (`?days=7`) |
| POST | `/api/v1/calendar/events` | Create an event |
| GET | `/api/v1/tasks` | Open Google Tasks and Follow Up Boss tasks |
| POST | `/api/v1/tasks` | Create a task (`source`: `google`, `fub`, or `both`) |
| POST | `/api/v1/messages/preview` | Dry-run a lead reply. Always draft-only — nothing is sent |

```bash
curl -s -H "Authorization: Bearer demo-key" https://<your-site>/api/v1/health
curl -s -H "X-Api-Key: demo-key" https://<your-site>/api/v1/tasks
curl -s -H "Authorization: Bearer demo-key" -H "Content-Type: application/json" \
  -d '{"body":"What documents do I need for pre-approval?","fromEmail":"alex.buyer@gmail.com"}' \
  https://<your-site>/api/v1/messages/preview
```

## Project layout

| Path | What |
|---|---|
| `netlify/functions/_shared/` | Classify, AI reply, FUB, Gmail, Neo, Quo, Calendar, pipeline |
| `netlify/functions/process-inbox.ts` | Cron every 5 minutes |
| `netlify/functions/sms-webhook.ts` | Quo inbound SMS |
| `netlify/functions/assistant.ts` | `/api/assistant/:action` |
| `netlify/functions/hub.ts` | `/api/hub/:action` |
| `netlify/functions/public-api.ts` | `/api/v1/*` (API key) |
| `src/screens/HubPage.tsx` | Loan officer hub |
| `src/screens/AssistantPage.tsx` | LO assistant |
| `src/screens/AssistantSettingsPage.tsx` | Assistant controls |

## Safety defaults

- **Draft only** is on — Gmail drafts are created until you disable it
- **Lead only** is on — ops senders are skipped
- No binding rates, approvals, wire instructions, or SSNs in auto-replies
- Unknown senders escalate for human review when lead-only is enabled
