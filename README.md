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
| **Follow Up Boss** | Match sender → person; score lead heat 0–100; create Call / Text / Follow Up tasks for Joseph (LO) or Frank (LOA); log notes |
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
FUB_LO_NAME=Joseph Cordeira
FUB_LOA_NAME=Frank Cordeira
FUB_LO_USER_ID=
FUB_LOA_USER_ID=
FUB_WEBHOOK_VERIFY=
FUB_WEBHOOK_SECRET=

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

Point Follow Up Boss webhooks (`peopleCreated`, `peopleUpdated`, `peopleStageUpdated`, `notesCreated`, `emailsCreated`, `textMessagesCreated`) to `https://<your-site>/api/webhooks/fub`. LoanPilot rescores that person and, when heat crosses a band, writes a note plus a task. An optional custom field named **LoanPilot Score** is stored as `customLoanPilotScore`. If that field does not exist yet, scoring still saves the note and the task.

Also subscribe **`callsCreated`** and **`callsUpdated`** on that same URL so missed inbound calls are caught as they are logged. Overdue tasks have no “became overdue” webhook, so the 15-minute `loa-reminders` function polls them. `textMessagesCreated` is already on the list and is used for unanswered texts. Do not subscribe `tasksCreated` / `tasksUpdated` — scoring ignores task events so LoanPilot notes do not loop.

## LOA and LO miss reminders

Off until `LOA_REMINDERS_ENABLED=true`. `LOA_REMINDERS_DRY_RUN=true` (or Hub → Preview reminders) builds the same digest and does not post notes or send SMS.

| Who | What they are reminded about | How |
|---|---|---|
| Frankie (`FUB_LOA_USER_IDS`, id 16) and Daniel (id 27) | Overdue FUB tasks assigned to them, unanswered inbound texts on leads assigned to them, missed inbound calls (`No Answer`, `Left Message`, `Busy`, voicemail) on those leads with no later outbound call or text | One FUB note per lead that @mentions them, plus one SMS digest |
| Joseph (id 1) | Overdue FUB tasks assigned to him, missed inbound calls on leads assigned to him, overdue Google Tasks | One SMS digest. No FUB mention note |

Scoring is unchanged: hot → Joseph Call, warm → Frank Text, cool → Frank Follow Up, cold → note only.

