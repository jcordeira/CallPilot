# Grok build brief — LoanPilot × Follow Up Boss

Branch: `cursor/mortgage-ai-assistant-84b3`  
Repo: CallPilot / LoanPilot (Vite + React + Netlify Functions)  
Do **not** create a new branch. Commit and push to this branch. Prefer `ManagePullRequest` update (base `claude/new-session-bchywl`).

## Owner intent (from Joseph Cordeira)

1. **Cannot connect Google Calendar in this Cursor environment** — do not block on Google OAuth. Keep Calendar optional/demo. Prefer Follow Up Boss as the system of record.
2. **AI agent must live inside Follow Up Boss CRM** — notes, tasks, lead scores, and “who should call” must show up in FUB for:
   - **Joseph Cordeira** — Loan Officer (LO)
   - **Frank Cordeira** — Loan Officer Assistant (LOA)
3. **Score leads** so Joseph and Frank know when a client is **hot again** and when to reach out.
4. **Create FUB tasks assigned to the right person** (Joseph vs Frank) based on score / urgency / role.

## Product rules

### Lead heat score (0–100)
Compute from available signals (demo-friendly if no FUB API key):

| Signal | Weight idea |
|---|---|
| Recent inbound email/SMS (last 24–72h) | High |
| Engagement keywords (pre-approval, rate, docs ready, “ready to buy”, refinance now) | High |
| Stage (Lead / Hot Lead / Nurture / Closed / Trash) | Medium |
| Days since last contact | Medium (long silence → cooling unless inbound) |
| Appointment requested | High |
| Ops/vendor contact | Exclude from scoring |

Bands:
- **90–100 Hot now** → task **today** for **Joseph** (LO) — Call
- **70–89 Warm** → task within **24–48h** for **Frank** (LOA) — Follow Up / Text
- **40–69 Cool** → nurture task for **Frank** in **3–7 days**
- **0–39 Cold** → no urgent task; optional note only

Persist score on person via FUB custom field when possible (`customLoanPilotScore` or similar), always write a **note** on the person with score + reason, and create **tasks**.

### Task routing
Env defaults (also hardcode name fallbacks for demo):

```
FUB_LO_NAME=Joseph Cordeira
FUB_LOA_NAME=Frank Cordeira
FUB_LO_USER_ID=   # optional
FUB_LOA_USER_ID=  # optional
```

Use `assignedTo: "Joseph Cordeira"` / `"Frank Cordeira"` (or user IDs when set) in `POST /v1/tasks`.

### FUB-native “live in CRM”
- Scheduled function (e.g. hourly) to rescore open leads and create tasks when heat crosses thresholds
- Webhook endpoint for FUB events (`peopleUpdated`, `notesCreated`, etc.) that triggers rescore
- Every auto-reply / escalation already creating tasks should route LO vs LOA correctly
- Hub UI: **Lead heat** panel listing scored leads, next action, assignee

### Google Calendar
Leave OAuth as-is. Hub must work fully without Google connected. Do not require Google for scoring or FUB tasks.

## Implementation sketch (follow existing patterns)

| Area | Path |
|---|---|
| FUB client | `netlify/functions/_shared/followupboss.ts` |
| Inbox pipeline | `netlify/functions/_shared/pipeline.ts` |
| Hub API | `netlify/functions/_shared/hub.ts`, `netlify/functions/hub.ts` |
| Hub UI | `src/screens/HubPage.tsx` |
| Types | `netlify/functions/_shared/hubTypes.ts`, `src/lib/hubApi.ts` |

Add roughly:
- `netlify/functions/_shared/leadScore.ts` — pure scoring + tests
- `netlify/functions/_shared/team.ts` — Joseph / Frank routing
- `netlify/functions/score-leads.ts` — scheduled cron
- `netlify/functions/fub-webhook.ts` — `/api/webhooks/fub`
- Hub endpoints: `GET /api/hub/leads`, maybe `POST /api/hub/score`
- Demo fixtures for scored leads when `ASSISTANT_DEMO_MODE=true`

## Quality bar
- `npm test` and `npm run typecheck` must pass
- Demo mode works with no FUB key
- Update `.env.example` + README with Joseph/Frank routing and scoring
- Commit with a clear message and `git push -u origin cursor/mortgage-ai-assistant-84b3`
- Update PR #1 body via ManagePullRequest if available

## Out of scope
- Replacing Grok as the reply model
- Requiring Google Calendar connect
- Building other CRMs beyond FUB this pass
