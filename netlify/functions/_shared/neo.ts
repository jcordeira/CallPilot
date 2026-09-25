import { env, isDemoMode } from './env'

/**
 * Neo Mail (neo.space) does not expose a first-class public API for assistants.
 * Supported path: forward Neo → Gmail (recommended), or IMAP poll with app password.
 */
export type NeoMessage = {
  id: string
  from: string
  subject: string
  body: string
  date: string
}

export function neoConfigured(): boolean {
  return Boolean(env('NEO_IMAP_HOST') && env('NEO_IMAP_USER') && env('NEO_IMAP_PASSWORD'))
}

/** Demo / stub fetch. Wire a real IMAP client (e.g. imapflow) when credentials exist. */
export async function fetchNeoUnread(): Promise<NeoMessage[]> {
  if (!neoConfigured() || isDemoMode()) {
    if (!env('NEO_ENABLED', 'true')) return []
    return [
      {
        id: 'neo-demo-1',
        from: 'Jordan Lead <jordan.lead@yahoo.com>',
        subject: 'Can we schedule a call about refinancing?',
        body: 'Hi, I saw your site and want to refinance in the next month. Are you free Thursday afternoon?',
        date: new Date().toISOString(),
      },
    ]
  }
  // Production IMAP wiring is intentionally behind NEO_IMAP_* env vars.
  // Until imapflow is added in a follow-up, return empty rather than fake-processing.
  return []
}

export async function sendNeoReply(_input: {
  to: string
  subject: string
  body: string
}): Promise<{ id: string }> {
  if (isDemoMode() || !neoConfigured()) {
    return { id: `neo-draft-${Date.now()}` }
  }
  throw new Error('Neo SMTP send not configured — set NEO_SMTP_HOST or forward Neo to Gmail')
}
