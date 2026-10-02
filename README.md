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

Tokens refresh automatically and are stored in Netlify Blobs. Connect requests `https://www.googleapis.com/auth/calendar` (full calendar, including event writes) and `https://www.googleapis.com/auth/calendar.events`. A token that only has `calendar.readonly` or `calendar.events.readonly` cannot add guests. The Hub shows **Reconnect Google** when the saved grant is missing a write scope. A token that already includes the full `calendar` scope does not need a reconnect.

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

## WhatsApp auto-reply

Off until `WHATSAPP_AUTOREPLY_ENABLED=true`. When a contact messages Joseph in a 1:1 WhatsApp chat and he does not reply within `WHATSAPP_AUTOREPLY_WAIT_MINUTES` (default 5), LoanPilot sends that contact a WhatsApp text through Kapso and texts Joseph’s cell (`FUB_LO_PHONE`) from his Quo line.

The timer is a Netlify scheduled function every minute (`whatsapp-autoreply`). Kapso’s `whatsapp.conversation.inactive` event is accepted as a backup signal, and the send still waits for the same timer. A reply from the WhatsApp Business app arrives as an echo with `message.kapso.origin` `business_app` and `direction` `outbound`; any outbound message to that contact after the inbound one cancels the auto-reply, except messages LoanPilot sent through the API (`origin: cloud_api` matching the auto-reply, or a stored message id). Group chats (`group_id`, `@g.us`), status events (`whatsapp.message.delivered` / `read` / `failed`, message type `status`), reactions, history sync, and passive messages are ignored. One auto-reply per contact per `WHATSAPP_AUTOREPLY_COOLDOWN_HOURS` (default 4). Messages older than `WHATSAPP_AUTOREPLY_MAX_AGE_HOURS` (default 24) are not armed, so a late history import does not blast people. State is in the `loanpilot-whatsapp` Netlify Blobs store. `WHATSAPP_AUTOREPLY_DRY_RUN=true` and Hub → Preview WhatsApp log the digest and do not send. `POST /api/hub/whatsapp` only previews.

