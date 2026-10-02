import type { Config, Context } from '@netlify/functions'
import { apiKeyIsValid, extractApiKey } from './_shared/apiAuth'
import { env, isDemoMode } from './_shared/env'
import {
  GOOGLE_OAUTH_COOKIE,
  buildGoogleAuthUrl,
  clearGoogleOAuthCookie,
  clearGoogleTokens,
  exchangeGoogleCode,
  getGoogleConnectionStatus,
  googleOAuthConfigured,
  googleOAuthCookie,
  googleOAuthState,
  googleOAuthStateFresh,
  oauthStatesMatch,
  readCookie,
  saveGoogleTokens,
} from './_shared/googleAuth'
import { requireHubSession } from './_shared/hubSession'
import { jsonFail, jsonOk } from './_shared/http'

function requestIsSecure(req: Request): boolean {
  return new URL(req.url).protocol === 'https:'
}

function hubRedirect(req: Request, query: Record<string, string>, setCookie?: string): Response {
  const origin = new URL(req.url).origin
  const params = new URLSearchParams(query)
  const headers = new Headers({ Location: `${origin}/hub?${params}` })
  if (setCookie) headers.set('Set-Cookie', setCookie)
  return new Response(null, { status: 302, headers })
}

/** Browser disconnects must be same-origin. Scripts may send LOANPILOT_API_KEY instead. */
export function disconnectAuthorized(req: Request): boolean {
  if (apiKeyIsValid(extractApiKey(req.headers), env('LOANPILOT_API_KEY'), isDemoMode())) return true
  if (req.headers.get('sec-fetch-site') === 'same-origin') return true
  const origin = req.headers.get('origin')
  if (!origin) return false
  try {
    return new URL(origin).origin === new URL(req.url).origin
  } catch {
    return false
  }
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url)
  const action = context.params?.action ?? url.pathname.split('/').filter(Boolean).pop()
  if (action !== 'callback' && !apiKeyIsValid(extractApiKey(req.headers), env('LOANPILOT_API_KEY'), isDemoMode())) {
    const denied = requireHubSession(req)
    if (denied) return denied
  }

  if (action === 'status' && req.method === 'GET') {
    return jsonOk(await getGoogleConnectionStatus())
  }

  if (action === 'connect' && req.method === 'GET') {
    if (!googleOAuthConfigured()) {
      return jsonFail(
        'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Netlify env vars.',
        503,
      )
    }
    const state = googleOAuthState()
    const headers = new Headers({
      Location: buildGoogleAuthUrl(state, req.url),
      'Set-Cookie': googleOAuthCookie(state, requestIsSecure(req)),
    })
    return new Response(null, { status: 302, headers })
  }

  if (action === 'callback' && req.method === 'GET') {
    const secure = requestIsSecure(req)
    const clear = clearGoogleOAuthCookie(secure)
    const error = url.searchParams.get('error')
    if (error) return hubRedirect(req, { google: 'error', reason: error }, clear)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const cookie = readCookie(req.headers.get('cookie'), GOOGLE_OAUTH_COOKIE)
    if (!code) return hubRedirect(req, { google: 'error', reason: 'missing_code' }, clear)
    if (!state || !googleOAuthStateFresh(state) || !oauthStatesMatch(cookie, state)) {
      return hubRedirect(req, { google: 'error', reason: 'state' }, clear)
    }
    try {
      const tokens = await exchangeGoogleCode(code, req.url)
      await saveGoogleTokens(tokens)
      return hubRedirect(req, { google: 'connected' }, clear)
    } catch (err) {
      const reason = err instanceof Error ? err.message.slice(0, 80) : 'token_exchange_failed'
      return hubRedirect(req, { google: 'error', reason }, clear)
    }
  }

  if (action === 'disconnect' && req.method === 'POST') {
    if (!disconnectAuthorized(req)) return jsonFail('Unauthorized', 401)
    await clearGoogleTokens()
    return jsonOk({ connected: false })
  }

  return jsonFail('Unknown action', 404)
}

export const config: Config = {
  path: '/api/google/:action',
  method: ['GET', 'POST'],
}
