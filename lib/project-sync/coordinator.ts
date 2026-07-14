import { createHash } from 'node:crypto'
import {
  applyProjectSyncInventory,
  applyProjectSyncRuntimeFailure,
  applyProjectSyncTransferReceipt,
  cancelProjectSyncRequest,
  createProjectSyncRequest,
  type ProjectContentManifest,
  type ProjectSyncReplicaInput,
  type ProjectSyncRequest,
  type ProjectSyncWorkerBinding,
} from './model'

export interface ProjectSyncReplicaPatch {
  replicaId: string
  patch: Record<string, unknown>
}

export interface ProjectSyncCoordinatorRepository {
  getRequest(requestId: string): Promise<ProjectSyncRequest | null>
  createIfNoActive(
    request: ProjectSyncRequest,
    replicaPatches: ProjectSyncReplicaPatch[],
  ): Promise<{ created: boolean; request: ProjectSyncRequest }>
  compareAndSet(
    requestId: string,
    expectedStateVersion: number,
    request: ProjectSyncRequest,
    replicaPatches: ProjectSyncReplicaPatch[],
  ): Promise<boolean>
}

function requestId(orgId: string, projectId: string, idempotencyKey: string): string {
  const key = idempotencyKey.trim()
  if (!key || key.length > 256 || /[\u0000-\u001f]/.test(key)) throw new Error('project sync idempotency key is invalid')
  return `psync_${createHash('sha256').update(`${orgId}\0${projectId}\0${key}`).digest('hex').slice(0, 40)}`
}

function replicaSyncStatus(request: ProjectSyncRequest, replicaId: string): string {
  const state = request.replicaStates.find((candidate) => candidate.replicaId === replicaId)
  if (!state) throw new Error('project sync replica state is missing')
  if (state.status === 'offline') return 'offline'
  if (request.status === 'conflict' || state.status === 'conflict') return 'conflict'
  if (request.status === 'synced' && state.status === 'synced') return 'synced'
  if (request.status === 'ready' || request.status === 'transferring') return 'syncing'
  if (request.status === 'failed') return 'error'
  return 'pending'
}

export function projectSyncReplicaPatches(request: ProjectSyncRequest): ProjectSyncReplicaPatch[] {
  return request.replicaStates.map((state) => {
    const syncStatus = replicaSyncStatus(request, state.replicaId)
    return {
      replicaId: state.replicaId,
      patch: {
        availability: state.availability,
        currentRevision: state.currentRevision,
        desiredRevision: state.desiredRevision,
        syncStatus,
        updatedAt: request.updatedAt,
        syncRequest: {
          requestId: request.requestId,
          status: request.status,
          stateVersion: request.stateVersion,
          canonicalLocationId: request.canonicalLocationId,
          transferProtocol: request.transferProtocol,
          continuousExecutorVerified: request.continuousExecutorVerified,
        },
        ...(request.conflict ? {
          lastConflict: {
            requestId: request.requestId,
            kind: request.conflict.kind,
            status: request.conflict.status,
            detectedAt: request.conflict.detectedAt,
            revisions: request.conflict.revisions,
            automaticOverwriteAllowed: false,
          },
        } : {}),
        ...(syncStatus === 'synced' && request.canonicalRevision ? {
          lastSync: {
            requestId: request.requestId,
            revision: request.canonicalRevision,
            verifiedAt: request.updatedAt,
            kind: request.transfers.length > 0 ? 'transfer_verified' : 'manifest_match',
            continuousExecutorVerified: request.continuousExecutorVerified,
          },
          lastError: null,
          lastConflict: null,
        } : {}),
      },
    }
  })
}

export async function startProjectSync(input: {
  orgId: string
  projectId: string
  canonicalLocationId: string
  requestedByUserId: string
  replicas: ProjectSyncReplicaInput[]
  continuousExecutorVerified?: boolean
  idempotencyKey: string
  now: string
}, options: { repository: ProjectSyncCoordinatorRepository }): Promise<{ created: boolean; request: ProjectSyncRequest }> {
  const request = createProjectSyncRequest({
    requestId: requestId(input.orgId, input.projectId, input.idempotencyKey),
    orgId: input.orgId,
    projectId: input.projectId,
    canonicalLocationId: input.canonicalLocationId,
    requestedByUserId: input.requestedByUserId,
    replicas: input.replicas,
    continuousExecutorVerified: input.continuousExecutorVerified,
    now: input.now,
  })
  return options.repository.createIfNoActive(request, projectSyncReplicaPatches(request))
}

async function persistTransition(
  current: ProjectSyncRequest,
  next: ProjectSyncRequest,
  repository: ProjectSyncCoordinatorRepository,
): Promise<ProjectSyncRequest> {
  const saved = await repository.compareAndSet(
    current.requestId,
    current.stateVersion,
    next,
    projectSyncReplicaPatches(next),
  )
  if (!saved) throw new Error('project sync state changed concurrently; reload before retrying')
  return next
}

export async function recordAuthorizedProjectSyncInventory(input: {
  requestId: string
  report: {
    binding: ProjectSyncWorkerBinding
    manifest: ProjectContentManifest
    pristineBootstrap?: boolean
    observedAt: string
  }
}, options: { repository: ProjectSyncCoordinatorRepository }): Promise<ProjectSyncRequest> {
  const current = await options.repository.getRequest(input.requestId)
  if (!current) throw new Error('project sync request not found')
  const next = applyProjectSyncInventory(current, input.report)
  return persistTransition(current, next, options.repository)
}

export async function recordAuthorizedProjectSyncTransferReceipt(input: {
  requestId: string
  report: {
    binding: ProjectSyncWorkerBinding
    transferId: string
    beforeRevision: string | null
    appliedRevision: string
    verifiedManifestRevision: string
    verifiedAt: string
  }
}, options: { repository: ProjectSyncCoordinatorRepository }): Promise<ProjectSyncRequest> {
  const current = await options.repository.getRequest(input.requestId)
  if (!current) throw new Error('project sync request not found')
  const next = applyProjectSyncTransferReceipt(current, input.report)
  return persistTransition(current, next, options.repository)
}

export async function recordAuthorizedProjectSyncFailure(input: {
  requestId: string
  report: {
    binding: ProjectSyncWorkerBinding
    transferId?: string
    reason: 'non_destructive_apply_required' | 'unsupported_scale' | 'unsupported_path' | 'target_drift' | 'source_drift' | 'integrity_failure'
    observedRevision?: string
    failedAt: string
  }
}, options: { repository: ProjectSyncCoordinatorRepository }): Promise<ProjectSyncRequest> {
  const current = await options.repository.getRequest(input.requestId)
  if (!current) throw new Error('project sync request not found')
  const next = applyProjectSyncRuntimeFailure(current, input.report)
  return persistTransition(current, next, options.repository)
}

export async function cancelProjectSync(input: {
  requestId: string
  cancelledAt: string
}, options: { repository: ProjectSyncCoordinatorRepository }): Promise<ProjectSyncRequest> {
  const current = await options.repository.getRequest(input.requestId)
  if (!current) throw new Error('project sync request not found')
  const next = cancelProjectSyncRequest(current, input.cancelledAt)
  if (next === current) return current
  return persistTransition(current, next, options.repository)
}
