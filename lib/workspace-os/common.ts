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
  const forbidden = new Set(['clientSecret', 'client_secret', 'refreshToken', 'refresh_token', 'accessToken', 'access_token', 'privateKey', 'private_key', 'serviceAccountJson', 'keyJson', 'credentialsPath', 'credentials_path', 'credentialPath', 'keyFile', 'key_file', 'password', 'secret'])
  const visit = (value: unknown, path: string[] = []) => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (forbidden.has(key)) throw new Error(`raw secrets are not allowed in workspace registry payload (${[...path, key].join('.')})`)
      visit(child, [...path, key])
    }
  }
  visit(input)
}

export type WorkspaceRegistryProvider = 'google_workspace' | 'x_mcp'
export type WorkspaceRegistryOwner = { type: 'agent' | 'user' | 'system' | null; id: string | null }
export type WorkspaceRegistryAudit = {
  approvalStatus: string | null
  auditStatus: string | null
  riskLevel: string | null
  approvalGateTaskId: string | null
  lastReviewedAt: string | null
  lastReviewedBy: string | null
  notes: string | null
}
export type SafeMetadata = Record<string, unknown>

export function normalizeRegistryOwner(value: unknown, fallbackAgentId?: unknown, fallbackUserId?: unknown): WorkspaceRegistryOwner {
  const body = asRecord(value)
  const fallbackType = cleanString(fallbackAgentId) ? 'agent' : cleanString(fallbackUserId) ? 'user' : 'agent'
  const type = enumValue(body.type, ['agent', 'user', 'system'] as const, fallbackType, 'owner.type')
  const id = cleanString(body.id) ?? cleanString(fallbackAgentId) ?? cleanString(fallbackUserId)
  return { type: id ? type : null, id }
}

export function normalizeRegistryAudit(value: unknown, fallbacks: Partial<WorkspaceRegistryAudit> = {}): WorkspaceRegistryAudit {
  const body = asRecord(value)
  return {
    approvalStatus: cleanString(body.approvalStatus) ?? fallbacks.approvalStatus ?? null,
    auditStatus: cleanString(body.auditStatus) ?? fallbacks.auditStatus ?? 'unknown',
    riskLevel: cleanString(body.riskLevel) ?? fallbacks.riskLevel ?? null,
    approvalGateTaskId: cleanString(body.approvalGateTaskId) ?? fallbacks.approvalGateTaskId ?? null,
    lastReviewedAt: cleanIsoString(body.lastReviewedAt, 'audit.lastReviewedAt') ?? fallbacks.lastReviewedAt ?? null,
    lastReviewedBy: cleanString(body.lastReviewedBy) ?? fallbacks.lastReviewedBy ?? null,
    notes: cleanString(body.notes) ?? fallbacks.notes ?? null,
  }
}

function sanitizeSafeMetadataValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(sanitizeSafeMetadataValue).filter((item) => item !== undefined)
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const cleanKey = cleanString(key)
      if (!cleanKey) continue
      const sanitized = sanitizeSafeMetadataValue(child)
      if (sanitized !== undefined) result[cleanKey] = sanitized
    }
    return result
  }
  return undefined
}

export function normalizeSafeMetadata(value: unknown): SafeMetadata {
  assertNoRawSecrets(value)
  const sanitized = sanitizeSafeMetadataValue(asRecord(value))
  return asRecord(sanitized)
}
