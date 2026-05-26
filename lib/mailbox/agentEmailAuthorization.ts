import { adminDb } from '@/lib/firebase/admin'
import type { ApiPermission, ApiUser } from '@/lib/api/types'

export type AgentMailboxActionClass = 'read' | 'draft' | 'send'

export type AgentMailboxDelegationEvidence = {
  evidenceId: string
  evidenceType: 'self' | 'api_key_permission' | 'delegation_record'
  actorId: string
  orgId: string
  uid: string
  actionClass: AgentMailboxActionClass
}

export class AgentMailboxAuthorizationError extends Error {
  status = 403

  constructor(message = 'Mailbox delegation evidence is required for requested user context') {
    super(message)
    this.name = 'AgentMailboxAuthorizationError'
  }
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function timestampToMillis(value: unknown): number | null {
  if (!value) return null
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (typeof value === 'object') {
    const source = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof source.toDate === 'function') {
      try { return source.toDate().getTime() } catch { return null }
    }
    const seconds = source.seconds ?? source._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return null
}

function actionsInclude(actions: string[] | undefined, actionClass: AgentMailboxActionClass): boolean {
  if (!actions?.length) return false
  return actions.includes('*') || actions.includes(actionClass) || (actionClass === 'draft' && actions.includes('write'))
}

function permissionMatches(permission: ApiPermission, orgId: string, uid: string, actionClass: AgentMailboxActionClass): boolean {
  if (!actionsInclude(permission.actions, actionClass)) return false
  const resource = permission.resource.trim()
  return resource === `mailbox:${orgId}:${uid}` || resource === `mailbox:${orgId}:${uid}:agent-email`
}

function actorIdFromUser(user: ApiUser): string {
  return user.agentId ? `agent:${user.agentId}` : user.uid
}

function delegationIdFromInput(input: { delegationEvidenceId?: unknown; delegationEvidence?: unknown }): string {
  const direct = normalizeText(input.delegationEvidenceId)
  if (direct) return direct
  if (input.delegationEvidence && typeof input.delegationEvidence === 'object') {
    const source = input.delegationEvidence as Record<string, unknown>
    return normalizeText(source.id) || normalizeText(source.delegationEvidenceId) || normalizeText(source.delegationId)
  }
  return ''
}

function delegationActionMatches(data: Record<string, unknown>, actionClass: AgentMailboxActionClass): boolean {
  const actionClasses = Array.isArray(data.actionClasses) ? data.actionClasses.filter((item): item is string => typeof item === 'string') : []
  const actions = Array.isArray(data.actions) ? data.actions.filter((item): item is string => typeof item === 'string') : []
  return actionsInclude(actionClasses, actionClass) || actionsInclude(actions, actionClass)
}

export async function authorizeAgentMailboxDelegation(input: {
  user: ApiUser
  orgId: string
  uid: string
  actionClass: AgentMailboxActionClass
  delegationEvidenceId?: unknown
  delegationEvidence?: unknown
}): Promise<AgentMailboxDelegationEvidence> {
  const orgId = normalizeText(input.orgId)
  const uid = normalizeText(input.uid)
  if (!orgId || !uid) throw new AgentMailboxAuthorizationError('orgId and uid are required before mailbox delegation authorization')

  const actorId = actorIdFromUser(input.user)

  if (input.user.role === 'ai' && input.user.orgId && input.user.orgId !== orgId) {
    throw new AgentMailboxAuthorizationError('Forbidden for requested orgId')
  }

  if (input.user.role !== 'ai' && input.user.uid === uid && input.user.orgId === orgId) {
    return { evidenceId: `self:${input.user.uid}`, evidenceType: 'self', actorId, orgId, uid, actionClass: input.actionClass }
  }

  const scopedPermission = input.user.permissions?.find((permission) => permissionMatches(permission, orgId, uid, input.actionClass))
  if (input.user.authKind === 'agent_api_key' && scopedPermission) {
    return { evidenceId: `api-key-permission:${input.user.apiKeyId ?? actorId}:${scopedPermission.resource}`, evidenceType: 'api_key_permission', actorId, orgId, uid, actionClass: input.actionClass }
  }

  const delegationEvidenceId = delegationIdFromInput(input)
  if (!delegationEvidenceId) throw new AgentMailboxAuthorizationError()

  const doc = await adminDb.collection('mailbox_agent_delegations').doc(delegationEvidenceId).get()
  if (!doc.exists) throw new AgentMailboxAuthorizationError('Mailbox delegation evidence was not found')
  const data = doc.data() ?? {}

  const delegatedUid = normalizeText(data.uid) || normalizeText(data.delegatedUid) || normalizeText(data.requestingUserId)
  const delegatedOrgId = normalizeText(data.orgId)
  const delegatedActorId = normalizeText(data.actorId)
  const delegatedAgentId = normalizeText(data.agentId)
  const delegatedApiKeyId = normalizeText(data.apiKeyId)
  const status = normalizeText(data.status)
  const expiresAt = timestampToMillis(data.expiresAt)

  const actorMatches = delegatedActorId === actorId || (input.user.agentId && delegatedAgentId === input.user.agentId) || (input.user.apiKeyId && delegatedApiKeyId === input.user.apiKeyId)
  const statusOk = status === 'active' || status === 'approved'
  const expiryOk = expiresAt === null || expiresAt > Date.now()

  if (delegatedOrgId !== orgId || delegatedUid !== uid || !actorMatches || !statusOk || data.revokedAt || !expiryOk || !delegationActionMatches(data, input.actionClass)) {
    throw new AgentMailboxAuthorizationError('Mailbox delegation evidence does not authorize this actor, org, uid, or action')
  }

  return { evidenceId: doc.id, evidenceType: 'delegation_record', actorId, orgId, uid, actionClass: input.actionClass }
}
