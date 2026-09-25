/** Read env vars — prefer Netlify.env in deployed functions when available. */
export function env(key: string, fallback = ''): string {
  try {
    const netlifyEnv = (globalThis as { Netlify?: { env?: { get?: (k: string) => string | undefined } } }).Netlify?.env
    const fromNetlify = netlifyEnv?.get?.(key)
    if (fromNetlify != null && fromNetlify !== '') return fromNetlify
  } catch {
    /* local / test */
  }
  return process.env[key] ?? fallback
}

export function isDemoMode(): boolean {
  return env('ASSISTANT_DEMO_MODE', 'true') === 'true' || !env('FOLLOW_UP_BOSS_API_KEY')
}
