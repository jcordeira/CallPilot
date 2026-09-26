import { useEffect, useState, useTransition } from 'react'
import { Link } from 'react-router-dom'
import { fetchSettings, saveSettings, type AssistantSettings } from '../lib/assistantApi'
import { Toggle } from '../components/Toggle'
import './AssistantSettingsPage.css'

export function AssistantSettingsPage() {
  const [settings, setSettings] = useState<AssistantSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    startTransition(async () => {
      try {
        const data = await fetchSettings()
        setSettings(data.settings)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load settings')
      }
    })
  }, [])

  const patch = async (partial: Partial<AssistantSettings>) => {
    if (!settings) return
    const optimistic = {
      ...settings,
      ...partial,
      channels: { ...settings.channels, ...(partial.channels ?? {}) },
    }
    setSettings(optimistic)
    setSaved(false)
    try {
      const data = await saveSettings(partial)
      setSettings(data.settings)
      setSaved(true)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  if (!settings && !error) {
    return (
      <div className="page page--narrow">
        <p className="assistant-set__muted">Loading assistant settings…</p>
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="page page--narrow">
        <p className="assistant-set__error">{error}</p>
        <Link to="/assistant">Back to assistant</Link>
      </div>
    )
  }

  return (
    <div className="page page--narrow assistant-set">
      <div className="assistant-set__top">
        <div>
          <Link to="/assistant" className="assistant-set__back">
            ← Assistant
          </Link>
          <h1 className="page-title settings__title">Assistant settings</h1>
          <p className="assistant-set__lede">
            Lead-only replies for Gmail, Neo, and Quo SMS. Draft-first until you trust the voice.
          </p>
        </div>
        {saved && <span className="mono assistant-set__saved">Saved</span>}
      </div>

      {error && <p className="assistant-set__error">{error}</p>}

      <div className="eyebrow settings__label">Behavior</div>
      <div className="card settings__section">
        <div className="conn">
          <div className="conn__who">
            <div className="conn__name">Auto-reply</div>
            <div className="conn__account">Process inbound lead messages automatically</div>
          </div>
          <Toggle
            checked={settings.autoReplyEnabled}
            onChange={() => patch({ autoReplyEnabled: !settings.autoReplyEnabled })}
            label="Auto-reply"
          />
        </div>
        <div className="conn">
          <div className="conn__who">
            <div className="conn__name">Draft only</div>
            <div className="conn__account">Recommended — prepare Gmail drafts; don&apos;t send yet</div>
          </div>
          <Toggle
            checked={settings.draftOnly}
            onChange={() => patch({ draftOnly: !settings.draftOnly })}
            label="Draft only"
          />
        </div>
        <div className="conn">
          <div className="conn__who">
            <div className="conn__name">Lead emails only</div>
            <div className="conn__account">Never reply to ops, title, UW, or vendor senders</div>
          </div>
          <Toggle
            checked={settings.leadOnly}
            onChange={() => patch({ leadOnly: !settings.leadOnly })}
            label="Lead only"
          />
        </div>
        <div className="conn">
          <div className="conn__who">
            <div className="conn__name">Create Follow Up Boss tasks</div>
            <div className="conn__account">Add a task + note on the matched lead</div>
          </div>
          <Toggle
            checked={settings.createFubTasks}
            onChange={() => patch({ createFubTasks: !settings.createFubTasks })}
            label="FUB tasks"
          />
        </div>
        <div className="conn">
          <div className="conn__who">
            <div className="conn__name">Hold Google Calendar slots</div>
            <div className="conn__account">When a lead asks to talk, block 30 minutes tomorrow</div>
          </div>
          <Toggle
            checked={settings.createCalendarEvents}
            onChange={() => patch({ createCalendarEvents: !settings.createCalendarEvents })}
            label="Calendar holds"
          />
        </div>
      </div>

      <div className="eyebrow settings__label">Channels</div>
      <div className="card settings__section">
        {(
          [
            ['gmail', 'Gmail', 'Primary lead inbox'],
            ['neo', 'Neo Mail', 'Forward Neo → Gmail, or set IMAP env vars'],
            ['sms', 'iPhone / Quo SMS', 'Business number in the Quo app on your iPhone'],
          ] as const
        ).map(([key, name, account]) => (
          <div key={key} className="conn">
            <div className="conn__who">
              <div className="conn__name">{name}</div>
              <div className="conn__account">{account}</div>
            </div>
            <Toggle
              checked={settings.channels[key]}
              onChange={() =>
                patch({ channels: { ...settings.channels, [key]: !settings.channels[key] } })
              }
              label={name}
            />
          </div>
        ))}
      </div>

      <div className="eyebrow settings__label">AI model</div>
      <div className="card settings__section">
        <div className="conn">
          <div className="conn__who">
            <div className="conn__name">Reply engine</div>
            <div className="conn__account">
              Grok (xAI) via Netlify AI Gateway / OpenRouter — default for LoanPilot
            </div>
          </div>
        </div>
        <div className="assistant-set__form" style={{ paddingTop: 0 }}>
          <div className="field">
            <span className="mono field__label">Provider</span>
            <div className="chips" role="radiogroup" aria-label="AI provider">
              {(
                [
                  ['grok', 'Grok (xAI)'],
                  ['openai', 'OpenAI'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={(settings.aiProvider ?? 'grok') === value}
                  className={`chip${(settings.aiProvider ?? 'grok') === value ? ' chip--selected' : ''}`}
                  onClick={() =>
                    patch({
                      aiProvider: value,
                      aiModel: value === 'grok' ? 'x-ai/grok-4.5' : 'gpt-4o-mini',
                    })
                  }
                  disabled={pending}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="mono field__label">Model</span>
            <div className="chips" role="radiogroup" aria-label="AI model">
              {((settings.aiProvider ?? 'grok') === 'grok'
                ? [
                    ['x-ai/grok-4.5', 'Grok 4.5'],
                    ['~x-ai/grok-latest', 'Grok latest'],
                  ]
                : [
                    ['gpt-4o-mini', 'GPT-4o mini'],
                    ['gpt-4o', 'GPT-4o'],
                  ]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={(settings.aiModel ?? 'x-ai/grok-4.5') === value}
                  className={`chip${(settings.aiModel ?? 'x-ai/grok-4.5') === value ? ' chip--selected' : ''}`}
                  onClick={() => patch({ aiModel: value })}
                  disabled={pending}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="card-footer">
          After the first Netlify production deploy, AI Gateway injects OpenRouter credentials for
          Grok — no xAI API key to manage.
        </div>
      </div>

      <div className="eyebrow settings__label">Identity &amp; voice</div>
      <div className="card settings__section assistant-set__form">
        <label className="field">
          <span className="mono field__label">Loan officer name</span>
          <input
            value={settings.loanOfficerName}
            onChange={(e) => setSettings({ ...settings, loanOfficerName: e.target.value })}
            onBlur={() => patch({ loanOfficerName: settings.loanOfficerName })}
          />
        </label>
        <label className="field">
          <span className="mono field__label">Company</span>
          <input
            value={settings.companyName}
            onChange={(e) => setSettings({ ...settings, companyName: e.target.value })}
            onBlur={() => patch({ companyName: settings.companyName })}
          />
        </label>
        <label className="field">
          <span className="mono field__label">NMLS (optional)</span>
          <input
            value={settings.nmls ?? ''}
            onChange={(e) => setSettings({ ...settings, nmls: e.target.value })}
            onBlur={() => patch({ nmls: settings.nmls })}
          />
        </label>
        <label className="field">
          <span className="mono field__label">Unavailable line</span>
          <textarea
            rows={3}
            value={settings.unavailableMessage}
            onChange={(e) => setSettings({ ...settings, unavailableMessage: e.target.value })}
            onBlur={() => patch({ unavailableMessage: settings.unavailableMessage })}
          />
        </label>
        <div className="field">
          <span className="mono field__label">Tone</span>
          <div className="chips" role="radiogroup" aria-label="Tone">
            {(
              [
                ['warm_professional', 'Warm professional'],
                ['brief', 'Brief'],
                ['friendly', 'Friendly'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={settings.tone === value}
                className={`chip${settings.tone === value ? ' chip--selected' : ''}`}
                onClick={() => patch({ tone: value })}
                disabled={pending}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="eyebrow settings__label" id="google-connect">Google Calendar &amp; Tasks</div>
      <div className="card settings__section">
        <p className="assistant-set__env">
          The Settings toggle only flipped a local demo switch before — that is why Google looked
          connected but never synced. Use OAuth from the Hub (or set client credentials below).
        </p>
        <ol className="assistant-set__keys" style={{ listStyle: 'decimal' }}>
          <li>In Google Cloud Console, create an OAuth <strong>Web</strong> client</li>
          <li>Enable <strong>Google Calendar API</strong> and <strong>Google Tasks API</strong></li>
          <li>
            Add authorized redirect URI:{' '}
            <span className="mono">https://YOUR_DOMAIN/api/google/callback</span>
            {' '}(local: <span className="mono">http://localhost:5173/api/google/callback</span>)
          </li>
          <li>
            Set Netlify env vars <span className="mono">GOOGLE_CLIENT_ID</span> and{' '}
            <span className="mono">GOOGLE_CLIENT_SECRET</span>, then redeploy
          </li>
          <li>
            Open the Hub and click <strong>Connect Google Calendar</strong>
          </li>
        </ol>
        <div className="card-footer">
          <a className="btn btn--primary" href="/api/google/connect">
            Connect Google Calendar
          </a>
          {' '}
          <a className="btn" href="/hub">
            Back to Hub
          </a>
        </div>
      </div>

      <div className="eyebrow settings__label">Environment keys</div>
      <div className="card settings__section">
        <p className="assistant-set__env">
          Set these in Netlify (Site settings → Environment variables). Demo mode runs without them.
        </p>
        <ul className="assistant-set__keys mono">
          <li>FOLLOW_UP_BOSS_API_KEY</li>
          <li>FOLLOW_UP_BOSS_USER_ID</li>
          <li>GMAIL_ACCESS_TOKEN</li>
          <li>GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI</li>
          <li>GOOGLE_CALENDAR_ID=primary · GOOGLE_TASKS_LIST_ID=@default</li>
          <li>LOANPILOT_API_KEY (public /api/v1; demo-key while ASSISTANT_DEMO_MODE=true)</li>
          <li>QUO_API_KEY / QUO_FROM_NUMBER / QUO_WEBHOOK_SECRET</li>
          <li>NEO_IMAP_HOST / NEO_IMAP_USER / NEO_IMAP_PASSWORD (optional)</li>
          <li>ASSISTANT_DEMO_MODE=false when going live</li>
          <li>ASSISTANT_MODEL=x-ai/grok-4.5 (Grok via OpenRouter / AI Gateway)</li>
        </ul>
        <div className="card-footer">
          iMessage itself has no public API — Quo (OpenPhone) gives you a business SMS line that
          syncs to your iPhone so LoanPilot can answer texts the same way it answers email. Grok
          replies activate after your first Netlify production deploy with AI Gateway enabled.
        </div>
      </div>
    </div>
  )
}
