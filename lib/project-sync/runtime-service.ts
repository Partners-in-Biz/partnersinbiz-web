import { adminDb } from '@/lib/firebase/admin'
import {
  recordAuthorizedProjectSyncFailure,
  recordAuthorizedProjectSyncInventory,
  recordAuthorizedProjectSyncTransferReceipt,
} from './coordinator'
import { createProjectSyncFirestoreRepository, type ProjectSyncFirestore } from './firestore'
import {
  authorizeProjectSyncWorker,
  createProjectSyncExecutorLookup,
  projectSyncStorageLifecycleVerified,
  type ProjectSyncExecutorLookup,
} from './native-executor'
import { validateProjectContentManifest, type ProjectContentManifest, type ProjectSyncWorkerBinding } from './model'
import {
  planProjectSyncRuntimeJob,
  uniqueManifestObjects,
  type ProjectSyncRuntimeJob,
  type ProjectSyncRuntimeObject,
} from './runtime-jobs'
import {
  createProjectSyncRuntimeRepository,
  type ProjectSyncRuntimeLease,
  type ProjectSyncRuntimeRepository,
} from './runtime-store'
import { createProjectSyncStorageBroker, type ProjectSyncStorageBroker } from './storage'

interface RuntimeServiceOptions {
  repository?: ProjectSyncRuntimeRepository
  lookup?: ProjectSyncExecutorLookup
  storage?: ProjectSyncStorageBroker
  now?: () => string
  storageLifecycleVerified?: boolean
}

function services(options: RuntimeServiceOptions) {
  return {
    repository: options.repository ?? createProjectSyncRuntimeRepository(),
    lookup: options.lookup ?? createProjectSyncExecutorLookup(),
    storage: options.storage ?? createProjectSyncStorageBroker(),
    now: options.now ?? (() => new Date().toISOString()),
  }
}

function manifestFiles(manifest: ProjectContentManifest): ProjectSyncRuntimeObject[] {
  return manifest.entries.flatMap((entry) => entry.type === 'file'
    ? [{ path: entry.path, sha256: entry.sha256, size: entry.size }]
    : [])
}

function sameBinding(left: ProjectSyncWorkerBinding, right: ProjectSyncWorkerBinding): boolean {
  return left.capability === right.capability && left.requestId === right.requestId && left.orgId === right.orgId
    && left.projectId === right.projectId && left.replicaId === right.replicaId
    && left.locationId === right.locationId && left.mappingId === right.mappingId
}

async function exactLease(
  repository: ProjectSyncRuntimeRepository,
  input: {
    jobId: string
    identity: { deviceId: string; credentialVersion: number }
    binding: ProjectSyncWorkerBinding
    kind: ProjectSyncRuntimeJob['kind']
  },
): Promise<ProjectSyncRuntimeLease> {
  const lease = await repository.getLease(input.jobId)
  if (!lease || lease.jobKind !== input.kind || !sameBinding(lease.binding, input.binding)
    || lease.deviceId !== input.identity.deviceId || input.identity.credentialVersion < lease.credentialVersion
    || lease.payload.kind !== input.kind) {
    throw new Error('project sync runtime lease does not match this receipt')
  }
  return lease
}

function exactObjectSet(received: ProjectSyncRuntimeObject[], expected: ProjectSyncRuntimeObject[]): boolean {
  if (received.length !== expected.length) return false
  const keyed = new Map<string, ProjectSyncRuntimeObject>()
  for (const object of received) {
    const identity = `${object.path}\0${object.sha256}\0${object.size}`
    if (keyed.has(identity)) return false
    keyed.set(identity, object)
  }
  return expected.every((object) => keyed.has(`${object.path}\0${object.sha256}\0${object.size}`))
}

export type MaterializedProjectSyncJob = ProjectSyncRuntimeJob & {
  relativePath: string
  objects?: Array<ProjectSyncRuntimeObject & { url: string; expiresAt: string; headers?: Record<string, string> }>
}

