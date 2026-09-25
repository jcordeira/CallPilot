import type { Config, Context } from '@netlify/functions'
import { listActivity, loadSettings, saveSettings } from './_shared/store'
import { processIncomingMessage } from './_shared/pipeline'
import { sweepInboxes } from './_shared/sweep'
import type { AssistantSettings, IncomingMessage } from './_shared/types'
import { DEFAULT_SETTINGS } from './_shared/types'

export default async (req: Request, context: Context) => {
  const url = new URL(req.url)
  const action = context.params.action ?? url.pathname.split('/').pop()

  if (action === 'activity' && req.method === 'GET') {
    const items = await listActivity(Number(url.searchParams.get('limit') ?? 40))
    return Response.json({ items })
  }

  if (action === 'settings' && req.method === 'GET') {
    return Response.json({ settings: await loadSettings() })
  }

  if (action === 'settings' && req.method === 'PUT') {
    const body = (await req.json()) as Partial<AssistantSettings>
    const settings = await saveSettings(body)
    return Response.json({ settings })
  }

  if (action === 'preview' && req.method === 'POST') {
    const body = (await req.json()) as Partial<IncomingMessage> & { body: string }
    const settings = await loadSettings()
    const message: IncomingMessage = {
      id: `preview-${Date.now()}`,
      channel: body.channel ?? 'gmail',
      fromEmail: body.fromEmail ?? 'lead@example.com',
      fromName: body.fromName ?? 'Sample Lead',
      fromPhone: body.fromPhone,
      subject: body.subject ?? 'Preview',
      body: body.body,
      receivedAt: new Date().toISOString(),
    }
    const result = await processIncomingMessage(message, { ...settings, draftOnly: true })
    return Response.json(result)
  }

  if (action === 'run' && req.method === 'POST') {
    const results = await sweepInboxes()
    return Response.json({
      ok: true,
      processed: results.length,
      results: results.map((r) => r.activity),
    })
  }

  if (action === 'defaults' && req.method === 'GET') {
    return Response.json({ settings: DEFAULT_SETTINGS })
  }

  return Response.json({ error: 'Unknown action' }, { status: 404 })
}

export const config: Config = {
  path: '/api/assistant/:action',
  method: ['GET', 'PUT', 'POST'],
}
