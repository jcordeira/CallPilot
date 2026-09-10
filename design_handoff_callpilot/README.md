# Handoff: CallPilot — Calendar Appointment & Booking System

## Overview
CallPilot is a scheduling product with two audiences in one system:

1. **Clients** get a public booking page: pick a call type, pick a day, pick a time, confirm. Times default to Eastern; the client can switch time zone.
2. **The host and their team** get an internal side: a week calendar that merges client calls, tasks booked by teammates, and events synced in from external calendars; a team roster where anyone can view a colleague's schedule and book on their behalf; and a settings screen for calendar connections, email notifications, conferencing defaults, booking rules, buffers, and recurring blocked windows.

Product requirements the design encodes:
- Two-way sync with Google Calendar, Outlook Calendar and iCloud Calendar (bookings write out; external busy time blocks bookings here).
- **Email only** — no SMS/text notifications anywhere in the product.
- Shared calendars: team members can see the host's schedule and create tasks/appointments on it.
- Additional users, each with their own calendar, booking page, connections and hours; all mutually visible and bookable.
- Google Meet / Zoom (plus phone and in person) as meeting locations.
- Time zone defaults to Eastern; client can change it.
- Custom buffer between appointments and recurring break windows that clients cannot book.

## About the Design Files
The file in this bundle (`CallPilot.dc.html`) is a **design reference created in HTML** — a working prototype that shows intended look, layout, copy and interaction behavior. It is **not production code to copy**. It uses a streaming component runtime and inline styles, and it runs entirely on hardcoded fixture data with no backend.

The task is to **recreate these designs in the target codebase's existing environment** (React, Vue, SwiftUI, Rails views, whatever is in place) using its established component library, styling approach, routing and data layer. If no codebase exists yet, choose the most appropriate framework and implement the designs there. Read the HTML for exact values and behavior; do not port the runtime.

## Fidelity
**High fidelity.** Colors, type sizes, spacing, radii, copy and interaction states are final and should be matched closely. Every hex value, font size and pixel measurement below is what the prototype actually renders.

Two things are deliberately *not* final:
- Names and content are placeholders (host "Maya Cordeira", five fictional teammates, three call types, sample events). Replace with real data.
- The "N open" slot availability uses a deterministic pseudo-random function to look plausible. Real availability comes from the calendar + rules engine.

---

## Global shell

- Page background `#FAFAFA`. Body text color `#111827`.
- Font: system sans stack — `'Helvetica Neue', Helvetica, Arial, sans-serif`, antialiased. No display/serif face: hierarchy comes from size and `font-weight: 500`.
- Second face: **IBM Plex Mono** (400/500, Google Fonts) used *only* for times, small uppercase section labels, table headers, and metadata.
- Content column: `max-width: 1160px`, centered, `padding: 0 24px` (Settings narrows to `820px`).

### Header (persistent, all screens)
- `height: 64px`, background `#FFFFFF`, `border-bottom: 1px solid #E5E7EB`.
- Left: 26×26 mark, `border-radius: 7px`, background `#111827`, white "C" at 13px/500. Then wordmark **CallPilot** at 21px, `font-weight: 500`, `letter-spacing: -0.01em`. `gap: 10px`.
- Center-right: four nav buttons — **Booking page**, **My week**, **Team**, **Settings**. 13.5px, `padding: 7px 13px`, `border-radius: 8px`, no border. Active: background `#F3F4F6`, color `#111827`. Inactive: transparent, color `#6B7280`.
- Right (after a `1px` left divider, `padding-left: 20px`): current time-zone abbreviation in 11px mono `#6B7280` (e.g. `ET · GMT-4`), then a 28px avatar circle, background `#F0F1F3`, 11px mono initials `#6B7280`.

---

## Screen 1 — Booking page (client view)

**Purpose:** a client picks a call type, day and time and confirms. This is the URL sent to clients.

