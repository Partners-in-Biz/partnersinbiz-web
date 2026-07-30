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
    agentKind?: string
    marketplaceTemplateId?: string
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
  // Marketplace org-scoped instances are pullable by any active org member once created.
  if (
    (input.agent.agentKind === 'marketplace' || input.agent.marketplaceTemplateId)
    && input.agent.accessScope === 'organization'
    && input.agent.scopeOrgId === input.orgId
  ) {
    return true
  }
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

/**
 * Who may edit / retry a linked custom agent in organisation settings.
 * Personal agents: the owning member only.
 * Organisation agents: org owner/admin only (not ordinary members with a grant).
 */
export function canManageLinkedAgent(input: {
  agent: {
    scopeOrgId?: string | null
    accessScope?: 'personal' | 'organization' | string | null
    ownerUserId?: string | null
    provisioningMode?: string | null
    agentKind?: string | null
    marketplaceTemplateId?: string | null
  }
  actorUserId: string
  orgId: string
  role: OrgRole
}): boolean {
  if (input.agent.provisioningMode && input.agent.provisioningMode !== 'linked_device') {
    return false
  }
  // Marketplace template instances are pull/uninstall only — never field-edit.
  if (input.agent.agentKind === 'marketplace' || input.agent.marketplaceTemplateId) {
    return false
  }
  if (input.agent.scopeOrgId && input.agent.scopeOrgId !== input.orgId) return false
  if (input.agent.accessScope === 'personal') {
    return input.agent.ownerUserId === input.actorUserId
  }
  return input.role === 'owner' || input.role === 'admin'
}

export type LinkedAgentEditableFields = {
  name: string
  role: string
  persona: string
  defaultModel: string
  iconKey: string
  colorKey: string
}

const LINKED_AGENT_COLOR_KEYS = [
  'sky', 'violet', 'amber', 'emerald', 'rose', 'cyan', 'indigo', 'orange', 'teal', 'slate',
] as const

/**
 * Validate portal update payload for a linked custom agent.
 * Missing keys keep the current value from `current`.
 */
export function parseLinkedAgentUpdateFields(
  body: Record<string, unknown>,
  current: LinkedAgentEditableFields,
): { ok: true; fields: LinkedAgentEditableFields; changed: boolean } | { ok: false; error: string } {
  const name = body.name !== undefined ? String(body.name ?? '').trim() : current.name
  const role = body.role !== undefined ? String(body.role ?? '').trim() : current.role
  const persona = body.persona !== undefined ? String(body.persona ?? '').trim() : current.persona
  const defaultModel = body.defaultModel !== undefined
    ? (String(body.defaultModel ?? '').trim() || 'auto')
    : current.defaultModel
  const iconKey = body.iconKey !== undefined
    ? (String(body.iconKey ?? '').trim() || current.iconKey)
    : current.iconKey
  const colorKey = body.colorKey !== undefined
    ? (String(body.colorKey ?? '').trim() || current.colorKey)
    : current.colorKey

  if (!name || !role || !persona) return { ok: false, error: 'Name, role, and purpose are required' }
  if (name.length > 100) return { ok: false, error: 'Name must be 100 characters or fewer' }
  if (role.length > 120) return { ok: false, error: 'Role must be 120 characters or fewer' }
  if (persona.length > 20_000) return { ok: false, error: 'Purpose and behaviour must be 20,000 characters or fewer' }
  if (defaultModel.length > 200) return { ok: false, error: 'Default model must be 200 characters or fewer' }
  if (!/^[a-z0-9_]{1,48}$/.test(iconKey)) return { ok: false, error: 'Invalid agent icon' }
  if (!(LINKED_AGENT_COLOR_KEYS as readonly string[]).includes(colorKey)) {
    return { ok: false, error: 'Invalid agent colour' }
  }

  const fields: LinkedAgentEditableFields = {
    name,
    role,
    persona,
    defaultModel,
    iconKey,
    colorKey,
  }
  const changed = fields.name !== current.name
    || fields.role !== current.role
    || fields.persona !== current.persona
    || fields.defaultModel !== current.defaultModel
    || fields.iconKey !== current.iconKey
    || fields.colorKey !== current.colorKey

  return { ok: true, fields, changed }
}

/** Stable short revision for profile re-sync idempotency keys. */
export function linkedAgentProfileRevision(fields: Pick<LinkedAgentEditableFields, 'name' | 'role' | 'persona' | 'defaultModel'>): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      name: fields.name,
      role: fields.role,
      persona: fields.persona,
      defaultModel: fields.defaultModel,
    }))
    .digest('hex')
    .slice(0, 16)
}
