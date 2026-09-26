import { env, isDemoMode } from './env'

export type GmailThreadSummary = {
  id: string
  subject: string
  snippet: string
  from: string
  messageId: string
}

/** Lightweight Gmail REST helpers using a user OAuth access token. */
async function gmail(path: string, init?: RequestInit) {
  const token = env('GMAIL_ACCESS_TOKEN')
  if (!token) throw new Error('GMAIL_ACCESS_TOKEN is not set')
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    throw new Error(`Gmail API ${path}: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

function encodeRawEmail(headers: Record<string, string>, body: string): string {
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`)
  const raw = `${lines.join('\r\n')}\r\n\r\n${body}`
  return Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function listUnreadLeadCandidates(max = 10): Promise<GmailThreadSummary[]> {
  if (isDemoMode() || !env('GMAIL_ACCESS_TOKEN')) {
    return [
      {
        id: 'demo-thread-1',
        messageId: 'demo-msg-1',
        subject: 'Question about pre-approval documents',
        snippet: 'Hi, what documents do I need for a pre-approval?',
        from: 'Alex Buyer <alex.buyer@gmail.com>',
      },
      {
        id: 'demo-thread-2',
        messageId: 'demo-msg-2',
        subject: 'UW condition update — file 55421',
        snippet: 'Conditions cleared for appraisal review',
        from: 'Ops Desk <ops@underwriting.example.com>',
      },
    ]
  }

  const q = encodeURIComponent('is:unread in:inbox -category:promotions -category:social newer_than:2d')
  const list = (await gmail(`threads?q=${q}&maxResults=${max}`)) as { threads?: { id: string }[] }
  const out: GmailThreadSummary[] = []
  for (const t of list.threads ?? []) {
    const full = (await gmail(`threads/${t.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`)) as {
      id: string
      snippet?: string
      messages?: { id: string; payload?: { headers?: { name: string; value: string }[] } }[]
    }
    const last = full.messages?.[full.messages.length - 1]
    const headers = last?.payload?.headers ?? []
    const from = headers.find((h) => h.name.toLowerCase() === 'from')?.value ?? ''
    const subject = headers.find((h) => h.name.toLowerCase() === 'subject')?.value ?? '(no subject)'
    out.push({
      id: full.id,
      messageId: last?.id ?? full.id,
      subject,
      snippet: full.snippet ?? '',
      from,
    })
  }
  return out
}

export async function createDraftReply(input: {
  to: string
  subject: string
  body: string
  threadId: string
}): Promise<{ id: string }> {
  if (isDemoMode() || !env('GMAIL_ACCESS_TOKEN')) {
    return { id: `draft-demo-${Date.now()}` }
  }
  const raw = encodeRawEmail(
    {
      To: input.to,
      Subject: input.subject.startsWith('Re:') ? input.subject : `Re: ${input.subject}`,
      'Content-Type': 'text/plain; charset="UTF-8"',
    },
    input.body,
  )
  const data = (await gmail('drafts', {
    method: 'POST',
    body: JSON.stringify({ message: { raw, threadId: input.threadId } }),
  })) as { id: string }
  return { id: data.id }
}

export async function sendReply(input: {
  to: string
  subject: string
  body: string
  threadId: string
}): Promise<{ id: string }> {
  if (isDemoMode() || !env('GMAIL_ACCESS_TOKEN')) {
    return { id: `sent-demo-${Date.now()}` }
  }
  const raw = encodeRawEmail(
    {
      To: input.to,
      Subject: input.subject.startsWith('Re:') ? input.subject : `Re: ${input.subject}`,
      'Content-Type': 'text/plain; charset="UTF-8"',
    },
    input.body,
  )
  const data = (await gmail('messages/send', {
    method: 'POST',
    body: JSON.stringify({ raw, threadId: input.threadId }),
  })) as { id: string }
  return { id: data.id }
}

export function parseFromHeader(from: string): { name?: string; email?: string } {
  const match = from.match(/^(?:"?([^"<]*)"?\s*)?<?([^>]+@[^>]+)>?$/)
  if (!match) return { name: from, email: undefined }
  return { name: match[1]?.trim() || undefined, email: match[2]?.trim().toLowerCase() }
}
