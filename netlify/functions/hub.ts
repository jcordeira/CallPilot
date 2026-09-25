import type { Config, Context } from '@netlify/functions'
import { createHubEvent, createHubTask, eventInputFromBody, getHubSummary, taskInputFromBody } from './_shared/hub'
import { errorResponse, jsonFail, jsonOk, readJson } from './_shared/http'

export default async (req: Request, context: Context) => {
  const url = new URL(req.url)
  const action = context.params?.action ?? url.pathname.split('/').filter(Boolean).pop()

  try {
    if (action === 'summary') {
      if (req.method !== 'GET') return jsonFail('Method not allowed', 405)
      return jsonOk(await getHubSummary())
    }
    if (action === 'tasks') {
      if (req.method !== 'POST') return jsonFail('Method not allowed', 405)
      return jsonOk(await createHubTask(taskInputFromBody(await readJson(req))), 201)
    }
    if (action === 'events') {
      if (req.method !== 'POST') return jsonFail('Method not allowed', 405)
      return jsonOk(await createHubEvent(eventInputFromBody(await readJson(req))), 201)
    }
    return jsonFail('Unknown action', 404)
  } catch (err) {
    return errorResponse(err)
  }
}

export const config: Config = {
  path: '/api/hub/:action',
  method: ['GET', 'POST'],
}
