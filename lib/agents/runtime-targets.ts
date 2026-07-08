export type AgentRuntimeTargetId = string

export interface AgentRuntimeTarget {
  id: AgentRuntimeTargetId
  label?: string
  baseUrl: string
  apiKey?: string
  enabled: boolean
  priority: number
  capabilities: string[]
  hostId?: string
  lastSeenAt?: unknown
  lastHealthStatus?: string
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
  targetId: AgentRuntimeTargetId
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

export function timestampToMs(value: unknown): number | null {
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
  const seconds = numberOrDefault(record.seconds ?? record._seconds, NaN)
  if (Number.isFinite(seconds)) return seconds * 1000
  return null
}

function normalizeTarget(id: string, value: unknown, fallbackPriority: number): AgentRuntimeTarget | null {
  const record = asRecord(value)
  if (!record) return null
  const targetId = cleanString(record.id) ?? id
  const baseUrl = cleanString(record.baseUrl) ?? cleanString(record.base_url)
  if (!targetId || !baseUrl) return null
  return {
    id: targetId,
    label: cleanString(record.label),
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey: cleanString(record.apiKey) ?? cleanString(record.api_key),
    enabled: record.enabled !== false,
    priority: numberOrDefault(record.priority, fallbackPriority),
    capabilities: stringArray(record.capabilities),
    hostId: cleanString(record.hostId) ?? cleanString(record.host_id),
    lastSeenAt: record.lastSeenAt ?? record.last_seen_at,
    lastHealthStatus: cleanString(record.lastHealthStatus) ?? cleanString(record.last_health_status),
  }
}

export function normalizeRuntimeTargets(value: unknown): AgentRuntimeTarget[] {
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
  if (seenMs == null) return false
  return nowMs - seenMs <= staleAfterMs
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

export function buildRuntimeTargetMap(target: {
  id: string
  label?: string
  baseUrl: string
  apiKey?: string
  enabled?: boolean
  priority?: number
  capabilities?: string[]
  hostId?: string
  lastSeenAt?: unknown
  lastHealthStatus?: string
}): Record<string, Record<string, unknown>> {
  return {
    [target.id]: {
      id: target.id,
      ...(target.label ? { label: target.label } : {}),
      baseUrl: target.baseUrl.replace(/\/+$/, ''),
      ...(target.apiKey ? { apiKey: target.apiKey } : {}),
      enabled: target.enabled !== false,
      ...(target.priority !== undefined ? { priority: target.priority } : {}),
      ...(target.capabilities ? { capabilities: target.capabilities } : {}),
      ...(target.hostId ? { hostId: target.hostId } : {}),
      ...(target.lastSeenAt ? { lastSeenAt: target.lastSeenAt } : {}),
      ...(target.lastHealthStatus ? { lastHealthStatus: target.lastHealthStatus } : {}),
    },
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
    return {
      targetId: 'legacy',
      baseUrl: legacyBaseUrl,
      apiKey: legacyApiKey,
      source: 'legacy',
    }
  }

  return null
}