**Kapso.** Connect `+15169969070` with Meta coexistence so Joseph keeps the WhatsApp Business app ([coexistence](https://docs.kapso.ai/docs/how-to/whatsapp/coexistence-troubleshooting)). Send with `POST https://api.kapso.ai/meta/whatsapp/v24.0/{KAPSO_PHONE_NUMBER_ID}/messages`, header `X-API-Key: KAPSO_API_KEY`, body `messaging_product`, `to` (digits), `type: text`, `text.body` ([send text](https://docs.kapso.ai/docs/whatsapp/send-messages/text)). `KAPSO_PHONE_NUMBER_ID` is the Meta phone number id from Kapso → WhatsApp → Phone numbers, not the E.164 number. API keys are under Integrations → API keys.

**Webhook.** `POST /api/webhooks/whatsapp`. Kapso signs the raw body with HMAC-SHA256 and puts the hex digest in `X-Webhook-Signature` ([security](https://docs.kapso.ai/docs/platform/webhooks/security)). Set that secret as `KAPSO_WEBHOOK_SECRET`. A missing or wrong signature returns 401. Register a Kapso (not Meta-raw) phone-number webhook:

```bash
curl -X POST "https://api.kapso.ai/platform/v1/whatsapp/phone_numbers/$KAPSO_PHONE_NUMBER_ID/webhooks" \
  -H "X-API-Key: $KAPSO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "whatsapp_webhook": {
      "kind": "kapso",
      "url": "https://<your-site>/api/webhooks/whatsapp",
      "events": ["whatsapp.message.received", "whatsapp.message.sent"],
      "secret_key": "<KAPSO_WEBHOOK_SECRET>"
    }
  }'
```

Subscribe to `whatsapp.message.received` and `whatsapp.message.sent`. `whatsapp.message.sent` is what carries Business-app echoes. Do not rely on `whatsapp.conversation.inactive` for the timer; the minute cron is the source of truth. Optional inactive subscription is harmless.

| Env | Default | Purpose |
|---|---|---|
| `WHATSAPP_AUTOREPLY_ENABLED` | `false` | Master switch |
| `WHATSAPP_AUTOREPLY_DRY_RUN` | `false` | Log the reply and the Quo alert, send nothing |
| `WHATSAPP_AUTOREPLY_WAIT_MINUTES` | `5` | Silence before the auto-reply |
| `WHATSAPP_AUTOREPLY_COOLDOWN_HOURS` | `4` | Minimum gap between auto-replies to one contact |
| `WHATSAPP_AUTOREPLY_MAX_AGE_HOURS` | `24` | Ignore inbound messages older than this |
| `WHATSAPP_AUTOREPLY_TEXT` | Joseph’s away message | WhatsApp text sent to the contact |
| `KAPSO_API_KEY` | | Project API key (`X-API-Key`) |
| `KAPSO_PHONE_NUMBER_ID` | | Meta phone number id for Joseph’s line |
| `KAPSO_WEBHOOK_SECRET` | | HMAC secret; required or the webhook returns 401 |
| `KAPSO_API_BASE` | `https://api.kapso.ai/meta/whatsapp/v24.0` | Optional proxy base |
| `FUB_LO_PHONE` | | Joseph’s cell for the Quo alert |

Open tasks on the Hub are Joseph’s and Frank’s (`FUB_LO_USER_ID`, `FUB_LOA_USER_ID`), incomplete, due in a recent window, with person names filled from Follow Up Boss. Set `FUB_LO_USER_ID=1`, `FUB_LOA_USER_ID=16`, and `FOLLOW_UP_BOSS_USER_ID=1` for this account. The first live Hub load (or the 5-minute inbox sweep) deletes sample rows previously stored in Netlify Blobs.

## Calendar guests

Off until `CALENDAR_AUTO_GUEST_ENABLED=true`. Every 15 minutes LoanPilot looks at Joseph’s calendar (`Joseph@teamcordeira.com`, `GOOGLE_CALENDAR_ID` or `primary`) from now through `CALENDAR_AUTO_GUEST_DAYS` (default 60), including events already on the calendar. Frankie Cordeira (`fcordeirajr@cliffcomortgage.com`, FUB user 16) is added with `events.patch` when she is not already a guest. Existing attendees and their responses stay on the event. Nothing else on the event changes. A second run sees her on the attendee list and skips the event.

Included: Google appointment-page bookings titled like `Joe & Emily Cordeira (Client Name)` or whose description starts with `Booked by`, and timed events that name a client and mention call, appt, appointment, consult, refi, purchase, preapproval, or HELOC, or whose title contains a Follow Up Boss lead’s full name. Excluded: all-day events, birthdays, and internal or personal titles such as `Galligan Group / Team Cordeira Weekly Meetings`, `Week Setup`, `Joe Cordeira + Alicia Meeting`, `Heloc steps`, and `Eric / Joe`. Unclear titles are left alone. `CALENDAR_AUTO_GUEST_INCLUDE` and `CALENDAR_AUTO_GUEST_EXCLUDE` are comma-separated.

**Notifications.** The Calendar API’s `sendUpdates` is `all`, `externalOnly`, or `none`. There is no “new guest only” value. Google once fixed a bug so `all` would email only new guests ([issue 323087133](https://issuetracker.google.com/issues/323087133)), and later reports said existing guests still got “this event has been updated.” The default is `CALENDAR_AUTO_GUEST_NOTIFY=ics`: patch with `sendUpdates=none`, then email Frankie an `.ics` invite through `GMAIL_ACCESS_TOKEN` when that token is set. Clients are not re-notified. Gmail is a separate token, not part of the Calendar OAuth scopes, so this path does not ask Joseph to grant Gmail again. If Gmail is not connected she is still added and the Hub says no email went out. Set `CALENDAR_AUTO_GUEST_NOTIFY=all` (or `externalOnly`) to let Google send the invitation instead; existing guests, including the client, may get an update.

Hub → Preview calendar guests lists what would change and does not patch. `POST /api/hub/calendar-guests` is preview-only.

| Env | Default | Purpose |
|---|---|---|
| `CALENDAR_AUTO_GUEST_ENABLED` | `false` | Master switch |
| `CALENDAR_AUTO_GUEST_DRY_RUN` | `false` | Classify and log only |
| `CALENDAR_AUTO_GUEST_EMAILS` | `fcordeirajr@cliffcomortgage.com` | Guests to add |
| `CALENDAR_AUTO_GUEST_DAYS` | `60` | How far ahead to look |
| `CALENDAR_AUTO_GUEST_NOTIFY` | `ics` | `ics`, `all`, or `externalOnly` |
| `CALENDAR_AUTO_GUEST_INCLUDE` | call, appt, appointment, consult, refi, purchase, preapproval, pre-approval, heloc | Title keywords |
| `CALENDAR_AUTO_GUEST_EXCLUDE` | birthday, galligan group, team cordeira weekly, week setup, joe cordeira + alicia, heloc steps, eric / joe | Phrases that block an add |
| `GMAIL_ACCESS_TOKEN` | | Sends the `.ics` when notify is `ics` |

## Command mode

Joseph and his LOAs text the Quo Sales line and LoanPilot acts on it. Off until `COMMAND_MODE_ENABLED=true`. `COMMAND_MODE_DRY_RUN` defaults to true: LoanPilot still texts the sender, prefixed `[preview]`, and does not book, reassign, or text anyone else.

Only these cells are commands. Every other sender, including clients on the same line, is ignored with no reply.

| Phone | Env | Role |
|---|---|---|
| +15169969070 | `FUB_LO_PHONE` | owner (Joseph) |
| +16315126480 | `FUB_LOA_PHONE_16` | team (Frankie) |
| +15165213121 | `FUB_LOA_PHONE_27` | team (Daniel) |

The line is `QUO_FROM_NUMBER` (+15163869773, the Sales inbox). `COMMAND_PREFIX` is empty by default. Set it to `LP ` or `@lp` if you want a prefix on top of the allowlist.

**Parsing.** Tool calls go through the Netlify AI Gateway already used for Grok (`OPENROUTER_API_KEY` / `OPENROUTER_BASE_URL`, model `ASSISTANT_MODEL` or `COMMAND_MODEL`). Add `OPENAI_API_KEY` and `COMMAND_MODEL=gpt-4o-mini` only if you want OpenAI instead. Lead names are matched against Follow Up Boss. Two close matches get a numbered reply; `1` or `2` picks one. Confirmations expire after 15 minutes.

Owner can book, move, and cancel calls (cancel waits for YES), text Frankie or Daniel immediately, draft a client text that waits for YES, ask what's on today, brief a lead, add a note, create a task, assign a lead (YES, then a FUB mention and a text to that LOA), list open slots, and hold calls until a time. Team can ask when Joe is free (free/busy only, no event titles, 9–6 ET Mon–Fri, up to five 30-minute slots), request a booking that texts Joseph for YES/NO, and brief, note, or task a lead.

Booked calls are titled `<Client Name> call <topic>` for 30 minutes in America/New_York. Conflicts are booked and called out. When `CALENDAR_AUTO_GUEST_ENABLED=true`, Frankie is added from `CALENDAR_AUTO_GUEST_EMAILS` on that new event. `hold calls till 2` sets a busy flag the WhatsApp auto-reply honors (it sends immediately and adds the hold time).

**Google.** The Hub connect button already requests `https://www.googleapis.com/auth/calendar`, which covers event writes and free/busy. Joseph does not need to reconnect for command mode if that grant is the one on file. A token that only has `calendar.events` can book but cannot read free/busy; the Hub then shows Reconnect Google.

**Quo webhook.** `POST /api/webhooks/quo`. A missing or bad signature returns 401. Set `QUO_WEBHOOK_SECRET` to the key Quo returns (`whsec_...`) or the base64 secret from the webhook details page. Current deliveries sign `{webhook-id}.{webhook-timestamp}.{raw body}` (HMAC-SHA256, base64, header `webhook-signature`). Older UI deliveries use `openphone-signature` (`hmac;1;timestamp;signature` over `timestamp.rawBody`). Both are accepted. Message id is the idempotency key.

Register it on the Sales number only.

API (version `2026-03-30`):

```bash
# `id` is the phone number id (PNxxxx). `phoneNumber` is the E.164 line.
curl -s "https://api.quo.com/phone-numbers?phoneNumber=%2B15163869773" \
  -H "Authorization: $QUO_API_KEY" \
  -H "Quo-Api-Version: 2026-03-30"

curl -s "https://api.quo.com/webhooks" \
  -X POST \
  -H "Authorization: $QUO_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Quo-Api-Version: 2026-03-30" \
  -d '{
    "url": "https://<your-site>/api/webhooks/quo",
    "events": ["message.received"],
    "resourceIds": ["<PNxxxx from the list above>"],
    "label": "LoanPilot command mode"
  }'
```

Save the response `key` as `QUO_WEBHOOK_SECRET`.

UI: Quo → Settings → Webhooks → Add webhook → URL `https://<your-site>/api/webhooks/quo` → event `message.received` → limit it to the Sales number +15163869773 → save → open the webhook → Reveal signing secret → paste that into `QUO_WEBHOOK_SECRET`.

The Hub Command mode card lists recent commands. It does not send anything.

| Env | Default | Purpose |
|---|---|---|
| `COMMAND_MODE_ENABLED` | `false` | Master switch |
| `COMMAND_MODE_DRY_RUN` | `true` | Reply with `[preview]` and skip side effects |
| `COMMAND_PREFIX` | empty | Optional prefix such as `LP ` |
| `COMMAND_TIMEZONE` | `America/New_York` | Bookings and slots |
| `COMMAND_HOURS_START` / `COMMAND_HOURS_END` | `9` / `18` | Working hours for open slots |
| `COMMAND_WORK_DAYS` | `1,2,3,4,5` | Mon–Fri |
| `COMMAND_CONFIRM_MINUTES` | `15` | YES / numbered-choice expiry |
| `COMMAND_MODEL` | `ASSISTANT_MODEL` | Tool-calling model |
| `QUO_FROM_NUMBER` | | Sales line, +15163869773 |
| `QUO_WEBHOOK_SECRET` | | Required. Unsigned posts are 401 |

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
| `netlify/functions/calendar-guest.ts` | Cron every 15 minutes — add Frankie to client appointments (off until enabled) |
| `netlify/functions/whatsapp-autoreply.ts` | Cron every minute — WhatsApp away reply (off until enabled) |
| `netlify/functions/whatsapp-webhook.ts` | Kapso webhook `/api/webhooks/whatsapp` |
| `netlify/functions/quo-webhook.ts` | Quo command mode `/api/webhooks/quo` |
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