export async function claimDeviceProjectSyncJob(
  identity: { deviceId: string; credentialVersion: number },
  options: RuntimeServiceOptions = {},
): Promise<MaterializedProjectSyncJob | null> {
  if (!(options.storageLifecycleVerified ?? projectSyncStorageLifecycleVerified())) return null
  const service = services(options)
  const replicas = await service.repository.listDeviceReplicas(identity.deviceId)
  for (const row of replicas) {
    if (row.active !== true || typeof row.replicaId !== 'string') continue
    const syncRequest = row.syncRequest && typeof row.syncRequest === 'object'
      ? row.syncRequest as Record<string, unknown>
      : {}
    if (typeof syncRequest.requestId !== 'string') continue
    const request = await service.repository.getRequest(syncRequest.requestId)
    if (!request) continue
    const state = request.replicaStates.find((candidate) => candidate.replicaId === row.replicaId)
    if (!state) continue
    const binding: ProjectSyncWorkerBinding = {
      capability: 'workspace.sync',
      requestId: request.requestId,
      orgId: request.orgId,
      projectId: request.projectId,
      replicaId: state.replicaId,
      locationId: state.locationId,
      mappingId: state.mappingId,
    }
    let authorized: Awaited<ReturnType<typeof authorizeProjectSyncWorker>>
    try {
      authorized = await authorizeProjectSyncWorker({ identity, binding }, { lookup: service.lookup })
    } catch {
      continue
    }
    const targetManifest = await service.repository.getManifest(request.requestId, state.replicaId)
    const transfer = request.transfers.find((candidate) => candidate.targetReplicaId === state.replicaId)
      ?? request.transfers.find((candidate) => candidate.sourceReplicaId === state.replicaId)
    const sourceReplicaId = transfer?.sourceReplicaId ?? state.replicaId
    const sourceManifest = await service.repository.getManifest(request.requestId, sourceReplicaId)
    const casReadiness = sourceManifest
      ? await service.repository.ensureCasReadiness({
          orgId: request.orgId,
          projectId: request.projectId,
          manifest: sourceManifest,
          now: service.now(),
        })
      : null
    const planned = planProjectSyncRuntimeJob({
      request,
      replicaId: state.replicaId,
      sourceManifest,
      targetManifest,
      casReadiness,
      now: service.now(),
    })
    if (!planned) continue
    const relativePath = String(authorized.replica.relativePath)
    let materialized: MaterializedProjectSyncJob
    if (planned.kind === 'upload') {
      const objects = await Promise.all(planned.objects.map(async (object) => ({
        ...object,
        ...await service.storage.signUpload({ orgId: request.orgId, projectId: request.projectId, sha256: object.sha256, size: object.size }),
      })))
      materialized = { ...planned, relativePath, objects }
    } else if (planned.kind === 'apply') {
      const objects = await Promise.all(planned.objects.map(async (object) => ({
        ...object,
        ...await service.storage.signDownload({ orgId: request.orgId, projectId: request.projectId, sha256: object.sha256, size: object.size }),
      })))
      materialized = { ...planned, relativePath, objects }
    } else {
      materialized = { ...planned, relativePath }
    }
    const leased = await service.repository.tryLease({
      job: planned,
      binding,
      deviceId: identity.deviceId,
      credentialVersion: identity.credentialVersion,
      now: service.now(),
    })
    if (!leased) continue
    return materialized
  }
  return null
}

export async function recordDeviceProjectSyncInventory(input: {
  identity: { deviceId: string; credentialVersion: number }
  jobId: string
  binding: ProjectSyncWorkerBinding
  manifest: ProjectContentManifest
  pristineBootstrap?: boolean
  observedAt: string
}, options: RuntimeServiceOptions & { coordinatorRepository?: ReturnType<typeof createProjectSyncFirestoreRepository> } = {}) {
  const manifest = validateProjectContentManifest(input.manifest, input.binding.projectId)
  const service = services(options)
  await authorizeProjectSyncWorker({ identity: input.identity, binding: input.binding }, { lookup: service.lookup })
  const lease = await exactLease(service.repository, { ...input, kind: 'inventory' })
  if (input.pristineBootstrap === true) {
    if (lease.payload.kind !== 'inventory' || lease.payload.bootstrapMissingRoot !== true) {
      throw new Error('project sync inventory is not bound to a pristine bootstrap lease')
    }
    if (manifest.entries.length !== 0 || manifest.entryCount !== 0 || manifest.totalBytes !== 0) {
      throw new Error('project sync pristine bootstrap requires an empty manifest')
    }
  }
  if (lease.status === 'completed') {
    const completed = await service.repository.getRequest(input.binding.requestId)
    if (!completed) throw new Error('project sync request not found')
    return completed
  }
  await service.repository.putManifest(input.binding.requestId, input.binding.replicaId, manifest)
  const request = await recordAuthorizedProjectSyncInventory({
    requestId: input.binding.requestId,
    report: {
      binding: input.binding,
      manifest,
      pristineBootstrap: input.pristineBootstrap === true,
      observedAt: input.observedAt,
    },
  }, {
    repository: options.coordinatorRepository
      ?? createProjectSyncFirestoreRepository(adminDb as unknown as ProjectSyncFirestore),
  })
  await service.repository.completeLease({
    jobId: input.jobId,
    identity: input.identity,
    binding: input.binding,
    jobKind: 'inventory',
    payloadHash: lease.payloadHash,
  })
  return request
}

