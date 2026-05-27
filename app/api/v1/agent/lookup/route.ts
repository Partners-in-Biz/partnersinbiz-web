import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { resolveAgentEntities } from '@/lib/agent-memory/entity-resolution'
import { retrieveAgentMemory } from '@/lib/agent-memory/retrieval'

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

function canUseLookupOrg(user: ApiUser, orgId: string) {
  if (user.role === 'admin') return canAccessOrg(user, orgId)
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

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return apiError('Invalid JSON body', 400)
  const query = typeof body.query === 'string' ? body.query.trim() : ''
  if (query.length < 2) return apiError('query must be at least 2 characters', 400)

  const orgId = resolveLookupOrg(req, user, body)
  if (!orgId) return apiError('orgId is required for agent lookup', 400)
  if (!canUseLookupOrg(user, orgId)) return apiError('Forbidden', 403)

  const limit = cleanLimit(body.limit)
  const sourceTypes = cleanSourceTypes(body.sourceTypes)
  const resolution = await resolveAgentEntities({
    query,
    orgId,
    limit: 10,
    allowedOrganizationIds: allowedLookupOrganizations(user, orgId),
  })
  const retrievalOrgId = resolution.selectedEntity?.type === 'organization' ? resolution.selectedEntity.id : orgId
  if (!canUseLookupOrg(user, retrievalOrgId)) return apiError('Forbidden', 403)

  const retrieved = await retrieveAgentMemory({
    query,
    orgId: retrievalOrgId,
    selectedEntity: resolution.selectedEntity,
    sourceTypes,
    limit,
    user,
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
