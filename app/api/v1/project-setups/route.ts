import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'
import { handleProjectCreate } from '@/app/api/v1/projects/route'
import { handleOrganizationCreate } from '@/app/api/v1/organizations/route'
import {
  getDefaultOrgWorkspace,
  getOrgWorkspaceById,
  upsertOrgWorkspace,
} from '@/lib/client-provisioning/workspace-context'
import { provisionFullClientOnVps } from '@/lib/client-provisioning/vps'
import { resumeClientOrganizationWorkspace } from '@/lib/client-provisioning/organization-resume'
import {
  WORKSPACE_FOLDER_COLLECTION,
  canReadWorkspaceFolder,
  serializeWorkspaceFolder,
} from '@/lib/workspace-folders/model'
import {
  linkProjectLocation,
  listExecutionLocationsForWorkspace,
} from '@/lib/project-locations/store'
import { provisionStandardProjectFolder } from '@/lib/project-locations/project-folder-provisioning'
import {
  ProjectSetupExecutionError,
  executeProjectSetup,
  type ProjectSetupExecutionDependencies,
  type ProjectSetupExecutionResult,
  type ProjectSetupOperationResponse,
} from '@/lib/project-locations/project-setup-execution'
import {
  ProjectSetupIdempotencyError,
  createProjectSetupOperationRepository,
  projectSetupOperationResourceIds,
  projectSetupRequestFingerprint,
  type ProjectSetupOperationFirestore,
} from '@/lib/project-locations/project-setup-operations'

export const dynamic = 'force-dynamic'

const setupOperations = createProjectSetupOperationRepository(
  adminDb as unknown as ProjectSetupOperationFirestore,
)

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function operationResponse(response: Response): Promise<ProjectSetupOperationResponse> {
  const body = record(await response.json().catch(() => ({})))
  const bodyData = record(body.data)
  const topLevelId = clean(body.id)
  const topLevelSlug = clean(body.slug)
  const data = {
    ...bodyData,
    ...(topLevelId && !clean(bodyData.id) ? { id: topLevelId } : {}),
    ...(topLevelSlug && !clean(bodyData.slug) ? { slug: topLevelSlug } : {}),
  }
  return {
    ok: response.ok && body.success !== false,
    status: response.status,
    data,
    ...(typeof body.error === 'string' ? { error: body.error } : {}),
  }
}

function internalRequest(path: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://internal${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function safeFolderId(value: string): boolean {
  return Boolean(value && value.length <= 256 && !value.includes('/') && !/[\u0000-\u001f]/.test(value))
}

function publicProjectSetupResult(result: ProjectSetupExecutionResult) {
  return {
    ...(result.projectId ? { projectId: result.projectId } : {}),
    ...(result.organizationId ? { organizationId: result.organizationId } : {}),
    ...(result.organizationSlug ? { organizationSlug: result.organizationSlug } : {}),
    locationIds: Array.from(new Set(result.replicas.map(replica => replica.locationId))),
    ...(result.project ? {
      project: {
        id: result.project.id,
        name: result.project.name,
        orgId: result.project.orgId,
        ...(result.project.workspaceId ? { workspaceId: result.project.workspaceId } : {}),
      },
    } : {}),
    plan: {
      requestId: result.plan.requestId,
      mode: result.plan.mode,
      state: result.plan.state,
      completed: result.plan.completed,
      syncCompleted: result.plan.syncCompleted,
      actions: result.plan.actions.map(action => ({
        type: action.type,
        status: action.status,
      })),
    },
  }
}

