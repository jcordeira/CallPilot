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
| **Google Calendar** | Hold a 30-minute call block when the lead asks to schedule |

**Lead-only rule:** ops domains, `noreply`/`underwriting`/`title` style addresses, and FUB vendor/agent stages are never auto-answered. Sensitive topics (wire instructions, SSN, denials, attorneys, rate locks) escalate to a human task instead of a reply.

## Stack

- React 19 + TypeScript + Vite
- Netlify Functions (scheduled inbox + SMS webhook + assistant API)
- Netlify AI Gateway (OpenAI SDK) with a deterministic demo fallback
- Netlify Blobs for settings + activity
- Vitest

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

QUO_API_KEY=
QUO_FROM_NUMBER=+1…          # Your Quo inbox number
QUO_WEBHOOK_SECRET=          # Optional; protect POST /api/webhooks/sms

NEO_ENABLED=true
NEO_IMAP_HOST=               # Optional if Neo forwards to Gmail
NEO_IMAP_USER=
NEO_IMAP_PASSWORD=

ASSISTANT_DEMO_MODE=false
ASSISTANT_MODEL=gpt-4o-mini
```

After the first production deploy, enable Netlify AI Gateway so the OpenAI SDK is auto-authenticated (do not set your own `OPENAI_API_KEY` if you want the gateway).

Point Quo’s inbound message webhook to `https://<your-site>/api/webhooks/sms`.

## App routes

| Path | Purpose |
|---|---|
| `/assistant` | Activity feed, inbox sweep, reply previews |
| `/assistant/settings` | Auto-reply, draft-only, channels, voice, env checklist |
| `/book`, `/week`, `/team`, `/settings` | Appointment booking calendar (CallPilot) |

## Project layout

| Path | What |
|---|---|
| `netlify/functions/_shared/` | Classify, AI reply, FUB, Gmail, Neo, Quo, Calendar, pipeline |
| `netlify/functions/process-inbox.ts` | Cron every 5 minutes |
| `netlify/functions/sms-webhook.ts` | Quo inbound SMS |
| `netlify/functions/assistant.ts` | `/api/assistant/:action` |
| `src/screens/AssistantPage.tsx` | LO dashboard |
| `src/screens/AssistantSettingsPage.tsx` | Assistant controls |

## Safety defaults

- **Draft only** is on — Gmail drafts are created until you disable it
- **Lead only** is on — ops senders are skipped
- No binding rates, approvals, wire instructions, or SSNs in auto-replies
- Unknown senders escalate for human review when lead-only is enabled