export async function recordDeviceProjectSyncUploadReceipt(input: {
  identity: { deviceId: string; credentialVersion: number }
  jobId: string
  binding: ProjectSyncWorkerBinding
  objects: ProjectSyncRuntimeObject[]
}, options: RuntimeServiceOptions = {}): Promise<void> {
  const service = services(options)
  const authorized = await authorizeProjectSyncWorker({ identity: input.identity, binding: input.binding }, { lookup: service.lookup })
  const lease = await exactLease(service.repository, { ...input, kind: 'upload' })
  if (lease.status === 'completed') return
  if (lease.payload.kind !== 'upload' || !exactObjectSet(input.objects, lease.payload.objects)) {
    throw new Error('project sync upload receipt must contain the complete leased object set')
  }
  const manifest = await service.repository.getManifest(input.binding.requestId, input.binding.replicaId)
  if (!manifest) throw new Error('project sync source manifest not found')
  validateProjectContentManifest(manifest, input.binding.projectId)
  if (lease.payload.manifestRevision !== manifest.revision) {
    throw new Error('project sync upload receipt manifest revision mismatch')
  }
  const allowed = new Map(manifestFiles(manifest).map((object) => [object.path, object]))
  for (const object of input.objects) {
    const expected = allowed.get(object.path)
    if (!expected || expected.sha256 !== object.sha256 || expected.size !== object.size) {
      throw new Error('project sync upload receipt manifest mismatch')
    }
    const verified = await service.storage.verifyUpload({
      orgId: input.binding.orgId,
      projectId: input.binding.projectId,
      sha256: object.sha256,
      size: object.size,
    })
    await service.repository.markObjectVerified({
      orgId: input.binding.orgId,
      projectId: input.binding.projectId,
      sha256: object.sha256,
      size: object.size,
      objectPath: verified.objectPath,
    })
  }
  if (authorized.request.transfers.some((transfer) => transfer.sourceReplicaId !== input.binding.replicaId)) {
    throw new Error('project sync upload receipt source mismatch')
  }
  const objectCount = uniqueManifestObjects(manifest).length
  const verifiedObjectCount = lease.payload.objectStartIndex + lease.payload.objects.length
  await service.repository.advanceCasReadiness({
    orgId: input.binding.orgId,
    projectId: input.binding.projectId,
    revision: manifest.revision,
    objectCount,
    expectedVerifiedObjectCount: lease.payload.objectStartIndex,
    verifiedObjectCount,
    now: service.now(),
  })
  await service.repository.completeLease({
    jobId: input.jobId,
    identity: input.identity,
    binding: input.binding,
    jobKind: 'upload',
    payloadHash: lease.payloadHash,
  })
}