**Layout:** above the card, an eyebrow row: 11px mono uppercase `letter-spacing: 0.12em` "CLIENT VIEW" `#6B7280` followed by a `1px #E5E7EB` rule filling the remaining width, `gap: 12px`, `margin-bottom: 22px`.

The card: `border: 1px solid #E5E7EB`, `border-radius: 14px`, background `#FFFFFF`, `overflow: hidden`, `display: grid`, `grid-template-columns: minmax(0,300px) minmax(0,1fr)`, no gap. Right pane `min-height: 520px`.

### Left rail (300px, `padding: 32px 28px`, background `#FAFAFA`, `border-right: 1px solid #E5E7EB`)
Top to bottom:
1. 56px avatar circle, background `#F3F4F6`, color `#111827`, 22px/500 initials, `margin-bottom: 16px`.
2. Host name, 13px `#6B7280`.
3. Selected call type name, 30px, `font-weight: 500`, `line-height: 1.15`, `letter-spacing: -0.015em`, `margin-bottom: 20px`.
4. Three meta rows, `gap: 11px`, 13.5px `#374151`, each with a 16px centered glyph in `#6B7280` — `◷` duration, `▢` location, `◇` note. Followed by `border-bottom: 1px solid #E5E7EB`, `padding-bottom: 22px`.
5. Label "CHOOSE A CALL" — 10.5px mono, uppercase, `letter-spacing: 0.1em`, `#6B7280`, `margin: 22px 0 10px`.
6. Call-type buttons, `gap: 7px`, left-aligned, `padding: 11px 13px`, `border-radius: 10px`. Name 13.5px `#111827`; duration 10.5px mono `#6B7280`. Selected: `background #F3F4F6`, `border 1px solid #111827`. Unselected: `background #fff`, `border 1px solid #E5E7EB`.
7. Label "TIME ZONE" (same style as above).
8. Native `<select>`, full width, `padding: 9px 11px`, `border 1px solid #E5E7EB`, `border-radius: 9px`, 13px.
9. Helper text, 11.5px `#6B7280`, `line-height: 1.45`: "Times shown in {zone}. Defaults to Eastern."

**Call types (placeholder content):**
| Name | Duration | Location | Note |
|---|---|---|---|
| Intro Call | 15 min | Google Meet | No prep needed |
| Strategy Session | 45 min | Zoom | Agenda sent in advance |
| Deep Dive | 90 min | Zoom | Screen share recommended |

**Time zones offered** (label / abbreviation shown in header): Eastern Time — New York (`ET · GMT-4`, default), Central Time — Chicago (`CT · GMT-5`), Mountain Time — Denver (`MT · GMT-6`), Pacific Time — Los Angeles (`PT · GMT-7`), United Kingdom — London (`BST · GMT+1`), Portugal — Lisbon (`WEST · GMT+1`). Production should offer the full IANA list with real offsets; the prototype hardcodes abbreviations.

### Right pane — picker state
`display: grid; grid-template-columns: minmax(0,1fr) 178px; gap: 32px`.

**Month calendar (left column)**
- Header row, `space-between`, `margin-bottom: 18px`: month + year at 22px/500; two 30×30 nav buttons (`‹` `›`), `border 1px solid #E5E7EB`, `border-radius: 8px`, white, color `#6B7280`.
- Weekday header: 7-column grid, `gap: 4px`, labels **Mon Tue Wed Thu Fri Sat Sun** (week starts Monday), 10px mono, `letter-spacing: 0.08em`, `#6B7280`, centered.
- Day grid: 7 columns, `gap: 4px`, each cell `aspect-ratio: 1`, `border-radius: 9px`, 13.5px, centered.
  - **Open**: background `#FFFFFF`, `border 1px solid #D1D5DB`, text `#111827`, `cursor: pointer`.
  - **Selected**: background `#111827`, border `#111827`, text `#FFFFFF`.
  - **Booked out / unavailable**: background `#F3F4F6`, no border, text `#C7CBD1`, `disabled`, `cursor: default`.
  - Leading blanks for the month's offset are fully transparent.
  - A day is open when it is a weekday, not in the past, and has ≥1 remaining slot.
