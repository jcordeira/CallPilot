/** Pull a key from `Authorization: Bearer …` or `X-Api-Key`. Header lookup is case-insensitive. */
export function extractApiKey(headers: { get(name: string): string | null }): string | null {
  const authorization = headers.get('authorization')
  if (authorization) {
    const match = /^Bearer\s+(\S+)/i.exec(authorization.trim())
    if (match?.[1]) return match[1]
  }
  const apiKey = headers.get('x-api-key')
  if (apiKey?.trim()) return apiKey.trim()
  return null
}

/**
 * `expected` is LOANPILOT_API_KEY. In demo mode, `demo-key` is also accepted.
 * An empty expected key never matches.
 */
export function apiKeyIsValid(provided: string | null, expected: string, demoMode: boolean): boolean {
  if (!provided) return false
  if (expected && provided === expected) return true
  if (demoMode && provided === 'demo-key') return true
  return false
}
