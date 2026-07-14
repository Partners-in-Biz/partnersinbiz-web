import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { getProjectForUser } from '@/lib/projects/access'
import { canProjectRole } from '@/lib/projects/collaboration'
import type { ProjectLocationReplica } from '@/lib/project-locations/model'
import { projectLinkedToOrganization } from '@/lib/projects/organization-link'
import { listProjectLocations } from '@/lib/project-locations/store'
import { cancelProjectSync, startProjectSync } from '@/lib/project-sync/coordinator'
import {
  createProjectSyncFirestoreRepository,
  type ProjectSyncFirestore,
} from '@/lib/project-sync/firestore'
import type { ProjectSyncReplicaInput, ProjectSyncRequest } from '@/lib/project-sync/model'
import {
  verifyProjectSyncExecutorEligibility,
} from '@/lib/project-sync/native-executor'

type Context = { params: Promise<{ projectId: string }> }

async function projectScope(projectId: string, orgId: string, user: Parameters<typeof canAccessOrg>[0]) {
  if (!orgId) return { ok: false as const, response: apiError('orgId is required', 400) }
  const access = await getProjectForUser(projectId, user!, orgId)
  if (!access.ok) return { ok: false as const, response: apiError(access.error, access.status) }
  if (!await projectLinkedToOrganization({ projectId, project: access.doc.data() ?? {}, orgId })) {
    return { ok: false as const, response: apiError('Project is not linked to this organisation', 403) }
  }
  if (!canAccessOrg(user, orgId)) return { ok: false as const, response: apiError('Forbidden', 403) }
  return { ok: true as const, access }
}

function syncReplica(replica: ProjectLocationReplica): ProjectSyncReplicaInput {
  return {
    replicaId: replica.replicaId,
    locationId: replica.locationId,
    mappingId: replica.mappingId,
    orgId: replica.orgId,
    projectId: replica.projectId,
    availability: replica.availability,
    currentRevision: replica.currentRevision,
  }
}

function defaultCanonicalLocation(replicas: ProjectLocationReplica[], orgId: string): string | null {
  return replicas.find((replica) => replica.locationKind === 'vps'
    && replica.locationOwner.type === 'organization'
    && replica.locationOwner.orgId === orgId
    && replica.locationVisibility === 'organization')?.locationId
    ?? null
}

function publicSyncRequest(request: ProjectSyncRequest | null) {
  if (!request) return null
  const replicaStates = Array.isArray(request.replicaStates) ? request.replicaStates : []
  const transfers = Array.isArray(request.transfers) ? request.transfers : []
  return {
    requestId: request.requestId,
    status: request.status,
    stateVersion: request.stateVersion,
    requestedAt: request.requestedAt,
    updatedAt: request.updatedAt,
    replicaCount: replicaStates.length,
    onlineReplicaCount: replicaStates.filter((replica) => replica.availability === 'online').length,
    transferCount: transfers.length,
    conflict: request.conflict ? {
      kind: request.conflict.kind,
      status: request.conflict.status,
      detectedAt: request.conflict.detectedAt,
    } : null,
  }
}

function repository() {
  return createProjectSyncFirestoreRepository(adminDb as unknown as ProjectSyncFirestore)
}

function executorBlocker(executor: Awaited<ReturnType<typeof verifyProjectSyncExecutorEligibility>>): string | null {
  if (executor.blockers.includes('storage_lifecycle_unverified')) return 'project_sync_storage_lifecycle_unverified'
  if (!executor.verified) return 'native_sync_worker_unavailable'
  return executor.started ? null : 'native_sync_replica_offline'
}

function controlledStartError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'project sync requires at least two active replicas') {
    return apiError('Project sync requires at least two active replicas', 400)
  }
  if (message === 'canonical project sync location must be an active replica') {
    return apiError('Canonical project sync location must be an active replica', 400)
  }
  if (message === 'project sync idempotency key is invalid') {
    return apiError('Project sync idempotency key is invalid', 400)
  }
  return apiError('Project sync request failed', 500)
}

