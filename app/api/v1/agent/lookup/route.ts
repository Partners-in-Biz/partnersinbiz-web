import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiRole, ApiUser } from '@/lib/api/types'
import { resolveAgentEntities } from '@/lib/agent-memory/entity-resolution'
import { retrieveAgentMemory } from '@/lib/agent-memory/retrieval'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

function cleanLimit(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 30) : 8
}

function cleanSourceTypes(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const sourceTypes = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
  return sourceTypes.length > 0 ? sourceTypes : undefined
}

function resolveLookupOrg(req: NextRequest, user: ApiUser, body: Record<string, unknown>) {
  return typeof body.orgId === 'string' && body.orgId.trim()
    ? body.orgId.trim()
    : req.headers.get('x-org-id')?.trim() || user.orgId || ''
}

function cleanString(value: unknown) {
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

function actorIdFromUser(user: ApiUser) {
  return user.agentId ? `agent:${user.agentId}` : user.uid
}

function actionsInclude(actions: unknown, action = 'read') {
  return Array.isArray(actions) && actions.some((item) => item === '*' || item === action)
}

function permissionMatchesOrg(user: ApiUser, orgId: string) {
  return user.permissions?.some((permission) => {
    const canRead = permission.actions.includes('read') || permission.actions.includes('*')
    if (!canRead) return false
    return permission.resource === '*' ||
      permission.resource === 'agent_memory:*' ||
      permission.resource === `agent_memory:${orgId}` ||
      permission.resource === 'org:*' ||
      permission.resource === `org:${orgId}`
  }) ?? false
}

function hasAgentSystemMemoryPermission(user: ApiUser, orgId: string) {
  return user.permissions?.some((permission) => {
    const canRead = permission.actions.includes('read') || permission.actions.includes('*')
    if (!canRead) return false
    return permission.resource === '*' ||
      permission.resource === 'agent_memory_system:*' ||
      permission.resource === `agent_memory_system:${orgId}`
  }) ?? false
}

function canUseLookupOrg(user: ApiUser, orgId: string) {
  if (user.role === 'admin' || user.role === 'client') return canAccessOrg(user, orgId)
  if (user.role !== 'ai') return false
  if (!user.orgId) return permissionMatchesOrg(user, orgId)
  return user.orgId === orgId || permissionMatchesOrg(user, orgId)
}

function allowedLookupOrganizations(user: ApiUser, requestedOrgId: string): string[] | 'all' {
  if (user.role === 'admin') {
    if (!Array.isArray(user.allowedOrgIds) || user.allowedOrgIds.length === 0) return 'all'
    return Array.from(new Set([requestedOrgId, user.orgId, ...user.allowedOrgIds].filter((orgId): orgId is string => Boolean(orgId))))
  }

  const exactPermissionOrgIds = (user.permissions ?? []).flatMap((permission) => {
    const canRead = permission.actions.includes('read') || permission.actions.includes('*')
    if (!canRead) return []
    if (permission.resource === '*' || permission.resource === 'agent_memory:*' || permission.resource === 'org:*') return ['*']
    const match = /^(?:agent_memory|org):([^:*]+)$/.exec(permission.resource)
    return match ? [match[1]] : []
  })
  if (exactPermissionOrgIds.includes('*')) return 'all'
  return Array.from(new Set([requestedOrgId, user.orgId, ...exactPermissionOrgIds].filter((orgId): orgId is string => Boolean(orgId))))
}

function delegationEvidenceId(body: Record<string, unknown>) {
  const direct = cleanString(body.delegationEvidenceId)
  if (direct) return direct
  if (!body.delegationEvidence || typeof body.delegationEvidence !== 'object') return ''
  const evidence = body.delegationEvidence as Record<string, unknown>
  return cleanString(evidence.id) || cleanString(evidence.delegationEvidenceId) || cleanString(evidence.delegationId)
}

async function loadRequesterUser(uid: string): Promise<ApiUser | null> {
  const doc = await adminDb.collection('users').doc(uid).get()
  if (!doc.exists) return null
  const data = doc.data() ?? {}
  const role: ApiRole = data.role === 'admin' || data.role === 'client' || data.role === 'ai' ? data.role : 'client'
  const orgId = cleanString(data.orgId) || undefined
  const orgIds = Array.isArray(data.orgIds)
    ? data.orgIds.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : orgId ? [orgId] : undefined
  const allowedOrgIds = Array.isArray(data.allowedOrgIds)
    ? data.allowedOrgIds.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : undefined
  return { uid, role, orgId, orgIds, allowedOrgIds, authKind: 'session' }
}

async function authorizeAgentMemoryDelegation(input: {
  user: ApiUser
  orgId: string
  requestingUserId: string
  body: Record<string, unknown>
}) {
  const evidenceId = delegationEvidenceId(input.body)
  if (!evidenceId) return false

  const doc = await adminDb.collection('agent_memory_delegations').doc(evidenceId).get()
  if (!doc.exists) return false
  const data = doc.data() ?? {}
  const delegatedUid = cleanString(data.uid) || cleanString(data.requestingUserId) || cleanString(data.delegatedUid)
  const delegatedOrgId = cleanString(data.orgId)
  const delegatedActorId = cleanString(data.actorId)
  const delegatedAgentId = cleanString(data.agentId)
  const delegatedApiKeyId = cleanString(data.apiKeyId)
  const status = cleanString(data.status)
  const expiresAt = timestampToMillis(data.expiresAt)
  const actorId = actorIdFromUser(input.user)

  const actorMatches = delegatedActorId === actorId ||
    (input.user.agentId && delegatedAgentId === input.user.agentId) ||
    (input.user.apiKeyId && delegatedApiKeyId === input.user.apiKeyId)
  const statusOk = status === 'active' || status === 'approved'
  const expiryOk = expiresAt === null || expiresAt > Date.now()
  const actionOk = actionsInclude(data.actionClasses) || actionsInclude(data.actions)

  return delegatedUid === input.requestingUserId &&
    delegatedOrgId === input.orgId &&
    Boolean(actorMatches) &&
    statusOk &&
    expiryOk &&
    !data.revokedAt &&
    actionOk
}

async function resolveEffectiveLookupUser(user: ApiUser, orgId: string, body: Record<string, unknown>): Promise<{ user?: ApiUser; error?: string; status?: number }> {
  if (user.role !== 'ai') return { user }

  const requestingUserId = cleanString(body.requestingUserId) || cleanString(body.uid)
  if (!requestingUserId) {
    return hasAgentSystemMemoryPermission(user, orgId)
      ? { user }
      : { error: 'requestingUserId and delegationEvidenceId are required for agent memory lookup', status: 400 }
  }

  const delegated = await authorizeAgentMemoryDelegation({ user, orgId, requestingUserId, body })
  if (!delegated) return { error: 'Agent memory delegation evidence does not authorize this user or org', status: 403 }

  const requester = await loadRequesterUser(requestingUserId)
  if (!requester) return { error: 'Requesting user not found', status: 404 }
  return { user: requester }
}

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return apiError('Invalid JSON body', 400)
  const query = typeof body.query === 'string' ? body.query.trim() : ''
  if (query.length < 2) return apiError('query must be at least 2 characters', 400)

  const orgId = resolveLookupOrg(req, user, body)
  if (!orgId) return apiError('orgId is required for agent lookup', 400)

  const effective = await resolveEffectiveLookupUser(user, orgId, body)
  if (!effective.user) return apiError(effective.error ?? 'Forbidden', effective.status ?? 403)
  if (!canUseLookupOrg(effective.user, orgId)) return apiError('Forbidden', 403)

  const limit = cleanLimit(body.limit)
  const sourceTypes = cleanSourceTypes(body.sourceTypes)
  const resolution = await resolveAgentEntities({
    query,
    orgId,
    limit: 10,
    allowedOrganizationIds: allowedLookupOrganizations(effective.user, orgId),
  })
  const retrievalOrgId = resolution.selectedEntity?.type === 'organization' ? resolution.selectedEntity.id : orgId
  if (!canUseLookupOrg(effective.user, retrievalOrgId)) return apiError('Forbidden', 403)

  const retrieved = await retrieveAgentMemory({
    query,
    orgId: retrievalOrgId,
    selectedEntity: resolution.selectedEntity,
    sourceTypes,
    limit,
    user: effective.user,
  })

  return apiSuccess({
    intent: resolution.intent,
    entityCandidates: resolution.entityCandidates,
    selectedEntity: resolution.selectedEntity,
    memory: retrieved.memory,
    nextActions: resolution.nextActions,
    citations: retrieved.citations,
  })
})
