import { listUnreadLeadCandidates, parseFromHeader } from './gmail'
import { fetchNeoUnread } from './neo'
import { processIncomingMessage } from './pipeline'
import { loadSettings } from './store'
import type { IncomingMessage } from './types'
import type { ProcessResult } from './pipeline'

export async function sweepInboxes(): Promise<ProcessResult[]> {
  const settings = await loadSettings()
  const results: ProcessResult[] = []

  if (settings.channels.gmail) {
    const threads = await listUnreadLeadCandidates(8)
    for (const t of threads) {
      const { name, email } = parseFromHeader(t.from)
      const message: IncomingMessage = {
        id: t.messageId,
        channel: 'gmail',
        threadId: t.id,
        fromEmail: email,
        fromName: name,
        subject: t.subject,
        body: t.snippet,
        receivedAt: new Date().toISOString(),
      }
      results.push(await processIncomingMessage(message, settings))
    }
  }

  if (settings.channels.neo) {
    const neoMail = await fetchNeoUnread()
    for (const m of neoMail) {
      const { name, email } = parseFromHeader(m.from)
      const message: IncomingMessage = {
        id: m.id,
        channel: 'neo',
        fromEmail: email,
        fromName: name,
        subject: m.subject,
        body: m.body,
        receivedAt: m.date,
      }
      results.push(await processIncomingMessage(message, settings))
    }
  }

  return results
}
