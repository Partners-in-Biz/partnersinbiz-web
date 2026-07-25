/**
 * Desired agent inventory for linked computers.
 *
 * Heartbeat `availableAgentIds` remains the observed inventory.
 * `desiredAgents` is the operator-chosen source of truth for pull + keep-in-sync.
 */

import { AGENT_IDS, isValidAgentId, type AgentId } from '@/lib/agents/types'

export type DesiredAgentSyncStatus =
  | 'desired'
  | 'installing'
  | 'installed'
  | 'syncing'
  | 'in_sync'
  | 'drifted'
  | 'error'

export interface DesiredAgentBinding {
  agentId: AgentId
  keepInSync: boolean
  desiredPolicyVersion: string | null
  appliedPolicyVersion: string | null
  status: DesiredAgentSyncStatus
  lastError: string | null
  updatedAtMs: number
}

export interface DesiredAgentInput {
  agentId: string
  keepInSync?: boolean
}

export function parseDesiredAgentBindings(value: unknown, nowMs = Date.now()): DesiredAgentBinding[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const bindings: DesiredAgentBinding[] = []
  for (const row of value) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const record = row as Record<string, unknown>
    if (!isValidAgentId(record.agentId) || seen.has(record.agentId)) continue
    seen.add(record.agentId)
    const status = typeof record.status === 'string' ? record.status : 'desired'
    bindings.push({
      agentId: record.agentId,
      keepInSync: record.keepInSync === true,
      desiredPolicyVersion: typeof record.desiredPolicyVersion === 'string' ? record.desiredPolicyVersion : null,
      appliedPolicyVersion: typeof record.appliedPolicyVersion === 'string' ? record.appliedPolicyVersion : null,
      status: isDesiredAgentSyncStatus(status) ? status : 'desired',
      lastError: typeof record.lastError === 'string' ? record.lastError : null,
      updatedAtMs: Number.isFinite(Number(record.updatedAtMs)) ? Number(record.updatedAtMs) : nowMs,
    })
  }
  return bindings.sort((a, b) => a.agentId.localeCompare(b.agentId))
}

export function isDesiredAgentSyncStatus(value: string): value is DesiredAgentSyncStatus {
  return value === 'desired'
    || value === 'installing'
    || value === 'installed'
    || value === 'syncing'
    || value === 'in_sync'
    || value === 'drifted'
    || value === 'error'
}

export function normalizeDesiredAgentInputs(inputs: DesiredAgentInput[]): DesiredAgentInput[] {
  const seen = new Set<string>()
  const next: DesiredAgentInput[] = []
  for (const input of inputs) {
    if (!isValidAgentId(input.agentId) || seen.has(input.agentId)) continue
    seen.add(input.agentId)
    next.push({
      agentId: input.agentId,
      keepInSync: input.keepInSync === true,
    })
  }
  return next.sort((a, b) => a.agentId.localeCompare(b.agentId))
}

export function mergeDesiredAgentBindings(input: {
  existing: DesiredAgentBinding[]
  desired: DesiredAgentInput[]
  policyVersionByAgent: Record<string, string | null | undefined>
  nowMs?: number
}): { bindings: DesiredAgentBinding[]; added: AgentId[]; removed: AgentId[]; keepInSyncChanged: AgentId[] } {
  const nowMs = input.nowMs ?? Date.now()
  const existingById = new Map(input.existing.map((binding) => [binding.agentId, binding]))
  const desired = normalizeDesiredAgentInputs(input.desired)
  const desiredIds = new Set(desired.map((row) => row.agentId))
  const added: AgentId[] = []
  const keepInSyncChanged: AgentId[] = []
  const bindings: DesiredAgentBinding[] = desired.map((row) => {
    const previous = existingById.get(row.agentId)
    const keepInSync = row.keepInSync === true
    const desiredPolicyVersion = input.policyVersionByAgent[row.agentId] ?? previous?.desiredPolicyVersion ?? null
    if (!previous) {
      added.push(row.agentId)
      return {
        agentId: row.agentId,
        keepInSync,
        desiredPolicyVersion,
        appliedPolicyVersion: null,
        status: 'desired' as const,
        lastError: null,
        updatedAtMs: nowMs,
      }
    }
    if (previous.keepInSync !== keepInSync) keepInSyncChanged.push(row.agentId)
    const drifted = Boolean(
      keepInSync
      && desiredPolicyVersion
      && previous.appliedPolicyVersion
      && desiredPolicyVersion !== previous.appliedPolicyVersion,
    )
    return {
      ...previous,
      keepInSync,
      desiredPolicyVersion,
      status: drifted ? 'drifted' : previous.status === 'error' ? previous.status : previous.status,
      updatedAtMs: nowMs,
    }
  })
  const removed = input.existing
    .map((binding) => binding.agentId)
    .filter((agentId) => !desiredIds.has(agentId))
  return { bindings, added, removed, keepInSyncChanged }
}

export function bindingsNeedingInstall(input: {
  bindings: DesiredAgentBinding[]
  availableAgentIds: readonly string[]
}): DesiredAgentBinding[] {
  const available = new Set(input.availableAgentIds)
  return input.bindings.filter((binding) => !available.has(binding.agentId))
}

export function bindingsNeedingPolicySync(input: {
  bindings: DesiredAgentBinding[]
  availableAgentIds?: readonly string[]
}): DesiredAgentBinding[] {
  const available = input.availableAgentIds ? new Set(input.availableAgentIds) : null
  return input.bindings.filter((binding) => {
    if (!binding.keepInSync) return false
    if (available && !available.has(binding.agentId)) return false
    if (!binding.desiredPolicyVersion) return false
    return binding.appliedPolicyVersion !== binding.desiredPolicyVersion
      || binding.status === 'drifted'
      || binding.status === 'desired'
      || binding.status === 'installed'
  })
}

export function publicManagedAgentIds(): AgentId[] {
  return [...AGENT_IDS]
}

export function applyBindingJobProgress(
  binding: DesiredAgentBinding,
  update: {
    status: DesiredAgentSyncStatus
    appliedPolicyVersion?: string | null
    desiredPolicyVersion?: string | null
    lastError?: string | null
    nowMs?: number
  },
): DesiredAgentBinding {
  return {
    ...binding,
    status: update.status,
    appliedPolicyVersion: update.appliedPolicyVersion === undefined
      ? binding.appliedPolicyVersion
      : update.appliedPolicyVersion,
    desiredPolicyVersion: update.desiredPolicyVersion === undefined
      ? binding.desiredPolicyVersion
      : update.desiredPolicyVersion,
    lastError: update.lastError === undefined ? binding.lastError : update.lastError,
    updatedAtMs: update.nowMs ?? Date.now(),
  }
}
