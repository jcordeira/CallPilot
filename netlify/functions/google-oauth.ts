import type { Config, Context } from '@netlify/functions'
import {
  buildGoogleAuthUrl,
  clearGoogleTokens,
  exchangeGoogleCode,
  getGoogleConnectionStatus,
  googleOAuthConfigured,
  saveGoogleTokens,
} from './_shared/googleAuth'
import { jsonFail, jsonOk } from './_shared/http'

function hubRedirect(req: Request, query: Record<string, string>): Response {
  const origin = new URL(req.url).origin
  const params = new URLSearchParams(query)
  return Response.redirect(`${origin}/hub?${params}`, 302)
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url)
  const action = context.params?.action ?? url.pathname.split('/').filter(Boolean).pop()

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
    const state = crypto.randomUUID()
    // Soft cookie-less state: encode timestamp; production can store state in Blobs if needed.
    const authUrl = buildGoogleAuthUrl(`${state}.${Date.now()}`, req.url)
    return Response.redirect(authUrl, 302)
  }

  if (action === 'callback' && req.method === 'GET') {
    const error = url.searchParams.get('error')
    if (error) return hubRedirect(req, { google: 'error', reason: error })
    const code = url.searchParams.get('code')
    if (!code) return hubRedirect(req, { google: 'error', reason: 'missing_code' })
    try {
      const tokens = await exchangeGoogleCode(code, req.url)
      await saveGoogleTokens(tokens)
      return hubRedirect(req, { google: 'connected' })
    } catch (err) {
      const reason = err instanceof Error ? err.message.slice(0, 80) : 'token_exchange_failed'
      return hubRedirect(req, { google: 'error', reason })
    }
  }

  if (action === 'disconnect' && req.method === 'POST') {
    await clearGoogleTokens()
    return jsonOk({ connected: false })
  }

  return jsonFail('Unknown action', 404)
}

export const config: Config = {
  path: '/api/google/:action',
  method: ['GET', 'POST'],
}