function dependencies(user: ApiUser, setupOperationId: string): ProjectSetupExecutionDependencies {
  const resourceIds = projectSetupOperationResourceIds(setupOperationId)
  return {
    async createProject(input) {
      return operationResponse(await handleProjectCreate(internalRequest('/api/v1/projects', input), user, {
        documentId: resourceIds.projectId,
        setupOperationId,
      }))
    },
    async createOrganization(input) {
      return operationResponse(await handleOrganizationCreate(internalRequest('/api/v1/organizations', input), user, {
        documentId: resourceIds.organizationId,
        setupOperationId,
      }))
    },
    resumeOrganization(input) {
      return resumeClientOrganizationWorkspace(input, {
        async getOrganization(organizationId) {
          const snapshot = await adminDb.collection('organizations').doc(organizationId).get()
          return snapshot.exists
            ? { id: snapshot.id, ...(snapshot.data() ?? {}) } as never
            : null
        },
        provision: provisionFullClientOnVps,
        upsertWorkspace: upsertOrgWorkspace,
        async patchOrganization(organizationId, patch) {
          await adminDb.collection('organizations').doc(organizationId).set(patch, { merge: true })
        },
        now: FieldValue.serverTimestamp,
      })
    },
    async getWorkspace(orgId, workspaceId) {
      const workspace = workspaceId
        ? await getOrgWorkspaceById(workspaceId)
        : await getDefaultOrgWorkspace(orgId)
      return workspace && workspace.orgId === orgId ? workspace : null
    },
    async getWorkspaceFolder(folderId, orgId, actor) {
      if (!safeFolderId(folderId)) return null
      const snapshot = await adminDb.collection(WORKSPACE_FOLDER_COLLECTION).doc(folderId).get()
      if (!snapshot.exists) return null
      const folder = serializeWorkspaceFolder(snapshot.id, snapshot.data() ?? {})
      if (folder.orgId !== orgId || folder.deleted || !canReadWorkspaceFolder(folder, actor)) return null
      return folder
    },
    listExecutionLocations(orgId, workspaceId, actorUserId) {
      return listExecutionLocationsForWorkspace(orgId, workspaceId, actorUserId)
    },
    provisionProjectFolder: provisionStandardProjectFolder,
    linkProjectLocation,
    async patchProject(projectId, patch) {
      await adminDb.collection('projects').doc(projectId).set({
        ...patch,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    },
    async patchWorkspaceFolder(folderId, patch) {
      await adminDb.collection(WORKSPACE_FOLDER_COLLECTION).doc(folderId).set({
        ...patch,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    },
  }
}

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return apiError('Invalid JSON body', 400)

  const idempotencyKey = req.headers.get('idempotency-key')?.trim() ?? ''
  if (!idempotencyKey) return apiError('Idempotency-Key header is required', 400)
  if (body.mode === 'full_client' && user.role !== 'admin') return apiError('admin role required for full_client setup', 403)

  if (body.mode !== 'full_client') {
    const orgId = clean(body.orgId)
    if (!orgId) return apiError('orgId is required', 400)
    if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  }

  let claim: Awaited<ReturnType<typeof setupOperations.claim>>
  try {
    claim = await setupOperations.claim({
      actorUserId: user.uid,
      idempotencyKey,
      requestFingerprint: projectSetupRequestFingerprint(body),
    })
  } catch (error) {
    if (error instanceof ProjectSetupIdempotencyError) return apiError(error.message, error.status)
    console.error('[project-setup-idempotency-claim]', error)
    return apiError('Project setup failed', 500)
  }

  if (claim.kind === 'in_progress') return apiError('Project setup is already in progress', 409)
  if (claim.kind === 'replay') {
    return apiSuccess(publicProjectSetupResult(claim.result), claim.result.status)
  }

  let latestCheckpoint = claim.checkpoint
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  try {
    await setupOperations.heartbeat({
      operationId: claim.operationId,
      leaseToken: claim.leaseToken,
    })
    heartbeatTimer = setInterval(() => {
      void setupOperations.heartbeat({
        operationId: claim.operationId,
        leaseToken: claim.leaseToken,
      }).catch(error => console.error('[project-setup-idempotency-heartbeat]', error))
    }, 60_000)
    const result = await executeProjectSetup(body, user, dependencies(user, claim.operationId), {
      requestId: claim.operationId,
      resume: claim.checkpoint,
      checkpoint: async (checkpoint) => {
        latestCheckpoint = checkpoint
        await setupOperations.checkpoint({
          operationId: claim.operationId,
          leaseToken: claim.leaseToken,
          checkpoint,
        })
      },
    })
    await setupOperations.finish({
      operationId: claim.operationId,
      leaseToken: claim.leaseToken,
      checkpoint: latestCheckpoint,
      result,
    })
    return apiSuccess(publicProjectSetupResult(result), result.status)
  } catch (error) {
    await setupOperations.fail({
      operationId: claim.operationId,
      leaseToken: claim.leaseToken,
      checkpoint: latestCheckpoint,
    }).catch(failure => console.error('[project-setup-idempotency-release]', failure))
    if (error instanceof ProjectSetupIdempotencyError) return apiError(error.message, error.status)
    if (error instanceof ProjectSetupExecutionError) {
      return apiError(error.status >= 500 ? 'Project setup failed' : error.message, error.status)
    }
    console.error('[project-setup-execution]', error)
    return apiError('Project setup failed', 500)
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
  }
})
