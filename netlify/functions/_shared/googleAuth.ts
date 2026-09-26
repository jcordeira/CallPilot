import { getStore } from '@netlify/blobs'
import { env } from './env'

export type GoogleTokenBundle = {
  accessToken: string
  refreshToken?: string
  expiresAt: number
  scope?: string
  email?: string
  connectedAt: string
}

const memory: { tokens: GoogleTokenBundle | null } = { tokens: null }

function store() {
  try {
    return getStore('loanpilot-google')
  } catch {
    return null
  }
}

export async function loadGoogleTokens(): Promise<GoogleTokenBundle | null> {
  const blob = store()
  if (blob) {
    try {
      const raw = (await blob.get('tokens', { type: 'json' })) as GoogleTokenBundle | null
      if (raw?.accessToken) {
        memory.tokens = raw
        return raw
      }
    } catch {
      /* memory */
    }
  }
  return memory.tokens
}

export async function saveGoogleTokens(tokens: GoogleTokenBundle): Promise<void> {
  memory.tokens = tokens
  const blob = store()
  if (!blob) return
  try {
    await blob.setJSON('tokens', tokens)
  } catch {
    /* memory */
  }
}

export async function clearGoogleTokens(): Promise<void> {
  memory.tokens = null
  const blob = store()
  if (!blob) return
  try {
    await blob.delete('tokens')
  } catch {
    /* ignore */
  }
}

/** Prefer OAuth-connected tokens; fall back to env access token for advanced setups. */
export async function resolveGoogleAccessToken(): Promise<{
  accessToken: string | null
  source: 'oauth' | 'env' | null
  email?: string
}> {
  const stored = await loadGoogleTokens()
  if (stored?.accessToken) {
    if (stored.expiresAt > Date.now() + 60_000) {
      return { accessToken: stored.accessToken, source: 'oauth', email: stored.email }
    }
    if (stored.refreshToken) {
      try {
        const refreshed = await refreshGoogleAccessToken(stored.refreshToken)
        const next: GoogleTokenBundle = {
          ...stored,
          accessToken: refreshed.accessToken,
          expiresAt: refreshed.expiresAt,
          scope: refreshed.scope ?? stored.scope,
        }
        await saveGoogleTokens(next)
        return { accessToken: next.accessToken, source: 'oauth', email: next.email }
      } catch {
        /* fall through to env */
      }
    }
  }

  const envToken = env('GOOGLE_CALENDAR_ACCESS_TOKEN') || env('GOOGLE_TASKS_ACCESS_TOKEN')
  if (envToken) return { accessToken: envToken, source: 'env' }
  return { accessToken: null, source: null }
}

export function googleOAuthConfigured(): boolean {
  return Boolean(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET'))
}

export function googleRedirectUri(reqUrl?: string): string {
  const fromEnv = env('GOOGLE_REDIRECT_URI')
  if (fromEnv) return fromEnv
  if (reqUrl) {
    const origin = new URL(reqUrl).origin
    return `${origin}/api/google/callback`
  }
  const site = env('URL') || env('DEPLOY_PRIME_URL') || 'http://localhost:5173'
  return `${site.replace(/\/$/, '')}/api/google/callback`
}

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
].join(' ')

export function buildGoogleAuthUrl(state: string, reqUrl?: string): string {
  const params = new URLSearchParams({
    client_id: env('GOOGLE_CLIENT_ID'),
    redirect_uri: googleRedirectUri(reqUrl),
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

type TokenResponse = {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope?: string
  token_type?: string
  id_token?: string
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  if (!res.ok) {
    const text = (await res.text()).slice(0, 400)
    throw new Error(`Google token exchange failed: ${res.status} ${text}`)
  }
  return (await res.json()) as TokenResponse
}

export async function exchangeGoogleCode(code: string, reqUrl?: string): Promise<GoogleTokenBundle> {
  const data = await tokenRequest({
    code,
    client_id: env('GOOGLE_CLIENT_ID'),
    client_secret: env('GOOGLE_CLIENT_SECRET'),
    redirect_uri: googleRedirectUri(reqUrl),
    grant_type: 'authorization_code',
  })
  const email = await fetchGoogleEmail(data.access_token, data.id_token)
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    scope: data.scope,
    email,
    connectedAt: new Date().toISOString(),
  }
}

async function refreshGoogleAccessToken(refreshToken: string): Promise<{
  accessToken: string
  expiresAt: number
  scope?: string
}> {
  const data = await tokenRequest({
    refresh_token: refreshToken,
    client_id: env('GOOGLE_CLIENT_ID'),
    client_secret: env('GOOGLE_CLIENT_SECRET'),
    grant_type: 'refresh_token',
  })
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    scope: data.scope,
  }
}

async function fetchGoogleEmail(accessToken: string, idToken?: string): Promise<string | undefined> {
  if (idToken) {
    try {
      const part = idToken.split('.')[1] ?? ''
      const padded = part.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((part.length + 3) % 4)
      const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as { email?: string }
      if (payload.email) return payload.email
    } catch {
      /* userinfo fallback */
    }
  }
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return undefined
    const data = (await res.json()) as { email?: string }
    return data.email
  } catch {
    return undefined
  }
}

export async function getGoogleConnectionStatus(): Promise<{
  configured: boolean
  connected: boolean
  email?: string
  source: 'oauth' | 'env' | null
  expiresAt?: number
  connectedAt?: string
}> {
  const configured = googleOAuthConfigured()
  const stored = await loadGoogleTokens()
  if (stored?.accessToken) {
    return {
      configured,
      connected: true,
      email: stored.email,
      source: 'oauth',
      expiresAt: stored.expiresAt,
      connectedAt: stored.connectedAt,
    }
  }
  if (env('GOOGLE_CALENDAR_ACCESS_TOKEN') || env('GOOGLE_TASKS_ACCESS_TOKEN')) {
    return { configured, connected: true, source: 'env' }
  }
  return { configured, connected: false, source: null }
}