export async function recordDeviceProjectSyncTransferReceipt(input: {
  identity: { deviceId: string; credentialVersion: number }
  jobId: string
  binding: ProjectSyncWorkerBinding
  transferId: string
  beforeRevision: string | null
  appliedRevision: string
  verifiedManifestRevision: string
  verifiedAt: string
}, options: RuntimeServiceOptions & { coordinatorRepository?: ReturnType<typeof createProjectSyncFirestoreRepository> } = {}) {
  const service = services(options)
  await authorizeProjectSyncWorker({ identity: input.identity, binding: input.binding }, { lookup: service.lookup })
  const lease = await exactLease(service.repository, { ...input, kind: 'apply' })
  if (lease.status === 'completed') {
    const completed = await service.repository.getRequest(input.binding.requestId)
    if (!completed) throw new Error('project sync request not found')
    return completed
  }
  if (lease.payload.kind !== 'apply' || lease.payload.transferId !== input.transferId
    || lease.payload.expectedTargetRevision !== input.beforeRevision
    || lease.payload.manifestRevision !== input.appliedRevision
    || lease.payload.manifestRevision !== input.verifiedManifestRevision) {
    throw new Error('project sync transfer receipt does not match its leased payload')
  }
  const request = await recordAuthorizedProjectSyncTransferReceipt({
    requestId: input.binding.requestId,
    report: {
      binding: input.binding,
      transferId: input.transferId,
      beforeRevision: input.beforeRevision,
      appliedRevision: input.appliedRevision,
      verifiedManifestRevision: input.verifiedManifestRevision,
      verifiedAt: input.verifiedAt,
    },
  }, {
    repository: options.coordinatorRepository
      ?? createProjectSyncFirestoreRepository(adminDb as unknown as ProjectSyncFirestore),
  })
  await service.repository.completeLease({
    jobId: input.jobId,
    identity: input.identity,
    binding: input.binding,
    jobKind: 'apply',
    payloadHash: lease.payloadHash,
  })
  return request
}

export async function recordDeviceProjectSyncFailure(input: {
  identity: { deviceId: string; credentialVersion: number }
  jobId: string
  binding: ProjectSyncWorkerBinding
  jobKind: ProjectSyncRuntimeJob['kind']
  transferId?: string
  reason: 'non_destructive_apply_required' | 'unsupported_scale' | 'unsupported_path' | 'target_drift' | 'source_drift' | 'integrity_failure' | 'retryable_transport'
  observedRevision?: string
  failedAt: string
}, options: RuntimeServiceOptions & { coordinatorRepository?: ReturnType<typeof createProjectSyncFirestoreRepository> } = {}) {
  const service = services(options)
  const authorized = await authorizeProjectSyncWorker({ identity: input.identity, binding: input.binding }, { lookup: service.lookup })
  const lease = await exactLease(service.repository, { ...input, kind: input.jobKind })
  if (lease.status === 'completed') {
    const completed = await service.repository.getRequest(input.binding.requestId)
    if (!completed) throw new Error('project sync request not found')
    return completed
  }
  if (input.reason === 'retryable_transport') {
    await service.repository.releaseLease({
      jobId: input.jobId,
      identity: input.identity,
      binding: input.binding,
      jobKind: input.jobKind,
      payloadHash: lease.payloadHash,
    })
    return authorized.request
  }
  const payloadMatches = lease.payload.kind === 'apply'
    ? input.jobKind === 'apply' && lease.payload.transferId === input.transferId
      && ['non_destructive_apply_required', 'target_drift', 'integrity_failure'].includes(input.reason)
    : lease.payload.kind === 'failure' && input.jobKind === 'failure'
      ? lease.payload.transferId === input.transferId && lease.payload.reason === input.reason
      : lease.payload.kind === 'upload' && input.jobKind === 'upload' && input.reason === 'source_drift'
        ? true
        : lease.payload.kind === 'inventory' && input.jobKind === 'inventory'
          && ['unsupported_path', 'unsupported_scale'].includes(input.reason)
  if (!payloadMatches) {
    throw new Error('project sync failure does not match its leased payload')
  }
  const request = await recordAuthorizedProjectSyncFailure({
    requestId: input.binding.requestId,
    report: {
      binding: input.binding,
      transferId: input.transferId,
      reason: input.reason,
      observedRevision: input.observedRevision,
      failedAt: input.failedAt,
    },
  }, {
    repository: options.coordinatorRepository
      ?? createProjectSyncFirestoreRepository(adminDb as unknown as ProjectSyncFirestore),
  })
  await service.repository.completeLease({
    jobId: input.jobId,
    identity: input.identity,
    binding: input.binding,
    jobKind: input.jobKind,
    payloadHash: lease.payloadHash,
  })
  return request
}