export const GET = withAuth('client', async (req: NextRequest, user, ctx: Context) => {
  try {
    const { projectId } = await ctx.params
    const orgId = req.nextUrl.searchParams.get('orgId')?.trim() ?? ''
    const scope = await projectScope(projectId, orgId, user)
    if (!scope.ok) return scope.response
    const request = await repository().getLatest(orgId, projectId)
    const replicas = await listProjectLocations(projectId, orgId, user.uid)
    const executor = await verifyProjectSyncExecutorEligibility(replicas)
    const continuousExecutorVerified = request?.continuousExecutorVerified === true && executor.verified
    return apiSuccess({
      request: publicSyncRequest(request),
      continuousExecutorVerified,
      transferAvailable: continuousExecutorVerified,
      blocker: executorBlocker(executor),
    })
  } catch {
    return apiError('Project sync status unavailable', 500)
  }
})

export const POST = withAuth('client', async (req: NextRequest, user, ctx: Context) => {
  try {
    const { projectId } = await ctx.params
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
    const scope = await projectScope(projectId, orgId, user)
    if (!scope.ok) return scope.response
    if (!canProjectRole(scope.access.projectAccess?.role, 'manage_project')) {
      return apiError('Project manager access required', 403)
    }
    const replicas = await listProjectLocations(projectId, orgId, user.uid)
    const requestedCanonical = typeof body.canonicalLocationId === 'string' ? body.canonicalLocationId.trim() : ''
    const canonicalLocationId = requestedCanonical || defaultCanonicalLocation(replicas, orgId)
    if (!canonicalLocationId) return apiError('An organisation-owned VPS replica must be selected as the canonical location', 400)
    const canonical = replicas.find((replica) => replica.locationId === canonicalLocationId)
    if (!canonical) {
      return apiError('Canonical location is not an accessible active project replica', 403)
    }
    if (canonical.locationKind !== 'vps'
      || canonical.locationOwner.type !== 'organization'
      || canonical.locationOwner.orgId !== orgId
      || canonical.locationVisibility !== 'organization') {
      return apiError('Canonical location must be an organisation-owned VPS replica', 400)
    }
    const executor = await verifyProjectSyncExecutorEligibility(replicas)
    const blocker = executorBlocker(executor)
    const result = await startProjectSync({
      orgId,
      projectId,
      canonicalLocationId,
      requestedByUserId: user.uid,
      replicas: replicas.map(syncReplica),
      continuousExecutorVerified: executor.verified,
      idempotencyKey: req.headers.get('idempotency-key')?.trim() || randomUUID(),
      now: new Date().toISOString(),
    }, { repository: repository() })
    return apiSuccess({
      recorded: true,
      created: result.created,
      transferStarted: executor.started && result.created,
      continuousExecutorVerified: result.request.continuousExecutorVerified === true,
      executorStarted: executor.started && result.created,
      blocker,
      message: executor.started
        ? 'Native sync executor started. Authenticated runtimes will inventory on their next poll.'
        : blocker === 'project_sync_storage_lifecycle_unverified'
          ? 'Sync request recorded. File transfer is disabled until the project-sync retention controls are verified by live readback of all five Firestore TTL policies and the Storage lifecycle rule.'
          : executor.verified
          ? 'Native sync executor verified; offline replicas will retry inventory when they reconnect.'
          : 'Sync request recorded. File transfer will not start until every replica has an authenticated workspace.sync runtime.',
      request: publicSyncRequest(result.request),
    }, 202)
  } catch (error) {
    return controlledStartError(error)
  }
})

export const DELETE = withAuth('client', async (req: NextRequest, user, ctx: Context) => {
  try {
    const { projectId } = await ctx.params
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
    const scope = await projectScope(projectId, orgId, user)
    if (!scope.ok) return scope.response
    if (!canProjectRole(scope.access.projectAccess?.role, 'manage_project')) {
      return apiError('Project manager access required', 403)
    }
    const current = await repository().getLatest(orgId, projectId)
    if (!current) return apiError('Project sync request not found', 404)
    const request = await cancelProjectSync({ requestId: current.requestId, cancelledAt: new Date().toISOString() }, { repository: repository() })
    return apiSuccess({ cancelled: true, request: publicSyncRequest(request) })
  } catch {
    return apiError('Project sync cancellation failed', 500)
  }
})
