import type { Config, Context } from '@netlify/functions'
import { apiKeyIsValid, extractApiKey } from './_shared/apiAuth'
import { env, isDemoMode } from './_shared/env'
import { listGoogleTasks, listUpcomingEvents } from './_shared/calendar'
import { listOpenFubTasks } from './_shared/followupboss'
import { createHubEvent, createHubTask, eventInputFromBody, taskInputFromBody } from './_shared/hub'
import { PUBLIC_CORS, errorResponse, jsonFail, jsonOk, optionalString, readJson } from './_shared/http'
import { processIncomingMessage } from './_shared/pipeline'
import { listActivity, loadSettings } from './_shared/store'
import type { Channel, IncomingMessage } from './_shared/types'

function authorized(req: Request): boolean {
  return apiKeyIsValid(extractApiKey(req.headers), env('LOANPILOT_API_KEY'), isDemoMode())
}

function v1Path(url: URL): string {
  const pathname = url.pathname.replace(/\/+$/, '') || '/'
  const marker = '/api/v1'
  const idx = pathname.indexOf(marker)
  if (idx === -1) return '/'
  const rest = pathname.slice(idx + marker.length)
  return rest || '/'
}

const ROUTES: Record<string, string[]> = {
  '/health': ['GET'],
  '/activity': ['GET'],
  '/calendar/events': ['GET', 'POST'],
  '/tasks': ['GET', 'POST'],
  '/messages/preview': ['POST'],
}

function clampLimit(raw: string | null, fallback: number): number {
  const n = Number(raw ?? fallback)
  if (!Number.isFinite(n)) return fallback
  return Math.min(100, Math.max(1, Math.floor(n)))
}

export default async (req: Request, context: Context) => {
  void context.requestId
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: PUBLIC_CORS })
  if (!authorized(req)) return jsonFail('Unauthorized', 401, PUBLIC_CORS)

  const url = new URL(req.url)
  const path = v1Path(url)
  const allowed = ROUTES[path]
  if (!allowed) return jsonFail('Not found', 404, PUBLIC_CORS)
  if (!allowed.includes(req.method)) return jsonFail('Method not allowed', 405, PUBLIC_CORS)

  try {
    if (path === '/health') {
      const settings = await loadSettings()
      return jsonOk(
        {
          service: 'loanpilot',
          version: 'v1',
          demo: isDemoMode(),
          aiProvider: settings.aiProvider,
          aiModel: settings.aiModel,
        },
        200,
        PUBLIC_CORS,
      )
    }

    if (path === '/activity') {
      const items = await listActivity(clampLimit(url.searchParams.get('limit'), 40))
      return jsonOk({ items }, 200, PUBLIC_CORS)
    }

    if (path === '/calendar/events' && req.method === 'GET') {
      const days = clampLimit(url.searchParams.get('days'), 7)
      const result = await listUpcomingEvents(days)
      return jsonOk(result, 200, PUBLIC_CORS)
    }

    if (path === '/calendar/events' && req.method === 'POST') {
      const created = await createHubEvent(eventInputFromBody(await readJson(req)))
      return jsonOk(created, 201, PUBLIC_CORS)
    }

    if (path === '/tasks' && req.method === 'GET') {
      const [google, fub] = await Promise.all([listGoogleTasks(), listOpenFubTasks()])
      return jsonOk(
        {
          tasks: [...google.tasks, ...fub],
          demo: google.demo || isDemoMode(),
        },
        200,
        PUBLIC_CORS,
      )
    }

    if (path === '/tasks' && req.method === 'POST') {
      const created = await createHubTask(taskInputFromBody(await readJson(req)))
      return jsonOk(created, 201, PUBLIC_CORS)
    }

    if (path === '/messages/preview') {
      const body = await readJson(req)
      const text = optionalString(body, 'body')?.trim()
      if (!text) return jsonFail('body is required', 400, PUBLIC_CORS)
      const channelRaw = optionalString(body, 'channel') ?? 'gmail'
      if (channelRaw !== 'gmail' && channelRaw !== 'neo' && channelRaw !== 'sms') {
        return jsonFail('channel must be gmail, neo, or sms', 400, PUBLIC_CORS)
      }
      const channel = channelRaw as Channel
      const settings = await loadSettings()
      const message: IncomingMessage = {
        id: `preview-${Date.now()}`,
        channel,
        fromEmail: optionalString(body, 'fromEmail') ?? 'lead@example.com',
        fromName: optionalString(body, 'fromName') ?? 'Sample Lead',
        fromPhone: optionalString(body, 'fromPhone'),
        subject: optionalString(body, 'subject') ?? 'Preview',
        body: text,
        receivedAt: new Date().toISOString(),
      }
      const result = await processIncomingMessage(message, { ...settings, draftOnly: true })
      return jsonOk(
        {
          activity: result.activity,
          replyBody: result.replyBody ?? null,
          draftOnly: true,
        },
        200,
        PUBLIC_CORS,
      )
    }

    return jsonFail('Not found', 404, PUBLIC_CORS)
  } catch (err) {
    return errorResponse(err, PUBLIC_CORS)
  }
}

export const config: Config = {
  path: '/api/v1/*',
}
