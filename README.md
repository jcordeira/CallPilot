# CallPilot

A calendar appointment and booking system with two audiences in one app:

- **Clients** get a public booking page: pick a call type, a day and a time, enter their details, confirm. Times default to Eastern and can be switched to any offered zone.
- **The host and their team** get a week calendar that merges client calls, tasks booked by teammates and events synced from external calendars; a team roster where anyone can view a colleague's schedule and book on their behalf; and settings for calendar connections, email notifications, conferencing defaults, booking rules, buffers and recurring blocked windows.

Built from the design handoff in `design_handoff_callpilot/` (the HTML prototype is the visual reference; this is the production implementation of it).

## Stack

- React 19 + TypeScript, Vite
- React Router for the four screens (`/book`, `/week`, `/team`, `/settings`)
- Plain CSS with design tokens in `src/styles/tokens.css` (no component library, no shadows, one near-black accent)
- Vitest + Testing Library

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit + component tests
npm run typecheck
npm run build      # production bundle in dist/
```

## Where things live

| Path | What |
|---|---|
| `src/lib/availability.ts` | The availability engine: slot generation from working hours, call duration, buffer, recurring breaks, busy time, minimum notice and the daily cap. Pure functions, fully tested. |
| `src/lib/time.ts` | Hour-float formatting, week math, and IANA time-zone conversion via `Intl` (no library). |
| `src/state/store.tsx` | Host/admin settings, the events feed, the team roster and bookings. Reducer-based; persisted to `localStorage` for the demo. Swap `load()`/the persistence effect for API calls. |
| `src/state/timezone.tsx` | The client's chosen time zone (client-side only, defaults to Eastern). |
| `src/data/fixtures.ts` | Placeholder content: call types, offered zones, team, default settings, and sample events generated relative to the current week. |
| `src/screens/*` | The four screens. |
| `src/components/*` | Shell, toggle, checkbox, modal, and the add-task / break-editor / invite dialogs. |

## Availability rules (as implemented)

- Bookable window is the host's working hours (default Mon–Fri, 9:00–5:00 ET).
- Slot step is **call duration + buffer**. Intro 15 + 15 → every 30 min; Strategy 45 + 15 → hourly; Deep Dive 90 + 15 → every 1h45.
- A candidate is dropped if it overlaps an enabled recurring break on that weekday, overlaps busy time on the host's merged calendar (busy time is extended by the buffer, since the buffer is held open after every appointment), or starts inside the minimum-notice window (24 h).
- The last slot must end by the end of working hours.
- No slots once the day has reached the max-calls-per-day cap (4).
- A day is open when it is not in the past and has at least one slot.

Changing the buffer or toggling a break in Settings changes the client-facing slot list immediately.

## What is wired to real logic vs. still needs a backend

Working in this codebase today:

- Booking flow end to end: type → day → slot → client details (name, email, guests, notes; validated) → confirmation. The booking lands on the host's week as a client call and blocks further slots.
- Week view for any user, with previous/next/today, side-by-side layout for overlapping events, all-day events, an event detail dialog, and **Add task** / **Book for {name}** (tasks land on the chosen teammate's calendar).
- Team roster with **today's load** and **next open slot** computed from real events and rules; **View** opens that person's week; **Invite user** adds a pending member.
- Settings: connection toggles, email checkboxes, conferencing default, buffer, recurring breaks with a full editor (name, start, end, weekday picker, delete).
- Time zones: real offsets and DST via `Intl`; slot labels convert from the host's zone to the client's. A slot that crosses midnight in the client's zone is marked `+1d`.
- Responsive layouts for phones (stacked booking card, single-day week view with a day strip, stacked roster), hover states, and a visible focus ring on every control.

Needs a backend (out of scope for this frontend):

- OAuth for Google / Outlook / iCloud (CalDAV) and the two-way sync engine that feeds `events` with kind `synced`.
- Meeting-link creation via Google Meet and Zoom APIs on booking.
- Email sending (confirmation with `.ics`, 24 h reminder, 1 h reminder, follow-up, teammate notify-on-behalf), plus reschedule/cancel links.
- Per-user settings (connections, hours, breaks) served per user rather than the single settings object used here.
- Server persistence. `StoreProvider` currently persists to `localStorage` under `callpilot:v1`; the reducer actions map directly to API mutations.

## Notes on the design spec

- Product copy, colors, sizes and radii follow the handoff exactly. Names, teammates, call types and sample events are placeholders.
- SMS is deliberately not built; everything goes out by email.
- The IBM Plex Mono face loads from Google Fonts and falls back to the system monospace stack.
