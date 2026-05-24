export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function cleanRequiredString(value: unknown, field: string): string {
  const trimmed = cleanString(value)
  if (!trimmed) throw new Error(`${field} is required`)
  return trimmed
}

export function enumValue<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number], field: string): T[number] {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T[number]
  throw new Error(`Invalid ${field}; expected one of ${allowed.join(' | ')}`)
}

export function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    const trimmed = cleanString(item)
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
      result.push(trimmed)
    }
  }
  return result
}

export function cleanHttpUrl(value: unknown, field: string): string | null {
  const trimmed = cleanString(value)
  if (!trimmed) return null
  let parsed: URL
  try { parsed = new URL(trimmed) } catch { throw new Error(`${field} must be an http(s) URL`) }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error(`${field} must be an http(s) URL`)
  return trimmed
}

export function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function cleanIsoString(value: unknown, field: string): string | null {
  const trimmed = cleanString(value)
  if (!trimmed) return null
  if (!Number.isFinite(Date.parse(trimmed))) throw new Error(`${field} must be an ISO date string`)
  return trimmed
}

export function assertNoRawSecrets(input: unknown): void {
  const forbidden = new Set(['clientSecret', 'client_secret', 'refreshToken', 'refresh_token', 'accessToken', 'access_token', 'privateKey', 'private_key', 'serviceAccountJson', 'keyJson', 'password', 'secret'])
  const visit = (value: unknown, path: string[] = []) => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (forbidden.has(key)) throw new Error(`raw secrets are not allowed in workspace connection registry (${[...path, key].join('.')})`)
      visit(child, [...path, key])
    }
  }
  visit(input)
}
