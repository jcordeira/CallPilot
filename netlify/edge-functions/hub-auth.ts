const COOKIE = 'lp_hub'

function envValue(name: string): string {
  try {
    return Netlify.env.get(name) ?? ''
  } catch {
    return ''
  }
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let raw = ''
  for (const byte of bytes) raw += String.fromCharCode(byte)
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sessionValid(token: string | null): Promise<boolean> {
  const password = envValue('HUB_PASSWORD')
  const secret = envValue('HUB_SESSION_SECRET') || password
  if (!token || !password || !secret) return false
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return false
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const exp = Number(payload)
  if (!Number.isFinite(exp) || exp <= Date.now()) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))
  const expected = bytesToBase64Url(mac)
  if (expected.length !== sig.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i)
  return diff === 0
}

function hasApiKey(req: Request): boolean {
  const header = req.headers.get('authorization') ?? ''
  if (/^bearer\s+\S+/i.test(header)) return true
  return Boolean(req.headers.get('x-api-key'))
}

export default async (req: Request, context: { next: () => Promise<Response> }) => {
  const url = new URL(req.url)
  const path = url.pathname
  if (path.startsWith('/api/v1') && hasApiKey(req)) return context.next()
  const ok = await sessionValid(readCookie(req.headers.get('cookie'), COOKIE))
  if (ok) return context.next()
  if (path.startsWith('/api/')) {
    const passwordSet = Boolean(envValue('HUB_PASSWORD'))
    return new Response(JSON.stringify({ ok: false, error: passwordSet ? 'Sign in required' : 'Set HUB_PASSWORD before using the Hub' }), {
      status: passwordSet ? 401 : 503,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    })
  }
  return Response.redirect(new URL('/login', url.origin), 302)
}

export const config = {
  path: ['/hub', '/hub/*', '/calendar', '/calendar/*', '/assistant', '/assistant/*', '/api/*'],
  excludedPath: ['/api/webhooks/*', '/api/google/callback', '/api/auth', '/api/auth/*'],
}
