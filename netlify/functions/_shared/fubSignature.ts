import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from './env'

/**
 * Follow Up Boss signs webhooks with `FUB-Signature`:
 * HMAC-SHA256 (hex) of the base64-encoded raw request body, keyed with the X-System-Key.
 * https://docs.followupboss.com/reference/webhooks-guide
 */
export function fubSignature(rawBody: string, systemKey: string): string {
  const encoded = Buffer.from(rawBody, 'utf8').toString('base64')
  return createHmac('sha256', systemKey).update(encoded).digest('hex')
}

export function secureEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function fubSignatureMatches(rawBody: string, header: string | null, systemKey: string): boolean {
  if (!header || !systemKey) return false
  const expected = fubSignature(rawBody, systemKey)
  return secureEqual(header.trim().toLowerCase(), expected.toLowerCase())
}

/** Off unless explicitly enabled, so existing deliveries keep working. */
export function fubWebhookVerificationEnabled(): boolean {
  const flag = env('FUB_WEBHOOK_VERIFY').trim().toLowerCase()
  if (flag === 'true' || flag === '1' || flag === 'on') return true
  return env('FUB_WEBHOOK_SECRET').trim() !== ''
}
