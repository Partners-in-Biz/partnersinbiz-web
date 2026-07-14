import { createHash } from 'node:crypto'
import type {
  ProjectContentManifest,
  ProjectSyncRequest,
  ProjectSyncWorkerBinding,
} from './model'

export interface ProjectSyncRuntimeObject {
  path: string
  sha256: string
  size: number
}

export interface ProjectSyncCasReadiness {
  revision: string
  objectCount: number
  verifiedObjectCount: number
  ready: boolean
}

export type ProjectSyncRuntimeLeasePayload =
  | { kind: 'inventory'; recurring: boolean; baselineRevision: string | null; bootstrapMissingRoot: boolean }
  | { kind: 'upload'; manifestRevision: string; objectStartIndex: number; objects: ProjectSyncRuntimeObject[] }
  | {
      kind: 'apply'
      transferId: string
      expectedTargetRevision: string | null
      manifestRevision: string
      objectSetHash: string
    }
  | { kind: 'failure'; transferId: string; reason: 'unsupported_scale' }

export type ProjectSyncRuntimeJob =
  | {
      jobId: string
      kind: 'inventory'
      binding: ProjectSyncWorkerBinding
      recurring: boolean
      baselineRevision: string | null
      bootstrapMissingRoot: boolean
    }
  | {
      jobId: string
      kind: 'upload'
      binding: ProjectSyncWorkerBinding
      manifest: ProjectContentManifest
      objectStartIndex: number
      objects: ProjectSyncRuntimeObject[]
    }
  | {
      jobId: string
      kind: 'failure'
      binding: ProjectSyncWorkerBinding
      transferId: string
      reason: 'unsupported_scale'
    }
  | {
      jobId: string
      kind: 'apply'
      binding: ProjectSyncWorkerBinding
      transferId: string
      expectedTargetRevision: string | null
      manifest: ProjectContentManifest
      objects: ProjectSyncRuntimeObject[]
    }

function jobId(...values: string[]): string {
  return `syncjob_${createHash('sha256').update(values.join('\0')).digest('hex').slice(0, 40)}`
}

function binding(request: ProjectSyncRequest, replicaId: string): ProjectSyncWorkerBinding | null {
  const replica = request.replicaStates.find((candidate) => candidate.replicaId === replicaId)
  return replica ? {
    capability: 'workspace.sync',
    requestId: request.requestId,
    orgId: request.orgId,
    projectId: request.projectId,
    replicaId: replica.replicaId,
    locationId: replica.locationId,
    mappingId: replica.mappingId,
  } : null
}

function files(manifest: ProjectContentManifest): ProjectSyncRuntimeObject[] {
  return manifest.entries.flatMap((entry) => entry.type === 'file'
    ? [{ path: entry.path, sha256: entry.sha256, size: entry.size }]
    : [])
}

