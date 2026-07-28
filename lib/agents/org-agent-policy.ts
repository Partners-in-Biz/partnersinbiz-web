import crypto from 'node:crypto'
import type { OrgRole } from '@/lib/organizations/types'
import type { LinkedDevice } from '@/lib/linked-computers/types'
import { linkedDeviceOwnerType } from '@/lib/linked-computers/policy'

export const ORG_AGENT_HANDLE_RE = /^[a-z][a-z0-9._-]{1,19}$/
export const CUSTOM_AGENT_RUNTIME_MINIMUM_VERSION = '1.1.11'

export function buildScopedAgentId(orgId: string, handle: string): string {
  if (!ORG_AGENT_HANDLE_RE.test(handle)) throw new Error('invalid organisation agent handle')
  const tenantKey = crypto.createHash('sha256').update(`org-agent:${orgId}`).digest('hex').slice(0, 16)
  return `oa-${tenantKey}-${handle}`
}

export function runtimeSupportsCustomAgentProfiles(version: unknown): boolean {
  if (typeof version !== 'string') return false
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim())
  if (!match) return false
  const current = match.slice(1, 4).map(Number)
  const minimum = CUSTOM_AGENT_RUNTIME_MINIMUM_VERSION.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (current[index] !== minimum[index]) return current[index] > minimum[index]
  }
  return true
}

export function assertCanCreateAgentOnDevice(input: {
  device: Pick<LinkedDevice, 'ownerType' | 'ownerUserId' | 'ownerOrgId' | 'status'>
  actorUserId: string
  orgId: string
  role: OrgRole
}): 'personal' | 'organization' {
  if (input.device.status !== 'active') throw new Error('An active computer is required')
  const ownerType = linkedDeviceOwnerType(input.device)
  if (ownerType === 'user') {
    if (input.device.ownerUserId !== input.actorUserId) {
      throw new Error('Members can create agents only on computers they own')
    }
    return 'personal'
  }
  if (input.device.ownerOrgId !== input.orgId) {
    throw new Error('The VPS belongs to another organisation')
  }
  if (input.role !== 'owner' && input.role !== 'admin') {
    throw new Error('Only organisation owners and admins can create agents on an organisation VPS')
  }
  return 'organization'
}

export function canPullAgentToDevice(input: {
  agent: {
    agentId: string
    enabled?: boolean
    scopeOrgId?: string
    ownerUserId?: string
    accessScope?: 'personal' | 'organization'
  }
  actorUserId: string
  orgId: string
  orgManager: boolean
  explicitlyGranted: boolean
}): boolean {
  if (input.agent.enabled === false) return false
  if (input.agent.scopeOrgId && input.agent.scopeOrgId !== input.orgId) return false
  if (input.agent.ownerUserId === input.actorUserId) return true
  if (input.orgManager && input.agent.accessScope !== 'personal') return true
  if (input.agent.agentId === 'pip') return true
  return input.explicitlyGranted
}

export function canStartLinkedAgent(input: {
  accessScope?: 'personal' | 'organization'
  ownerUserId?: string
  actorUserId: string
  callerRole: 'admin' | 'client'
  selectedDeviceOwnerUserId?: string
  explicitlyGranted: boolean
}): boolean {
  if (input.accessScope === 'personal') {
    return input.ownerUserId === input.actorUserId
      && input.selectedDeviceOwnerUserId === input.actorUserId
  }
  return input.callerRole === 'admin' || input.explicitlyGranted
}