- Legend, `margin-top: 18px`, 11.5px `#6B7280`, `gap: 16px`: three 9×9 `border-radius: 3px` swatches matching the three states exactly (Open = white with `#D1D5DB` border; Selected = `#111827`; Booked out = `#F3F4F6` no border).

**Slot column (178px, `border-left: 1px solid #E5E7EB`, `padding-left: 24px`)**
- Selected day label, 13.5px (e.g. "Tue, Sep 15").
- Count line, 10.5px mono `#6B7280`: "`{n} open · {duration}`".
- Slot buttons, `gap: 6px`, `padding: 10px 0`, full width, `border-radius: 9px`, 13px mono. Unselected: white, `border 1px solid #D1D5DB`, text `#111827`. Selected: background `#111827`, white text. Scrolls at `max-height: 400px`.
- When a slot is selected, a primary button appears (`margin-top: 16px`, `padding: 12px`, background `#111827`, white, `border-radius: 10px`, 13.5px): "Confirm {time}".

**Slot generation logic (implement against real data):**
- Bookable window 9:00–17:00.
- Step = **call duration + buffer** (not a fixed 30 min). Intro 15 + 15 buffer → every 30 min; Strategy 45 + 15 → hourly; Deep Dive 90 + 15 → every 1h45.
- A candidate at `h` is dropped if `[h, h + duration)` overlaps **any enabled recurring break** whose weekday list includes that day.
- A candidate is dropped if it is already booked (prototype fakes this; production reads merged calendar busy time from all connected calendars).
- Last slot must satisfy `h + duration ≤ 17:00`.

### Right pane — confirmed state
Replaces the picker. `max-width: 420px`, centered, `margin: 40px auto`, text centered.
- 46px circle, background `#F3F4F6`, `✓` 20px `#111827`, `margin-bottom: 18px`.
- "You're booked" — 28px/500, `line-height: 1.2`.
- Body 13.5px `#6B7280`, `line-height: 1.6`: "A confirmation and calendar invite are on the way. We'll email a reminder 24 hours and 1 hour before."
- Summary card: `border 1px solid #E5E7EB`, `border-radius: 12px`, `padding: 18px 20px`, background `#FAFAFA`, left-aligned. Four `space-between` rows, `gap: 10px`, 13px — label `#6B7280`, value `#111827` (Call / When / Zone / Where; When and Zone in 12px mono).
- Secondary button: "Book another time", `padding: 9px 16px`, `border 1px solid #E5E7EB`, white, `border-radius: 9px`, 13px `#6B7280`.

---

## Screen 2 — My week

**Purpose:** the host's own schedule, merging internal bookings, teammate-created tasks, and externally synced events.

**Toolbar** (`space-between`, wraps, `gap: 14px`, `margin-bottom: 20px`):
- Left: date range at 32px/500 `letter-spacing: -0.015em` (e.g. "Sep 7 – Sep 13, 2026"); below it 11px mono `#6B7280` summary ("9 events · 6 client calls · 2 tasks booked by team").
- Right: `‹` (32×32), **Today** (`padding: 0 14px`, height 32, 13px), `›` (32×32) — all `border 1px solid #E5E7EB`, white, `border-radius: 8px`; then **Add task**, height 32, `padding: 0 15px`, background `#111827`, white, 13px, `border-radius: 8px`, `margin-left: 8px`.