export function uniqueManifestObjects(manifest: ProjectContentManifest): ProjectSyncRuntimeObject[] {
  const seen = new Set<string>()
  return files(manifest).filter((object) => {
    const identity = `${object.sha256}:${object.size}`
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

function objectSetHash(objects: ProjectSyncRuntimeObject[]): string {
  return createHash('sha256').update(JSON.stringify(objects)).digest('hex')
}

export function projectSyncRuntimeLeasePayload(job: ProjectSyncRuntimeJob): ProjectSyncRuntimeLeasePayload {
  if (job.kind === 'inventory') {
    return {
      kind: job.kind,
      recurring: job.recurring,
      baselineRevision: job.baselineRevision,
      bootstrapMissingRoot: job.bootstrapMissingRoot,
    }
  }
  if (job.kind === 'upload') {
    return {
      kind: job.kind,
      manifestRevision: job.manifest.revision,
      objectStartIndex: job.objectStartIndex,
      objects: job.objects,
    }
  }
  if (job.kind === 'failure') return { kind: job.kind, transferId: job.transferId, reason: job.reason }
  return {
    kind: job.kind,
    transferId: job.transferId,
    expectedTargetRevision: job.expectedTargetRevision,
    manifestRevision: job.manifest.revision,
    objectSetHash: objectSetHash(job.objects),
  }
}

export function projectSyncRuntimePayloadHash(job: ProjectSyncRuntimeJob): string {
  return createHash('sha256').update(JSON.stringify(projectSyncRuntimeLeasePayload(job))).digest('hex')
}

export function planProjectSyncRuntimeJob(input: {
  request: ProjectSyncRequest
  replicaId: string
  sourceManifest?: ProjectContentManifest | null
  targetManifest?: ProjectContentManifest | null
  casReadiness?: ProjectSyncCasReadiness | null
  verifiedSha256?: Set<string>
  now?: string
  recurringInventoryMs?: number
  uploadBatchSize?: number
}): ProjectSyncRuntimeJob | null {
  const request = input.request
  if (!request.continuousExecutorVerified || ['conflict', 'failed', 'cancelled'].includes(request.status)) return null
  const workerBinding = binding(request, input.replicaId)
  const replica = request.replicaStates.find((candidate) => candidate.replicaId === input.replicaId)
  if (!workerBinding || !replica) return null
  const nowMs = Date.parse(input.now ?? new Date().toISOString())
  const observedMs = replica.inventoryObservedAt ? Date.parse(replica.inventoryObservedAt) : 0
  const recurringDue = request.status === 'synced'
    && Number.isFinite(nowMs)
    && nowMs - observedMs >= (input.recurringInventoryMs ?? 30_000)
  if (replica.inventoryRevision === null || recurringDue) {
    const bucket = recurringDue ? String(Math.floor(nowMs / (input.recurringInventoryMs ?? 30_000))) : String(request.stateVersion)
    return {
      jobId: jobId(request.requestId, replica.replicaId, 'inventory', bucket),
      kind: 'inventory',
      binding: workerBinding,
      recurring: recurringDue,
      baselineRevision: replica.inventoryRevision,
      bootstrapMissingRoot: !recurringDue
        && replica.locationId !== request.canonicalLocationId
        && replica.currentRevision === null,
    }
  }

  const readiness = input.casReadiness
  const sourceTransfer = request.transfers.find((transfer) => transfer.sourceReplicaId === replica.replicaId && transfer.status === 'planned')
  if (sourceTransfer && input.sourceManifest?.revision === sourceTransfer.desiredRevision) {
    const allObjects = uniqueManifestObjects(input.sourceManifest)
    if (!readiness || readiness.revision !== input.sourceManifest.revision
      || readiness.objectCount !== allObjects.length || readiness.verifiedObjectCount < 0
      || readiness.verifiedObjectCount > readiness.objectCount
      || readiness.ready !== (readiness.verifiedObjectCount === readiness.objectCount)) return null
    const objectStartIndex = readiness.verifiedObjectCount
    const batchSize = Math.max(1, Math.min(100, input.uploadBatchSize ?? 16))
    const objects: ProjectSyncRuntimeObject[] = []
    let batchBytes = 0
    for (const object of allObjects.slice(objectStartIndex)) {
      if (objects.length >= batchSize || objects.length > 0 && batchBytes + object.size > 100 * 1024 * 1024) break
      objects.push(object)
      batchBytes += object.size
    }
    return objects.length ? {
      jobId: jobId(request.requestId, replica.replicaId, 'upload', sourceTransfer.desiredRevision, String(objectStartIndex)),
      kind: 'upload',
      binding: workerBinding,
      manifest: input.sourceManifest,
      objectStartIndex,
      objects,
    } : null
  }

  const targetTransfer = request.transfers.find((transfer) => transfer.targetReplicaId === replica.replicaId && transfer.status === 'planned')
  if (!targetTransfer || input.sourceManifest?.revision !== targetTransfer.desiredRevision
    || input.targetManifest?.revision !== targetTransfer.expectedTargetRevision) return null
  const sourceFiles = files(input.sourceManifest)
  const uniqueObjects = uniqueManifestObjects(input.sourceManifest)
  if (!readiness || readiness.revision !== input.sourceManifest.revision || !readiness.ready
    || readiness.objectCount !== uniqueObjects.length || readiness.verifiedObjectCount !== uniqueObjects.length) return null
  const targetFiles = new Map(input.targetManifest.entries.flatMap((entry) => entry.type === 'file'
    ? [[entry.path, entry] as const]
    : []))
  const sourceEntries = new Map(input.sourceManifest.entries.flatMap((entry) => entry.type === 'file'
    ? [[entry.path, entry] as const]
    : []))
  const objects = sourceFiles.filter((object) => {
    const current = targetFiles.get(object.path)
    const desired = sourceEntries.get(object.path)
    return !current || !desired || current.sha256 !== object.sha256 || current.size !== object.size
      || Boolean(current.executable) !== Boolean(desired.executable)
  })
  if (objects.length > 500 || objects.reduce((total, object) => total + object.size, 0) > 100 * 1024 * 1024) {
    return {
      jobId: jobId(request.requestId, replica.replicaId, 'failure', targetTransfer.transferId, 'unsupported_scale'),
      kind: 'failure',
      binding: workerBinding,
      transferId: targetTransfer.transferId,
      reason: 'unsupported_scale',
    }
  }
  return {
    jobId: jobId(request.requestId, replica.replicaId, 'apply', targetTransfer.transferId),
    kind: 'apply',
    binding: workerBinding,
    transferId: targetTransfer.transferId,
    expectedTargetRevision: targetTransfer.expectedTargetRevision,
    manifest: input.sourceManifest,
    objects,
  }
}
