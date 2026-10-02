import type { Config, Context } from '@netlify/functions'
import {
  clearHubSessionCookie,
  hubPassword,
  hubSessionCookie,
  hubSessionFromRequest,
  passwordMatches,
  signHubSession,
} from './_shared/hubSession'
import { jsonFail, jsonOk, readJson } from './_shared/http'

function secure(req: Request): boolean {
  return new URL(req.url).protocol === 'https:'
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url)
  const action = context.params?.action ?? url.pathname.split('/').filter(Boolean).pop()

  if (action === 'session' && req.method === 'GET') {
    return jsonOk({ authenticated: hubSessionFromRequest(req), passwordSet: Boolean(hubPassword()) })
  }

  if (action === 'login' && req.method === 'POST') {
    if (!hubPassword()) return jsonFail('Set HUB_PASSWORD before using the Hub', 503)
    const body = await readJson(req)
    const password = typeof body.password === 'string' ? body.password : ''
    if (!passwordMatches(password)) return jsonFail('Wrong password', 401)
    return jsonOk({ authenticated: true }, 200, { 'Set-Cookie': hubSessionCookie(signHubSession(), secure(req)) })
  }

  if (action === 'logout' && req.method === 'POST') {
    return jsonOk({ authenticated: false }, 200, { 'Set-Cookie': clearHubSessionCookie(secure(req)) })
  }

  return jsonFail('Unknown action', 404)
}

export const config: Config = {
  path: '/api/auth/:action',
  method: ['GET', 'POST'],
}
