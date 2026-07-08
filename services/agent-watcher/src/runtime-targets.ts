export interface AgentRuntimeTarget {
  id: string
  baseUrl: string
  apiKey?: string
  enabled: boolean
  priority: number
  capabilities: string[]
  lastSeenAt?: unknown
}

export interface LegacyAgentRuntimeTarget {
  baseUrl?: string | null
  apiKey?: string | null
  enabled?: boolean | null
}

export interface RuntimeTargetSelectionInput {
  runtimeTargets?: unknown
  legacy?: LegacyAgentRuntimeTarget | null
  preference?: string | null
  defaultTargetId?: string | null
  nowMs?: number
  staleAfterMs?: number
  preferLocal?: boolean
}

export interface AgentDispatchTarget {
  targetId: string
  baseUrl: string
  apiKey: string
  source: 'runtimeTargets' | 'legacy'
}

const DEFAULT_STALE_AFTER_MS = 10 * 60 * 1000

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberOrDefault(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) ? n : fallback
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item) => cleanString(item)).filter(Boolean) as string[]))
}

function timestampToMs(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (value instanceof Date) return value.getTime()
  const record = asRecord(value)
  if (!record) return null
  const toMillis = record.toMillis
  if (typeof toMillis === 'function') {
    try {
      const ms = toMillis.call(value)
      return Number.isFinite(ms) ? ms : null
    } catch {
      return null
    }
  }
  const secondsRaw = record.seconds ?? record._seconds
  const seconds = typeof secondsRaw === 'number' ? secondsRaw : typeof secondsRaw === 'string' ? Number(secondsRaw) : NaN
  return Number.isFinite(seconds) ? seconds * 1000 : null
}

function normalizeTarget(id: string, value: unknown, fallbackPriority: number): AgentRuntimeTarget | null {
  const record = asRecord(value)
  if (!record) return null
  const targetId = cleanString(record.id) ?? id
  const baseUrl = cleanString(record.baseUrl) ?? cleanString(record.base_url)
  if (!targetId || !baseUrl) return null
  return {
    id: targetId,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey: cleanString(record.apiKey) ?? cleanString(record.api_key),
    enabled: record.enabled !== false,
    priority: numberOrDefault(record.priority, fallbackPriority),
    capabilities: stringArray(record.capabilities),
    lastSeenAt: record.lastSeenAt ?? record.last_seen_at,
  }
}

function normalizeRuntimeTargets(value: unknown): AgentRuntimeTarget[] {
  if (Array.isArray(value)) {
    return value
      .map((entry, index) => normalizeTarget(cleanString(asRecord(entry)?.id) ?? `target-${index + 1}`, entry, index + 100))
      .filter(Boolean) as AgentRuntimeTarget[]
  }
  const record = asRecord(value)
  if (!record) return []
  return Object.entries(record)
    .map(([id, entry], index) => normalizeTarget(id, entry, index + 100))
    .filter(Boolean) as AgentRuntimeTarget[]
}

function isLocalish(target: AgentRuntimeTarget): boolean {
  const id = target.id.toLowerCase()
  return id === 'local' || id.includes('mac') || target.capabilities.some((cap) => cap.toLowerCase().includes('local'))
}

function isFreshEnough(target: AgentRuntimeTarget, nowMs: number, staleAfterMs: number): boolean {
  if (!isLocalish(target)) return true
  const seenMs = timestampToMs(target.lastSeenAt)
  return seenMs !== null && nowMs - seenMs <= staleAfterMs
}

function usableTarget(target: AgentRuntimeTarget, nowMs: number, staleAfterMs: number, requireFreshLocal: boolean): boolean {
  if (!target.enabled || !target.baseUrl || !target.apiKey) return false
  return !requireFreshLocal || isFreshEnough(target, nowMs, staleAfterMs)
}

function toDispatchTarget(target: AgentRuntimeTarget): AgentDispatchTarget {
  return {
    targetId: target.id,
    baseUrl: target.baseUrl,
    apiKey: target.apiKey ?? '',
    source: 'runtimeTargets',
  }
}

export function selectAgentRuntimeTarget(input: RuntimeTargetSelectionInput): AgentDispatchTarget | null {
  const nowMs = input.nowMs ?? Date.now()
  const staleAfterMs = input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS
  const preference = cleanString(input.preference)?.toLowerCase() ?? 'auto'
  const targets = normalizeRuntimeTargets(input.runtimeTargets)

  if (preference && preference !== 'auto') {
    const exact = targets.find((target) => target.id.toLowerCase() === preference)
    if (exact && usableTarget(exact, nowMs, staleAfterMs, false)) return toDispatchTarget(exact)
  }

  const freshTargets = targets.filter((target) => usableTarget(target, nowMs, staleAfterMs, true))

  if (input.preferLocal) {
    const local = freshTargets.find(isLocalish)
    if (local) return toDispatchTarget(local)
  }

  const defaultId = cleanString(input.defaultTargetId)?.toLowerCase()
  if (defaultId) {
    const selectedDefault = freshTargets.find((target) => target.id.toLowerCase() === defaultId)
    if (selectedDefault) return toDispatchTarget(selectedDefault)
  }

  const vps = freshTargets.find((target) => target.id.toLowerCase() === 'vps')
  if (vps) return toDispatchTarget(vps)

  const first = freshTargets.sort((a, b) => a.priority - b.priority)[0]
  if (first) return toDispatchTarget(first)

  const legacyBaseUrl = cleanString(input.legacy?.baseUrl)?.replace(/\/+$/, '')
  const legacyApiKey = cleanString(input.legacy?.apiKey)
  if (legacyBaseUrl && legacyApiKey && input.legacy?.enabled !== false) {
    return { targetId: 'legacy', baseUrl: legacyBaseUrl, apiKey: legacyApiKey, source: 'legacy' }
  }

  return null
}
