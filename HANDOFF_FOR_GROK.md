# LoanPilot — handoff for Grok (other app)

Copy everything below this line into your other Grok Bot. Repo context optional; this doc is enough to continue.

---

## What this product is

**LoanPilot** is an AI mortgage loan-officer assistant for **Joseph Cordeira (LO)** and **Frank Cordeira (LOA)**. It:

1. Lives primarily in **Follow Up Boss** (notes, tasks, lead heat scores)
2. Drafts/replies to **lead** emails (Gmail + Neo) and SMS (Quo / OpenPhone on iPhone) — skips ops/title/UW
3. Uses **Grok (xAI)** as the default reply model via Netlify AI Gateway → OpenRouter
4. Has a central **Hub** UI plus a public REST API for later software connections
5. Optionally connects **Google Calendar + Tasks** (OAuth) — not required for FUB scoring

Repo: `https://github.com/jcordeira/CallPilot`  
Branch: `cursor/mortgage-ai-assistant-84b3`  
PR: `https://github.com/jcordeira/CallPilot/pull/1`  
Stack: React 19 + Vite + Netlify Functions + Netlify Blobs + Vitest

---

## People / routing (hard requirements)

| Role | Name | When they get the task |
|---|---|---|
| LO | **Joseph Cordeira** | Hot leads (score 90–100), same-day Call; also all sensitive escalations |
| LOA | **Frank Cordeira** | Warm (70–89) Text within ~1 day; Cool (40–69) Follow Up in ~5 days |

Env (defaults already match names):

```
FUB_LO_NAME=Joseph Cordeira
FUB_LOA_NAME=Frank Cordeira
FUB_LO_USER_ID=
FUB_LOA_USER_ID=
FOLLOW_UP_BOSS_API_KEY=
ASSISTANT_DEMO_MODE=false
```

Cold (0–39): note only, no urgent task.

---

## Lead heat score (0–100)

Signals: recent inbound email/SMS, engagement keywords (pre-approval, rate, docs, ready to buy/refi), stage, days since last contact, appointment request. Ops/vendor contacts excluded.

On score:
- Write FUB **note** with score + reasons
- Set custom field **`customLoanPilotScore`** if it exists (skip gracefully if not)
- Create FUB **task** with `assignedTo` / `assignedUserId` for Joseph or Frank

Runs via:
- Hourly cron: `netlify/functions/score-leads.ts`
- Webhook: `POST /api/webhooks/fub` (people/notes/email/text — ignore task events to avoid loops)
- Hub: **Rescore leads** → `POST /api/hub/score`, list → `GET /api/hub/leads`

---

## Reply assistant rules

- **Lead only** — never auto-reply to ops/title/underwriting/vendor
- **Draft only by default** — Gmail drafts until trusted
- Escalate (no auto-answer) on: wire instructions, SSN, denials, attorneys, rate locks, etc. → same-day Call for **Joseph**
- Channels: Gmail (poll every 5 min), Neo (forward to Gmail or IMAP), Quo SMS webhook `/api/webhooks/sms`
- AI default model: `x-ai/grok-4.5` (settings can switch to Grok latest or OpenAI)

---

## App routes

| Path | Purpose |
|---|---|
| `/hub` | Central desk: lead heat, calendar/tasks (demo if Google off), activity |
| `/assistant` | Inbox sweep + preview scenarios |
| `/assistant/settings` | Draft/lead-only, Grok model, Google OAuth setup notes |
| `/book`, `/week`, `/settings` | Legacy CallPilot booking calendar |
| `/api/hub/*` | Hub JSON API |
| `/api/assistant/*` | Activity, settings, preview, run |
| `/api/google/*` | OAuth connect/callback/status/disconnect |
| `/api/webhooks/fub` | Follow Up Boss inbound |
| `/api/webhooks/sms` | Quo inbound |
| `/api/v1/*` | Public API (API key; demo accepts `demo-key`) |

---

## Key source files

```
GROK_BUILD_BRIEF.md          # earlier build brief
netlify/functions/_shared/
  leadScore.ts               # pure scoring
  team.ts                    # Joseph / Frank routing
  followupboss.ts            # FUB API
  pipeline.ts                # inbound message → reply + tasks
  ai.ts                      # Grok/OpenAI replies
  calendar.ts / googleAuth.ts
  hub.ts / hubTypes.ts
netlify/functions/
  score-leads.ts             # cron
  fub-webhook.ts
  google-oauth.ts
  hub.ts / assistant.ts / public-api.ts / process-inbox.ts / sms-webhook.ts
src/screens/HubPage.tsx
src/screens/AssistantPage.tsx
.env.example
README.md
```

---

## What Joseph still needs to do to go live

1. **Merge PR #1** and deploy to Netlify (first production deploy unlocks AI Gateway for Grok).
2. **Follow Up Boss**
   - Set `FOLLOW_UP_BOSS_API_KEY`, `ASSISTANT_DEMO_MODE=false`
   - Optionally set `FUB_LO_USER_ID` / `FUB_LOA_USER_ID`
   - Create custom field “LoanPilot Score” if you want scores on the contact card
   - Webhook → `https://YOUR_DOMAIN/api/webhooks/fub`
3. **Email/SMS** (if using auto-reply): Gmail token; Neo→Gmail; Quo keys + SMS webhook.
4. **Google Calendar** (optional only): Google Cloud OAuth Web client, Calendar + Tasks APIs, redirect `https://YOUR_DOMAIN/api/google/callback`, env `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`, then Hub → Connect Google Calendar. **Cursor cloud could not complete Google OAuth for him.**
5. Smoke-test: Hub → Rescore leads → confirm Joseph/Frank tasks in FUB; lead email drafts; ops email skipped; keep Draft only until voice is right.

---

## Known constraints

- Google Calendar OAuth cannot be finished inside the Cursor cloud agent environment — user must connect from their browser after deploy.
- Demo mode (`ASSISTANT_DEMO_MODE=true` or missing FUB key) uses fixtures (Alex, Jordan, Sam, Pat) and still shows Hub lead heat.
- Settings “calendar connections” toggles in the old booking UI are **local demo only** — real Google is Hub OAuth.
- iMessage has no public API — use Quo/OpenPhone for iPhone business SMS.
- Do not set your own `OPENAI_API_KEY` / OpenRouter keys on Netlify if you want AI Gateway injection.

---

## What to ask Grok to do next (pick one)

**A. Go-live helper** — Walk Joseph through Netlify env vars + FUB webhook + first rescore checklist tailored to his domain.

**B. FUB polish** — Action plans / stage moves when score crosses Hot; digest email to Joseph & Frank of today’s hot list.

**C. Deeper CRM** — Map more FUB custom fields; LO vs LOA ownership rules; “hot again” after N days silent then new inbound.

**D. Code changes** — Clone branch `cursor/mortgage-ai-assistant-84b3`, run `npm test`, extend scoring/routing without breaking Hub demo mode.

---

## Quality bar already met on branch

- `npm test` — 77 passing (including leadScore tests)
- `npm run typecheck` clean
- Grok is default reply engine
- Hub works without Google connected

End of handoff.
