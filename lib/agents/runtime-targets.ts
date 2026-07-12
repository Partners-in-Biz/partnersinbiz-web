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
  runtimeKind: 'local' | 'vps' | 'remote' | 'legacy'
  machineLabel: string
}

export type RuntimeTargetSelectionErrorCode =
  | 'runtime_target_not_found'
  | 'runtime_target_disabled'
  | 'runtime_target_stale'
  | 'runtime_target_unhealthy'
  | 'runtime_target_missing_api_key'

export interface RuntimeTargetSelectionError {
  ok: false
  code: RuntimeTargetSelectionErrorCode
  requestedTargetId: string
}

export type RuntimeTargetResolution = AgentDispatchTarget | RuntimeTargetSelectionError | null

export const DEFAULT_RUNTIME_STALE_AFTER_MS = 10 * 60 * 1000

export interface PublicRuntimeTargetPresence {
  id: string
  label: string
  hostId?: string
  enabled: boolean
  isLocal: boolean
  isFresh: boolean
  isHealthy: boolean
  selectable: boolean
  lastSeenAt: string | null
  ageSeconds: number | null
  lastHealthStatus: string | null
}

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

export function isLocalRuntimeTarget(target: AgentRuntimeTarget): boolean {
  const id = target.id.toLowerCase()
  return id === 'local' || id.includes('mac') || target.capabilities.some((cap) => cap.toLowerCase().includes('local'))
}

export function isRuntimeTargetFresh(target: AgentRuntimeTarget, nowMs: number, staleAfterMs: number): boolean {
  if (!isLocalRuntimeTarget(target)) return true
  const seenMs = timestampToMs(target.lastSeenAt)
  if (seenMs == null) return false
  return nowMs - seenMs <= staleAfterMs
}

function usableTarget(target: AgentRuntimeTarget, nowMs: number, staleAfterMs: number, requireFreshLocal: boolean): boolean {
  if (!target.enabled || !target.baseUrl || !target.apiKey) return false
  if (!isRuntimeTargetHealthy(target)) return false
  return !requireFreshLocal || isRuntimeTargetFresh(target, nowMs, staleAfterMs)
}

function isRuntimeTargetHealthy(target: AgentRuntimeTarget): boolean {
  const status = target.lastHealthStatus?.trim().toLowerCase()
  return !status || !['unreachable', 'offline', 'error', 'failed'].includes(status)
}

function humanizeHostId(hostId: string): string {
  const normalized = hostId.trim().toLowerCase()
  if (normalized.includes('peet')) return "Peet's Mac"
  return hostId
    .replace(/[-_.]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function publicRuntimeTargetPresence(
  value: unknown,
  options: { nowMs?: number; staleAfterMs?: number } = {},
): PublicRuntimeTargetPresence[] {
  const nowMs = options.nowMs ?? Date.now()
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_RUNTIME_STALE_AFTER_MS
  return normalizeRuntimeTargets(value)
    .map((target) => {
      const isLocal = isLocalRuntimeTarget(target)
      const seenMs = timestampToMs(target.lastSeenAt)
      const isFresh = isRuntimeTargetFresh(target, nowMs, staleAfterMs)
      const healthStatus = target.lastHealthStatus?.trim().toLowerCase()
      const isHealthy = !healthStatus || !['unreachable', 'offline', 'error', 'failed'].includes(healthStatus)
      const hostLabel = target.hostId ? humanizeHostId(target.hostId) : undefined
      const label = isLocal
        ? `Local${hostLabel ? `: ${hostLabel}` : ''}`
        : target.label?.trim() || target.id.toUpperCase()
      return {
        id: target.id,
        label,
        ...(target.hostId ? { hostId: target.hostId } : {}),
        enabled: target.enabled,
        isLocal,
        isFresh,
        isHealthy,
        selectable: target.enabled && Boolean(target.apiKey) && isHealthy && (!isLocal || isFresh),
        lastSeenAt: seenMs == null ? null : new Date(seenMs).toISOString(),
        ageSeconds: seenMs == null ? null : Math.max(0, Math.floor((nowMs - seenMs) / 1000)),
        lastHealthStatus: target.lastHealthStatus ?? null,
      }
    })
    .sort((a, b) => {
      if (a.id === 'vps') return -1
      if (b.id === 'vps') return 1
      return a.label.localeCompare(b.label)
    })
}

function toDispatchTarget(target: AgentRuntimeTarget): AgentDispatchTarget {
  const isLocal = isLocalRuntimeTarget(target)
  const runtimeKind = isLocal ? 'local' : target.id.toLowerCase() === 'vps' ? 'vps' : 'remote'
  return {
    targetId: target.id,
    baseUrl: target.baseUrl,
    apiKey: target.apiKey ?? '',
    source: 'runtimeTargets',
    runtimeKind,
    machineLabel: target.hostId ? humanizeHostId(target.hostId) : target.label?.trim() || target.id,
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

export function selectAgentRuntimeTarget(input: RuntimeTargetSelectionInput): RuntimeTargetResolution {
  const nowMs = input.nowMs ?? Date.now()
  const staleAfterMs = input.staleAfterMs ?? DEFAULT_RUNTIME_STALE_AFTER_MS
  const preference = cleanString(input.preference)?.toLowerCase() ?? 'auto'
  const targets = normalizeRuntimeTargets(input.runtimeTargets)

  if (preference && preference !== 'auto') {
    const exact = targets.find((target) => target.id.toLowerCase() === preference)
    if (!exact) return { ok: false, code: 'runtime_target_not_found', requestedTargetId: preference }
    if (!exact.enabled) return { ok: false, code: 'runtime_target_disabled', requestedTargetId: preference }
    if (!exact.apiKey) return { ok: false, code: 'runtime_target_missing_api_key', requestedTargetId: preference }
    if (!isRuntimeTargetHealthy(exact)) return { ok: false, code: 'runtime_target_unhealthy', requestedTargetId: preference }
    if (isLocalRuntimeTarget(exact) && !isRuntimeTargetFresh(exact, nowMs, staleAfterMs)) {
      return { ok: false, code: 'runtime_target_stale', requestedTargetId: preference }
    }
    return toDispatchTarget(exact)
  }

  const freshTargets = targets.filter((target) => usableTarget(target, nowMs, staleAfterMs, true))

  if (input.preferLocal) {
    const local = freshTargets.find(isLocalRuntimeTarget)
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
      runtimeKind: 'legacy',
      machineLabel: 'Legacy Hermes',
    }
  }

  return null
}