**Mentions.** `POST /v1/notes` documents only `personId`, `subject`, `body`, and `isHtml` ([notes reference](https://docs.followupboss.com/reference/notes-post)). The [Team Mentions](https://help.followupboss.com/hc/en-us/articles/4402379946007-Team-Mentions) article says typing `@` in the yellow note emails that person. Plain `@Name` does not. A published FUB integration smoke-tested the payload the FUB app sends (`mentions` is undocumented but accepted):

```json
{
  "personId": 123,
  "subject": "LoanPilot reminder",
  "isHtml": true,
  "mentions": { "user": [16] },
  "body": "<p><span data-user-id=\"16\">Frankie Cordeira</span> LoanPilot reminder — this lead still needs you:</p><ul><li>Overdue task: Follow up</li></ul>"
}
```

All three of `isHtml`, the `data-user-id` span, and `mentions.user` are required. The span text is the display name, not `@Name`. `mentions.user` alone can add the person as a collaborator and does not email them. Mentioning an agent also adds them as a collaborator.

**SMS.** Outbound texts use the existing Quo / OpenPhone client (`QUO_API_KEY`, `QUO_FROM_NUMBER`, optional `QUO_API_BASE`). `QUO_FROM_NUMBER` is Joseph’s Quo inbox — the From line — not his cell. In Quo open Settings → Phone numbers, or `GET https://api.openphone.com/v1/phone-numbers` with `Authorization: $QUO_API_KEY` and copy `number`. If Quo is not configured, notes still post and SMS is skipped. Nothing is sent while `ASSISTANT_DEMO_MODE=true`.

**Recipients** (env only — see `.env.example`; these are not hardcoded):

| Env | Who |
|---|---|
| `FUB_LO_PHONE` | Joseph’s mobile |
| `FUB_LOA_PHONE_16` | Frankie’s mobile |
| `FUB_LOA_PHONE_27` | Daniel’s mobile |
| `FUB_LOA_NAME_16` / `FUB_LOA_NAME_27` | Names inside the mention chip |
| `FUB_LOA_USER_IDS` | `16,27` (the single `FUB_LOA_USER_ID` is still included) |

If a phone env is empty, LoanPilot tries `GET /users/:id` (`phone`) once per run.

**Dedupe and backlog.** The first enabled run stores a watermark in the `loanpilot-reminders` Netlify Blobs store at `now - LOA_REMINDER_LOOKBACK_HOURS` (default 24). An item is eligible only when it became missed at or after both that watermark and the current lookback. Raising the lookback later cannot reach Frankie’s older open tasks. Each task, text, call, and Google Task id is reminded at most once. An LOA with many leads gets at most `LOA_REMINDER_MAX_NOTES` mention notes per run (default 15); the rest wait for the next 15-minute run. SMS is one digest per person per run. Dry runs do not consume the dedupe keys.

**Google.** There is no Google missed-call source. Joseph’s digest includes overdue Google Tasks from the connected account (`Joseph@teamcordeira.com` via the existing OAuth token). Past calendar events are not treated as missed calls.

**Hub.** `GET /api/hub/reminders` shows seats, whether SMS is configured, and recent deliveries (no phone numbers). `POST /api/hub/reminders` always previews and does not post notes or send SMS. The Hub has the same panel.

| Env | Default | Purpose |
|---|---|---|
| `LOA_REMINDERS_ENABLED` | `false` | Master switch |
| `LOA_REMINDERS_DRY_RUN` | `false` | Compute and log only |
| `LOA_REMINDER_LOOKBACK_HOURS` | `24` | How far back a new miss counts |
| `LOA_REMINDER_TEXT_WINDOW_MINUTES` | `120` | How long an inbound text may sit unanswered |
| `LOA_REMINDER_CALL_GRACE_MINUTES` | `15` | Ignore unlabeled inbound calls newer than this |
| `LOA_REMINDER_TIMEZONE` | `America/New_York` | When a date-only task becomes overdue |
| `LOA_REMINDER_MAX_NOTES` | `15` | Mention notes per person per run |
| `LOA_REMINDER_MAX_PEOPLE` | `8` | Recent assigned people scanned per seat per run |
| `FUB_PERSON_URL_BASE` | `https://teamcordeira.followupboss.com/2/people/view` | Link in the SMS |

Signature checks are off until `FUB_WEBHOOK_VERIFY=true` (or `FUB_WEBHOOK_SECRET` is set). When enabled, the `FUB-Signature` header must be the hex HMAC-SHA256 of the base64-encoded raw body, using `FOLLOW_UP_BOSS_SYSTEM_KEY`.

Open tasks on the Hub are Joseph’s and Frank’s (`FUB_LO_USER_ID`, `FUB_LOA_USER_ID`), incomplete, due in a recent window, with person names filled from Follow Up Boss. Set `FUB_LO_USER_ID=1`, `FUB_LOA_USER_ID=16`, and `FOLLOW_UP_BOSS_USER_ID=1` for this account. The first live Hub load (or the 5-minute inbox sweep) deletes sample rows previously stored in Netlify Blobs.

## Lead heat (Joseph and Frank)

Scores run in demo mode with no Follow Up Boss key (sample leads on the Hub). With a key, the hourly `score-leads` function and the FUB webhook rescore open people.

| Score | Band | Task |
|---|---|---|
| 90–100 | Hot now | **Call today** for **Joseph Cordeira** (LO) |
| 70–89 | Warm | **Text within 24–48h** for **Frank Cordeira** (LOA) |
| 40–69 | Cool | **Follow up in 3–7 days** for **Frank Cordeira** (LOA) |
| 0–39 | Cold | Note only — no urgent task |

Signals: inbound email/SMS in the last 24–72 hours, engagement words (pre-approval, rate, docs ready, ready to buy, refinance now), stage, days since last contact, and appointment requests. Vendor, title, and ops contacts are skipped. Escalations (wire instructions, SSN, and the other sensitive topics) always create a same-day call for Joseph.

Google Calendar stays optional. The Hub lead board works when Google is disconnected.

## App routes

| Path | Purpose |
|---|---|
| `/hub` | Home desk: lead heat, calendar, Google + FUB tasks, assistant activity, quick actions |
| `/assistant` | Activity feed, inbox sweep, reply previews |
| `/assistant/settings` | Auto-reply, draft-only, channels, voice, env checklist |
| `/week`, `/book`, `/settings` | Appointment booking calendar (CallPilot) |
| `/team` | Team calendars (still available; not in the primary nav) |

## Hub API (app)

Used by the Hub screen. Same JSON envelope as the public API: `{ "ok": true, "data": ... }`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/hub/summary` | Events (7 days), Google + FUB tasks, scored leads, recent activity, counts |
| GET | `/api/hub/leads` | Lead heat board: score, band, reasons, assignee, due |
| POST | `/api/hub/score` | Rescore open leads and create Joseph/Frank tasks when the band changes |
| POST | `/api/hub/tasks` | Create a Google Task and/or Follow Up Boss task (calls go to Joseph, other follow-ups to Frank) |
| POST | `/api/hub/events` | Create a calendar event, or hold the next morning slot when `leadName` is sent without times |

```json
{ "title": "Send checklist", "source": "both", "due": "2026-09-26", "personId": 12345 }
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
| `netlify/functions/score-leads.ts` | Cron hourly — rescore FUB leads |
| `netlify/functions/loa-reminders.ts` | Cron every 15 minutes — LOA/LO miss reminders (off until enabled) |
| `netlify/functions/sms-webhook.ts` | Quo inbound SMS |
| `netlify/functions/fub-webhook.ts` | Follow Up Boss webhook `/api/webhooks/fub` |
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