**Grid** (`border 1px solid #E5E7EB`, `border-radius: 14px`, white, `overflow: hidden`):
- Two stacked grids sharing `grid-template-columns: 58px repeat(7, minmax(0,1fr))`.
- **Day header row**, `border-bottom: 1px solid #E5E7EB`: each cell `padding: 11px 8px`, centered, `border-right: 1px solid #E5E7EB`; weekday 10px mono `letter-spacing: 0.08em` `#6B7280`; date number 16px. Today's column header background `#F3F4F6` with number `#111827`; weekend headers `#FAFAFA`; others white.
- **Body**: first column is the hour axis — eleven 56px rows, right-aligned, 10px mono `#6B7280`, labels "8 AM" through "6 PM" (8:00–18:00). Each day column is `position: relative`, weekend background `#FAFAFA`, and contains eleven 56px rows with `border-bottom: 1px solid #F1F2F4`.
- **Event cards**: `position: absolute; left: 3px; right: 3px`, `top = (start − 8) × 56px`, `height = duration × 56 − 3px`, `border-radius: 6px`, `padding: 4px 6px`, `overflow: hidden`, `border-left: 2px solid {kindEdge}`, background `{kindBg}`.
  - Title: 11px, `line-height: 1.2`, `#111827`, ellipsis-truncated.
  - Time row (11px mono `#6B7280`, `margin-top: 2px`, nowrap + ellipsis) is rendered **only for events ≥45 min**. Shorter events instead prefix the start time into the title on a single nowrap line ("2 PM  Intro — T. Nakamura"). This constraint exists because a 30-minute card is only 25px tall.
  - Time format collapses a shared meridiem: `9:00 – 9:45 AM`, `10:30 – 11:30 AM`, but `11:30 AM – 1:00 PM`.
- **Event kinds** (colors + legend below the grid, 11.5px `#6B7280`, `gap: 18px`):
  | Kind | Background | Left edge | Legend |
  |---|---|---|---|
  | Client call | `#F3F4F6` | `#111827` | Client call |
  | Task booked by a teammate | `#FDF2E3` | `#B45309` | Task from team |
  | Synced from an external calendar | `#F3F4F6` | `#6B7280` | Synced from Google / Outlook |

Navigating away from the current week shows an empty grid and the summary "Nothing scheduled yet" — fixture behavior only.

---

## Screen 3 — Team

**Purpose:** see every user's schedule and book into it.

**Header:** "Team" 32px/500; below, 11px mono `#6B7280`: "5 users · shared calendars · booking on behalf enabled". Right: **Invite user**, height 34, `padding: 0 15px`, `border 1px solid #E5E7EB`, white, `border-radius: 9px`, 13px.

**Roster table** (`border 1px solid #E5E7EB`, `border-radius: 14px`, white, `overflow: hidden`):
- Columns: `minmax(0,1.6fr) minmax(0,1fr) minmax(0,1.5fr) 210px`.
- Header row: `padding: 11px 20px`, background `#FAFAFA`, `border-bottom: 1px solid #E5E7EB`, 10px mono uppercase `letter-spacing: 0.09em` `#6B7280` — PERSON / TODAY / NEXT OPEN SLOT / ACTIONS (right-aligned).
- Body rows: `padding: 15px 20px`, `border-bottom: 1px solid #F1F2F4`, vertically centered.
  - Person: 34px avatar circle (background `#F0F1F3`, 11px mono `#6B7280` initials), `gap: 12px`; name 14px; role 11.5px `#6B7280`.
  - Today and Next open slot: 12px mono `#374151`.
  - Actions, right-aligned, `gap: 7px`: **View** (`padding: 7px 11px`, `border 1px solid #E5E7EB`, white, `border-radius: 8px`, 12.5px `#374151`) and **Book for {FirstName}** (same padding, no border, background `#F3F4F6`, color `#111827`).

**Roster (placeholder):** Maya Cordeira — Owner — 3 calls · 5h — Today 3:30 PM; Devon Reyes — Client success — 1 call · 2h — Today 11:00 AM; Priya Raman — Operations — Clear — Today 9:00 AM; Sam Whitfield — Advisor — 2 calls · 3h — Tomorrow 10:00 AM; Nia Bekele — Analyst — Out of office — Fri 9:30 AM.

