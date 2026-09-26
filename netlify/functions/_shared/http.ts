export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export const PUBLIC_CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Api-Key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-store',
}

export function jsonOk(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return Response.json(
    { ok: true, data },
    { status, headers: { 'Cache-Control': 'no-store', ...headers } },
  )
}

export function jsonFail(error: string, status: number, headers?: Record<string, string>): Response {
  return Response.json(
    { ok: false, error },
    { status, headers: { 'Cache-Control': 'no-store', ...headers } },
  )
}

export function errorResponse(err: unknown, headers?: Record<string, string>): Response {
  if (err instanceof ApiError) return jsonFail(err.message, err.status, headers)
  const message = err instanceof Error && err.message ? err.message : 'Request failed'
  return jsonFail(message, 502, headers)
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new ApiError(400, 'Invalid JSON body')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'JSON object body is required')
  }
  return body as Record<string, unknown>
}

export function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]
  if (value == null || value === '') return undefined
  if (typeof value !== 'string') throw new ApiError(400, `${key} must be a string`)
  return value
}

export function optionalNumber(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key]
  if (value == null || value === '') return undefined
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(n)) throw new ApiError(400, `${key} must be a number`)
  return n
}
