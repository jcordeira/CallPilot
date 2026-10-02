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

/** Default on. Set NEO_ENABLED=false (or 0 / off) to skip Neo entirely. */
export function neoEnabled(): boolean {
  const raw = env('NEO_ENABLED', 'true').trim().toLowerCase()
  return raw !== 'false' && raw !== '0' && raw !== 'off' && raw !== ''
}

/** Demo stub when Neo is enabled. Live mode returns nothing until IMAP is actually wired. */
export async function fetchNeoUnread(): Promise<NeoMessage[]> {
  if (!neoEnabled()) return []
  if (isDemoMode()) {
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
  if (!neoConfigured()) return []
  // Production IMAP wiring is intentionally behind NEO_IMAP_* env vars.
  // Until imapflow is added in a follow-up, return empty rather than fake-processing.
  return []
}

export async function sendNeoReply(_input: {
  to: string
  subject: string
  body: string
}): Promise<{ id: string }> {
  if (isDemoMode()) return { id: `neo-draft-${Date.now()}` }
  throw new Error('Neo SMTP send not configured — set NEO_SMTP_HOST or forward Neo to Gmail')
}