**Three permission cards** below, `grid-template-columns: repeat(auto-fit, minmax(260px, 1fr))`, `gap: 14px`, `margin-top: 20px`. Each: `border 1px solid #E5E7EB`, `border-radius: 12px`, `padding: 18px`, white; title 14px, body 12.5px `#6B7280` `line-height: 1.55`. These state the sharing model and should drive the permissions implementation:
1. **See my schedule** — "Team members see your full week, including events synced from Google and Outlook. Private events show as busy."
2. **Book on my behalf** — "Anyone on the team can place a task or an appointment on your calendar. You get an email when they do."
3. **Their own calendars** — "Each user gets a booking page, their own connections, and their own hours. You can see and book into all of them."

---

## Screen 4 — Settings

`max-width: 820px`. Title "Settings" 32px/500, `margin-bottom: 28px`. Four sections, each preceded by a 10.5px mono uppercase `letter-spacing: 0.1em` `#6B7280` label and rendered as a `border 1px solid #E5E7EB`, `border-radius: 14px`, white card.

### 1. Calendar connections
Three rows (`padding: 16px 20px`, `border-bottom: 1px solid #F1F2F4`, `gap: 16px`):
- 32px `border-radius: 9px` tile, background `#F3F4F6`, 11px mono `#6B7280` tag: `GC`, `OL`, `IC`.
- Name 14px + account 11.5px `#6B7280`: Google Calendar / maya@teamcordeira.com (on); Outlook Calendar / maya.cordeira@outlook.com (on); iCloud Calendar / "Not connected" (off).
- Status text, 10.5px mono: `2-WAY SYNC ON` in `#111827`, or `OFF` in `#B8BDC5`.
- **Toggle**: 42×24 pill, `border-radius: 999px`, no border. Track `#111827` on / `#D1D5DB` off. Knob 18px white circle, `top: 3px`, `left: 21px` on / `3px` off, `transition: left .16s ease`.
- Footer strip, `padding: 14px 20px`, background `#FAFAFA`, 12.5px `#6B7280`: "Two-way sync: bookings write to the connected calendar, and busy time there blocks new bookings here."

### 2. Email notifications
Four full-width checkbox rows (`padding: 14px 20px`, `border-bottom: 1px solid #F1F2F4`, `gap: 14px`, whole row clickable). Checkbox: 18px, `border-radius: 5px`; checked = background `#111827`, border `#111827`, white `✓` at 11px; unchecked = white with `1px solid #D1D5DB`. Name 14px, description 11.5px `#6B7280`.
| Item | Description | Default |
|---|---|---|
| Booking confirmation | Sent immediately, with a calendar invite attached | on |
| Reminder — 24 hours before | To the client and every guest | on |
| Reminder — 1 hour before | Includes the meeting link | on |
| Follow-up after the call | Sent 2 hours after the end time | off |

Footer strip (same style as above): "SMS is off. Everything goes out by email." **Do not build SMS.**

### 3. Conferencing & hours
`padding: 22px 20px`.
- "Default meeting link" 13.5px, then four chips (`padding: 9px 15px`, `border-radius: 9px`, 13px, `gap: 8px`): **Google Meet** (selected), **Zoom**, **Phone call**, **In person**. Selected: background `#F3F4F6`, `border 1px solid #111827`, color `#111827`. Unselected: white, `border 1px solid #E5E7EB`, color `#374151`.
- Below (`margin-top: 26px`), a read-only summary grid, `repeat(auto-fit, minmax(190px,1fr))`, `gap: 20px`. Each: 10px mono uppercase `letter-spacing: 0.08em` `#6B7280` label over a 14px value.
  | Label | Value |
  |---|---|
  | Working hours | Mon–Fri, 9:00 – 5:00 ET |
  | Buffer between calls | *reflects the buffer selection below* |
  | Minimum notice | 24 hours |
  | Max calls per day | 4 |

### 4. Breaks clients can't book
Section label "BREAKS CLIENTS CAN'T BOOK", `margin: 32px 0 10px`.

