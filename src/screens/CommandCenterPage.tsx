import { useEffect, useRef, useState } from 'react'
import {
  fetchCommandCenter,
  fetchContactMessages,
  postCommandCenter,
  searchMessageLeads,
  sendHubText,
  type CommandCenter,
  type CommandPendingPrompt,
  type MessageLead,
  type QuoHistoryMessage,
} from '../lib/hubApi'
import './CommandCenterPage.css'

type Contact = { name: string; phone: string; kind: 'team' | 'lead' }

function RichText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g)
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith('http') ? (
          <a key={index} href={part} target="_blank" rel="noreferrer">
            {part}
          </a>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  )
}

function sourceLabel(source: 'hub' | 'sms'): string {
  return source === 'hub' ? 'Hub' : 'SMS'
}

export function CommandCenterPage() {
  const [center, setCenter] = useState<CommandCenter | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [contact, setContact] = useState<Contact | null>(null)
  const [leadQuery, setLeadQuery] = useState('')
  const [leads, setLeads] = useState<MessageLead[]>([])
  const [history, setHistory] = useState<QuoHistoryMessage[]>([])
  const [historyNote, setHistoryNote] = useState<string | null>(null)
  const [textDraft, setTextDraft] = useState('')
  const [confirmLead, setConfirmLead] = useState<string | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)

  const load = async () => {
    const next = await fetchCommandCenter()
    setCenter(next)
    return next
  }

  useEffect(() => {
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load Command Center'))
  }, [])

  useEffect(() => {
    const node = threadRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [center?.thread, center?.pending])

  const run = async (input: { text?: string; choice?: string }) => {
    setBusy(true)
    setError(null)
    try {
      const next = await postCommandCenter(input)
      setCenter(next)
      if (next.error) setError(next.error)
      if (input.text) setDraft('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Command failed')
    } finally {
      setBusy(false)
    }
  }

  const openContact = async (next: Contact) => {
    setContact(next)
    setConfirmLead(null)
    setHistoryNote(null)
    try {
      const data = await fetchContactMessages(next.phone)
      setHistory(data.messages)
      setHistoryNote(data.quoError ?? null)
    } catch (err) {
      setHistory([])
      setHistoryNote(err instanceof Error ? err.message : 'Could not load messages')
    }
  }

  const onSearchLeads = async () => {
    const q = leadQuery.trim()
    if (q.length < 2) return
    setBusy(true)
    try {
      const data = await searchMessageLeads(q)
      setLeads(data.leads)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not search leads')
    } finally {
      setBusy(false)
    }
  }

  const onSendText = async (confirmed = false) => {
    if (!contact || !textDraft.trim()) return
    setBusy(true)
    setError(null)
    try {
      const result = await sendHubText({
        to: contact.phone,
        name: contact.name,
        content: textDraft.trim(),
        kind: contact.kind,
        confirmed,
      })
      if (result.needsConfirm) {
        setConfirmLead(result.preview || `Text ${contact.name}?`)
        return
      }
      if (result.error || result.sent === false) {
        setError(result.error || 'Text was not sent')
        return
      }
      setTextDraft('')
      setConfirmLead(null)
      const data = await fetchContactMessages(contact.phone)
      setHistory(data.messages)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the text')
    } finally {
      setBusy(false)
    }
  }

  const pending: CommandPendingPrompt | null = center?.pending ?? null

  return (
    <div className="page cc">
      <header className="cc__head">
        <h1 className="page-title">Command Center</h1>
        <p className="cc__lede">
          Same commands as texting the Sales line{center?.dryRun ? '. Dry run is on, so nothing is booked or sent yet.' : '.'}
        </p>
      </header>
      {error && <p className="cc__error" role="status">{error}</p>}
      <div className="cc__layout">
        <section className="cc__chat card" aria-label="Command thread">
          <div className="cc__thread" ref={threadRef}>
            {!center ? (
              <p className="cc__empty">Loading…</p>
            ) : center.thread.length === 0 ? (
              <p className="cc__empty">No commands yet. Try a chip or type what you want done.</p>
            ) : (
              center.thread.map((item) => (
                <div key={item.id} className="cc__turn">
                  <div className="cc__bubble cc__bubble--user">
                    <div className="cc__meta">
                      <span>{item.actor}</span>
                      <span className="cc__source">{sourceLabel(item.source)}</span>
                    </div>
                    <p><RichText text={item.command} /></p>
                  </div>
                  <div className="cc__bubble cc__bubble--bot">
                    <div className="cc__meta"><span>LoanPilot</span></div>
                    <p><RichText text={item.reply} /></p>
                  </div>
                </div>
              ))
            )}
          </div>
          {pending && (
            <div className="cc__pending" role="group" aria-label={pending.summary}>
              <p>{pending.summary}</p>
              {pending.kind === 'choice' ? (
                <div className="cc__choices">
                  {pending.choices.map((choice) => (
                    <button key={choice.n} type="button" className="btn" disabled={busy} onClick={() => void run({ choice: String(choice.n) })}>
                      {choice.n}. {choice.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="cc__choices">
                  <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void run({ choice: 'YES' })}>
                    Confirm
                  </button>
                  <button type="button" className="btn" disabled={busy} onClick={() => void run({ choice: 'NO' })}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="cc__chips" aria-label="Quick actions">
            {(center?.chips ?? []).map((chip) => (
              <button
                key={chip.label}
                type="button"
                className="cc__chip"
                disabled={busy}
                onClick={() => {
                  if (chip.send) void run({ text: chip.text })
                  else setDraft(chip.text)
                }}
              >
                {chip.label}
              </button>
            ))}
          </div>
          <form
            className="cc__composer"
            onSubmit={(event) => {
              event.preventDefault()
              if (draft.trim()) void run({ text: draft.trim() })
            }}
          >
            <label className="sr-only" htmlFor="command-draft">Command</label>
            <input
              id="command-draft"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Book Siddick tomorrow 2pm refi"
              autoComplete="off"
              enterKeyHint="send"
            />
            <button type="submit" className="btn btn--primary" disabled={busy || !draft.trim()}>
              {busy ? '…' : 'Send'}
            </button>
          </form>
        </section>
        <section className="cc__messages card" aria-label="Messages">
          <h2>Messages</h2>
          <p className="cc__help">Text the team now. Texting a lead waits for Confirm.</p>
          <div className="cc__team" aria-label="Team">
            {(center?.team ?? []).map((member) => (
              <button
                key={member.phone}
                type="button"
                className={`cc__chip${contact?.phone === member.phone ? ' cc__chip--on' : ''}`}
                onClick={() => void openContact({ name: member.name, phone: member.phone, kind: 'team' })}
              >
                {member.name.split(' ')[0]}
              </button>
            ))}
          </div>
          <form
            className="cc__search"
            onSubmit={(event) => {
              event.preventDefault()
              void onSearchLeads()
            }}
          >
            <label className="sr-only" htmlFor="lead-search">Search leads</label>
            <input
              id="lead-search"
              value={leadQuery}
              onChange={(event) => setLeadQuery(event.target.value)}
              placeholder="Search a lead"
              autoComplete="off"
            />
            <button type="submit" className="btn" disabled={busy || leadQuery.trim().length < 2}>Search</button>
          </form>
          {leads.length > 0 && (
            <ul className="cc__leads">
              {leads.map((lead) => (
                <li key={lead.id}>
                  <button
                    type="button"
                    disabled={!lead.phone}
                    onClick={() => lead.phone && void openContact({ name: lead.name, phone: lead.phone, kind: 'lead' })}
                  >
                    {lead.name}
                    {lead.phone ? '' : ' · no mobile'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {contact && (
            <>
              <h3>{contact.name}</h3>
              <div className="cc__history" aria-label={`Texts with ${contact.name}`}>
                {history.length === 0 ? <p className="cc__empty">No texts yet.</p> : history.map((item) => (
                  <p key={item.id} className={`cc__sms cc__sms--${item.direction}`}>
                    <RichText text={item.text} />
                  </p>
                ))}
              </div>
              {historyNote && <p className="cc__help">{historyNote}</p>}
              {confirmLead && (
                <div className="cc__pending" role="group" aria-label="Confirm client text">
                  <p>{confirmLead}</p>
                  <div className="cc__choices">
                    <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void onSendText(true)}>Confirm</button>
                    <button type="button" className="btn" disabled={busy} onClick={() => setConfirmLead(null)}>Cancel</button>
                  </div>
                </div>
              )}
              <form
                className="cc__composer"
                onSubmit={(event) => {
                  event.preventDefault()
                  void onSendText(false)
                }}
              >
                <label className="sr-only" htmlFor="text-draft">Message</label>
                <input
                  id="text-draft"
                  value={textDraft}
                  onChange={(event) => setTextDraft(event.target.value)}
                  placeholder={contact.kind === 'lead' ? `Text ${contact.name}` : `Text ${contact.name.split(' ')[0]}`}
                  autoComplete="off"
                  enterKeyHint="send"
                />
                <button type="submit" className="btn btn--primary" disabled={busy || !textDraft.trim()}>Send</button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
