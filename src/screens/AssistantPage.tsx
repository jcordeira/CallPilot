import { useEffect, useState, useTransition } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchActivity,
  previewReply,
  runSweep,
  type ActivityItem,
  type Channel,
} from '../lib/assistantApi'
import './AssistantPage.css'

const DECISION_LABEL: Record<ActivityItem['decision'], string> = {
  replied: 'Replied',
  escalated: 'Escalated',
  skipped: 'Skipped',
  task_created: 'Task',
  appointment_created: 'Appointment',
}

function relativeTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

const PRESETS: { label: string; channel: Channel; subject: string; body: string; fromEmail?: string; fromPhone?: string }[] = [
  {
    label: 'Docs question (email)',
    channel: 'gmail',
    subject: 'Pre-approval documents',
    body: 'Hi, what documents do I need to get pre-approved?',
    fromEmail: 'alex.buyer@gmail.com',
  },
  {
    label: 'Ops email (should skip)',
    channel: 'gmail',
    subject: 'UW condition update',
    body: 'Conditions cleared for appraisal review on file 55421.',
    fromEmail: 'ops@underwriting.example.com',
  },
  {
    label: 'Refi SMS',
    channel: 'sms',
    subject: '',
    body: 'Hey can we schedule a call about refinancing Thursday?',
    fromPhone: '+15551234567',
  },
]

export function AssistantPage() {
  const [items, setItems] = useState<ActivityItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ summary: string; reply?: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)

  const load = () => {
    startTransition(async () => {
      try {
        const data = await fetchActivity()
        setItems(data.items)
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load activity')
        // Offline / no functions — show empty state, not a hard crash
        setItems([])
      }
    })
  }

  useEffect(() => {
    load()
  }, [])

  const onSweep = async () => {
    setBusy(true)
    try {
      const res = await runSweep()
      setItems(res.results)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sweep failed')
    } finally {
      setBusy(false)
    }
  }

  const onPreset = async (preset: (typeof PRESETS)[number]) => {
    setBusy(true)
    setPreview(null)
    try {
      const res = await previewReply({
        channel: preset.channel,
        subject: preset.subject,
        body: preset.body,
        fromEmail: preset.fromEmail,
        fromPhone: preset.fromPhone,
        fromName: 'Sample Lead',
      })
      setPreview({
        summary: `${DECISION_LABEL[res.activity.decision]} — ${res.activity.summary}`,
        reply: res.replyBody ?? res.activity.replyPreview,
      })
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page assistant">
      <div className="assistant__hero">
        <div>
          <p className="eyebrow">Mortgage loan assistant</p>
          <h1 className="page-title assistant__title">LoanPilot</h1>
          <p className="assistant__lede">
            Powered by Grok for lead replies when you can&apos;t get back — skips ops traffic, drafts
            safe answers, and drops Follow Up Boss tasks plus calendar holds for you.
          </p>
        </div>
        <div className="assistant__actions">
          <button type="button" className="btn btn--primary" onClick={onSweep} disabled={busy}>
            {busy ? 'Working…' : 'Run inbox sweep'}
          </button>
          <Link to="/assistant/settings" className="btn btn--ghost">
            Assistant settings
          </Link>
        </div>
      </div>

      <div className="assistant__grid">
        <section className="assistant__panel" aria-labelledby="activity-heading">
          <div className="assistant__panel-head">
            <h2 id="activity-heading" className="assistant__h">
              Recent activity
            </h2>
            <button type="button" className="btn btn--ghost btn--small" onClick={load} disabled={pending}>
              Refresh
            </button>
          </div>
          {error && <p className="assistant__error">{error}</p>}
          {items.length === 0 && !error && (
            <p className="assistant__empty">No activity yet. Run a sweep or try a preview scenario.</p>
          )}
          <ul className="activity">
            {items.map((item) => (
              <li key={item.id} className="activity__row">
                <div className="activity__meta">
                  <span className={`pill pill--${item.decision}`}>{DECISION_LABEL[item.decision]}</span>
                  <span className="mono activity__channel">{item.channel}</span>
                  <span className="mono activity__kind">{item.senderKind}</span>
                  <span className="activity__when">{relativeTime(item.at)}</span>
                </div>
                <div className="activity__from">{item.from}</div>
                {item.subject && <div className="activity__subject">{item.subject}</div>}
                <div className="activity__summary">{item.summary}</div>
                {item.replyPreview && (
                  <blockquote className="activity__preview">{item.replyPreview}</blockquote>
                )}
                <div className="activity__links mono">
                  {item.fubTaskId != null && <span>FUB task #{item.fubTaskId}</span>}
                  {item.calendarEventId && <span>Cal {item.calendarEventId}</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="assistant__panel" aria-labelledby="try-heading">
          <h2 id="try-heading" className="assistant__h">
            Try a scenario
          </h2>
          <p className="assistant__help">
            Previews always draft — they never send. Lead-only filtering skips operations senders.
          </p>
          <div className="assistant__presets">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="btn btn--ghost"
                disabled={busy}
                onClick={() => onPreset(p)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {preview && (
            <div className="assistant__preview-result">
              <div className="eyebrow">Result</div>
              <p>{preview.summary}</p>
              {preview.reply && <blockquote className="activity__preview">{preview.reply}</blockquote>}
            </div>
          )}

          <div className="assistant__channels">
            <div className="eyebrow">Connected channels</div>
            <ul className="channel-list">
              <li>
                <strong>Gmail</strong> — lead inbox polling every 5 minutes
              </li>
              <li>
                <strong>Neo Mail</strong> — forward to Gmail or IMAP credentials
              </li>
              <li>
                <strong>iPhone texts</strong> — via Quo (OpenPhone) business SMS on your phone
              </li>
              <li>
                <strong>Follow Up Boss</strong> — tasks + notes on the lead
              </li>
              <li>
                <strong>Google Calendar</strong> — holds call slots when leads ask to meet
              </li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  )
}