**Buffer block** (`padding: 22px 20px`, `border-bottom: 1px solid #F1F2F4`):
- "Buffer after every appointment" 13.5px; helper 12.5px `#6B7280`: "Held open on your calendar. Clients never see these minutes as bookable."
- Six chips, `gap: 7px`, `padding: 8px 14px`, `border-radius: 9px`, 13px **mono**: **None, 5 min, 10 min, 15 min (default), 30 min, 60 min**. Selected: background `#111827`, border `#111827`, white. Unselected: white, `border 1px solid #E5E7EB`, `#374151`.
- Changing this updates the "Buffer between calls" summary row **and** the client-facing slot spacing.

**Recurring breaks block** (`padding: 22px 20px 8px` intro):
- "Recurring breaks" 13.5px; helper 12.5px `#6B7280`: "Blocked windows that repeat every week."
- One row per break (`padding: 13px 20px`, `border-top: 1px solid #F1F2F4`, `gap: 14px`): name 13.5px (`#111827` enabled, `#6B7280` disabled); `{window} · {days}` in 11px mono `#6B7280`; the same 42×24 toggle as calendar connections.
- Defaults: **Lunch** 12:00–1:00 PM Mon–Fri (on); **Focus block** 8:00–9:00 AM Mon, Wed, Fri (on); **End-of-week wrap-up** 3:00–5:00 PM Fri (off).
- Footer: **+ Add a break** button, `padding: 9px 14px`, `border: 1px dashed #D1D5DB`, white, `border-radius: 9px`, 13px `#374151`, above a `border-top: 1px solid #F1F2F4`. **Not implemented in the prototype** — needs a real editor (name, start, end, weekday picker, delete).

---

## Interactions & Behavior

**Implemented in the prototype**
- Header nav switches between the four screens.
- Booking page: select call type (resets the chosen slot, changes duration → changes slot spacing and location); month back/forward; select an open day (resets slot); select a slot; Confirm → confirmation state; "Book another time" → back to picker.
- Time-zone `<select>` changes the header abbreviation and the helper line, and resets the chosen slot.
- Week view: previous/next/today.
- Settings: all three sync toggles, all four email checkboxes, conferencing selection, buffer selection, all three break toggles — and buffer + breaks feed the client slot list live.
- Transitions: only the toggle knob (`left .16s ease`). Nothing else animates.

**Not implemented — needs building**
- Client details form after slot selection: name, email, guests, intake questions. The prototype jumps straight to confirmation.
- Real availability from merged external-calendar busy time; minimum-notice (24h) and max-per-day (4) enforcement.
- Actual OAuth for Google / Outlook / iCloud (CalDAV) and the two-way sync engine.
- Meeting-link creation via Google Meet and Zoom APIs on booking.
- Email sending (confirmation with `.ics`, 24h reminder, 1h reminder, follow-up), plus reschedule/cancel links.
- Team: **View** and **Book for {name}** actions, **Invite user**, per-user hours and connections, the notify-on-behalf email.
- **Add task** on the week view.
- **+ Add a break** editor.
- Hover and focus states: the prototype defines none. Add them per the target design system (a sensible default: raise borders from `#E5E7EB` to `#D1D5DB` on hover, and a visible `:focus-visible` ring on every control — the current markup has no focus treatment, which is an accessibility gap to close).
- Loading, empty and error states: none exist. Slot lists, week grids and roster all need them.
- Responsive: the prototype is desktop-first and does **not** collapse. Both two-column grids (booking card at 300px + 1fr, and picker at 1fr + 178px) and the 8-column week grid need mobile treatments. **Clients frequently book on phones — the booking page needs a real mobile layout**, likely a stacked single column with the day picker above a full-width slot list.

## State Management
The prototype holds one flat state object. A real implementation should split client-facing booking state from host/admin settings (server-persisted).

