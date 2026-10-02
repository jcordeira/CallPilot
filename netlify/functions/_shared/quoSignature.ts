import { createHmac, timingSafeEqual } from 'node:crypto'

const MAX_AGE_SECONDS = 5 * 60

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function secretBytes(secret: string): Buffer {
  const trimmed = secret.trim()
  const body = trimmed.startsWith('whsec_') ? trimmed.slice('whsec_'.length) : trimmed
  const decoded = Buffer.from(body, 'base64')
  if (decoded.length > 0 && decoded.toString('base64').replace(/=+$/, '') === body.replace(/=+$/, '')) return decoded
  return Buffer.from(trimmed)
}

/** Current Quo API: HMAC-SHA256 of `{id}.{timestamp}.{rawBody}`, base64, header `v1,<sig>`. */
export function verifyQuoSvixSignature(input: {
  rawBody: string
  webhookId: string
  webhookTimestamp: string
  webhookSignature: string
  secret: string
  now?: Date
}): boolean {
  const timestamp = Number(input.webhookTimestamp)
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000)
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > MAX_AGE_SECONDS) return false
  const expected = createHmac('sha256', secretBytes(input.secret))
    .update(`${input.webhookId}.${input.webhookTimestamp}.${input.rawBody}`)
    .digest('base64')
  const provided = input.webhookSignature
    .split(' ')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const comma = entry.indexOf(',')
      if (comma === -1) return undefined
      const version = entry.slice(0, comma)
      const signature = entry.slice(comma + 1)
      return version === 'v1' ? signature : undefined
    })
    .filter((signature): signature is string => Boolean(signature))
  return provided.some((signature) => safeEqual(signature, expected))
}

/**
 * Older Quo / OpenPhone UI deliveries use `openphone-signature`:
 * `hmac;1;<unix-ms-or-seconds>;<base64>` over `<timestamp>.<rawBody>`.
 */
export function verifyOpenPhoneSignature(input: {
  rawBody: string
  header: string
  secret: string
  now?: Date
}): boolean {
  const fields = input.header.split(';')
  if (fields.length < 4 || fields[0] !== 'hmac') return false
  const timestampRaw = fields[2] ?? ''
  const provided = fields.slice(3).join(';')
  const timestampNum = Number(timestampRaw)
  if (!Number.isFinite(timestampNum)) return false
  const seconds = timestampNum > 10_000_000_000 ? Math.floor(timestampNum / 1000) : timestampNum
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000)
  if (Math.abs(now - seconds) > MAX_AGE_SECONDS) return false
  const expected = createHmac('sha256', secretBytes(input.secret)).update(`${timestampRaw}.${input.rawBody}`).digest('base64')
  return safeEqual(provided, expected)
}

export function verifyQuoWebhook(input: {
  rawBody: string
  secret: string
  webhookId?: string | null
  webhookTimestamp?: string | null
  webhookSignature?: string | null
  openPhoneSignature?: string | null
  now?: Date
}): boolean {
  if (!input.secret.trim()) return false
  if (input.webhookId && input.webhookTimestamp && input.webhookSignature) {
    return verifyQuoSvixSignature({
      rawBody: input.rawBody,
      webhookId: input.webhookId,
      webhookTimestamp: input.webhookTimestamp,
      webhookSignature: input.webhookSignature,
      secret: input.secret,
      now: input.now,
    })
  }
  if (input.openPhoneSignature) {
    return verifyOpenPhoneSignature({
      rawBody: input.rawBody,
      header: input.openPhoneSignature,
      secret: input.secret,
      now: input.now,
    })
  }
  return false
}