| Key | Type | Default | Notes |
|---|---|---|---|
| `screen` | `'book' \| 'week' \| 'team' \| 'settings'` | `'book'` | Becomes routes |
| `tz` | IANA id | `'America/New_York'` | Client-side; Eastern default |
| `type` | index into call types | `0` | |
| `month`, `year` | number | `8`, `2026` | Visible month |
| `sel` | `YYYY-MM-DD` | `'2026-09-15'` | Selected day |
| `slot` | hour as float (`14.5` = 2:30 PM) | `null` | |
| `confirmed` | boolean | `false` | |
| `weekOffset` | number | `0` | Weeks from the current week |
| `conn` | `{google, outlook, icloud}` booleans | `true, true, false` | Server-persisted |
| `emails` | boolean[4] | `[t, t, t, f]` | Server-persisted |
| `conf` | index 0–3 | `0` (Google Meet) | Server-persisted |
| `buffer` | minutes | `15` | Server-persisted; drives slot spacing |
| `breaks` | boolean[3] | `[t, t, f]` | Server-persisted; drives slot exclusion |

**Data fetching needed:** host profile + call types; merged busy time per user per date range; availability rules (hours, buffer, breaks, notice, daily cap); connection status per provider; team roster with load and next-open-slot; the events feed for the week view.

## Design Tokens

**Color**
| Token | Hex | Use |
|---|---|---|
| Ink | `#111827` | Body text, accent, selected fills, primary buttons, toggle-on |
| Text secondary | `#374151` | Meta values, unselected chip text |
| Text muted | `#6B7280` | All small/mono metadata, labels, helper copy (minimum for text) |
| Text disabled | `#C7CBD1` | Unavailable day numbers |
| Text off-state | `#B8BDC5` | "OFF" status label only |
| Page background | `#FAFAFA` | Page, inset panels, table headers, footer strips, weekend columns |
| Surface | `#FFFFFF` | Cards, header, open day cells, controls |
| Fill subtle | `#F3F4F6` | Selected chips, booked-out days, avatar tiles, client-call events |
| Fill subtle alt | `#F0F1F3` | Avatar circles |
| Border | `#E5E7EB` | Card and control borders, dividers |
| Border strong | `#D1D5DB` | Open-day and slot borders, toggle-off track, dashed add button |
| Rule light | `#F1F2F4` | Row separators, hour gridlines |
| Amber fill | `#FDF2E3` | Teammate-task events |
| Amber edge | `#B45309` | Teammate-task left border |

Single accent, near-black. No hue is used decoratively except the amber that distinguishes teammate-booked tasks.

**Typography** — `'Helvetica Neue', Helvetica, Arial, sans-serif` and `'IBM Plex Mono', monospace`.
Scale: 9 / 10 / 10.5 / 11 / 11.5 / 12 / 12.5 / 13 / 13.5 / 14 / 16 / 21 / 22 / 28 / 30 / 32 px. Weights 400 and 500 only. `letter-spacing: -0.015em` on 28–32px headings; `0.08–0.12em` on uppercase mono labels.

**Spacing** — 2, 3, 4, 6, 7, 8, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 44, 80 px.

**Radii** — 3 (legend swatch), 5 (checkbox), 6 (event card), 7 (logo mark), 8 (nav, small buttons), 9 (day cell, slot, chip, select), 10 (type button, primary button), 12 (small card), 14 (major card), 999 (toggle).

**Shadows** — none. Depth comes from 1px borders only.

**Layout constants** — content 1160px / settings 820px; header 64px; booking left rail 300px; slot column 178px; week hour row 56px; week axis 58px; week hours 8:00–18:00; bookable window 9:00–17:00.

## Assets
None. No images, no icon library, no logo file. The only glyphs are Unicode characters typed directly into the markup: `◷` `▢` `◇` (booking meta rows), `‹` `›` (nav), `✓` (confirmation and checkboxes), `+` (add break). Replace these with the target codebase's icon set. The "C" logo mark is a styled letter, not artwork — a real wordmark/logo for CallPilot still needs to be designed.

## Files
- `CallPilot.dc.html` — the complete prototype: all four screens, all styling (inline), and all interaction logic. The logic lives in the `class Component` block at the bottom of the file; `slotsFor()` holds the availability algorithm and `renderVals()` holds every derived style and label.
