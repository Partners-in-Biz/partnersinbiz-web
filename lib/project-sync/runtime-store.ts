import { createHash } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { ProjectContentManifest, ProjectManifestEntry, ProjectSyncRequest, ProjectSyncWorkerBinding } from './model'
import {
  projectSyncRuntimeLeasePayload,
  projectSyncRuntimePayloadHash,
  uniqueManifestObjects,
  type ProjectSyncCasReadiness,
  type ProjectSyncRuntimeJob,
  type ProjectSyncRuntimeLeasePayload,
} from './runtime-jobs'

const MANIFEST_CHUNK_ENTRIES = 500
export const DEFAULT_PROJECT_SYNC_RUNTIME_LEASE_MS = 6 * 60 * 60_000
const PROJECT_SYNC_STATE_RETENTION_MS = 30 * 24 * 60 * 60_000
const PROJECT_SYNC_OBJECT_RETENTION_MS = 35 * 24 * 60 * 60_000
export const PROJECT_SYNC_RUNTIME_JOB_RETENTION_MS = 30 * 24 * 60 * 60_000

type Row = Record<string, unknown>
interface Snapshot { exists: boolean; id: string; data(): Row | undefined }
interface Reference { id: string; get(): Promise<Snapshot>; set(data: Row, options?: { merge?: boolean }): Promise<unknown> }
interface Query { where(field: string, operation: string, value: unknown): Query; get(): Promise<{ docs: Snapshot[] }> }
interface Collection extends Query { doc(id: string): Reference }
interface Transaction { get(reference: Reference): Promise<Snapshot>; set(reference: Reference, data: Row, options?: { merge?: boolean }): void }
interface Batch { set(reference: Reference, data: Row, options?: { merge?: boolean }): void; commit(): Promise<unknown> }
interface RuntimeFirestore {
  collection(name: string): Collection
  runTransaction<T>(callback: (transaction: Transaction) => Promise<T>): Promise<T>
  batch(): Batch
}

export interface ProjectSyncRuntimeRepository {
  listDeviceReplicas(deviceId: string): Promise<Row[]>
  getRequest(requestId: string): Promise<ProjectSyncRequest | null>
  getManifest(requestId: string, replicaId: string): Promise<ProjectContentManifest | null>
  putManifest(requestId: string, replicaId: string, manifest: ProjectContentManifest): Promise<void>
  ensureCasReadiness(input: { orgId: string; projectId: string; manifest: ProjectContentManifest; now: string }): Promise<ProjectSyncCasReadiness>
  advanceCasReadiness(input: {
    orgId: string
    projectId: string
    revision: string
    objectCount: number
    expectedVerifiedObjectCount: number
    verifiedObjectCount: number
    now: string
  }): Promise<ProjectSyncCasReadiness>
  markObjectVerified(input: { orgId: string; projectId: string; sha256: string; size: number; objectPath: string }): Promise<void>
  tryLease(input: { job: ProjectSyncRuntimeJob; binding: ProjectSyncWorkerBinding; deviceId: string; credentialVersion: number; now: string; ttlMs?: number }): Promise<boolean>
  getLease(jobId: string): Promise<ProjectSyncRuntimeLease | null>
  completeLease(input: {
    jobId: string
    identity: { deviceId: string; credentialVersion: number }
    binding: ProjectSyncWorkerBinding
    jobKind: ProjectSyncRuntimeJob['kind']
    payloadHash: string
    now?: string
  }): Promise<void>
  releaseLease(input: {
    jobId: string
    identity: { deviceId: string; credentialVersion: number }
    binding: ProjectSyncWorkerBinding
    jobKind: ProjectSyncRuntimeJob['kind']
    payloadHash: string
    now?: string
  }): Promise<void>
}

export interface ProjectSyncRuntimeLease {
  jobId: string
  jobKind: ProjectSyncRuntimeJob['kind']
  binding: ProjectSyncWorkerBinding
  deviceId: string
  credentialVersion: number
  payloadHash: string
  payload: ProjectSyncRuntimeLeasePayload
  status: 'leased' | 'completed'
}

function key(...values: string[]): string {
  return createHash('sha256').update(values.join('\0')).digest('hex')
}

function timestampMs(value: unknown): number {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis()
  }
  const parsed = Date.parse(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : 0
}

export function createProjectSyncRuntimeRepository(
  db = adminDb as unknown as RuntimeFirestore,
): ProjectSyncRuntimeRepository {
  const manifestHeadId = (requestId: string, replicaId: string) => `manifest_${key(requestId, replicaId).slice(0, 40)}`
  const objectId = (orgId: string, projectId: string, sha256: string) => `object_${key(orgId, projectId, sha256).slice(0, 40)}`
  const readinessId = (orgId: string, projectId: string, revision: string) => `readiness_${key(orgId, projectId, revision).slice(0, 40)}`
  return {
    async listDeviceReplicas(deviceId) {
      const snapshot = await db.collection('project_location_replicas')
        .where('locationId', '==', `linked-device:${deviceId}`)
        .get()
      return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() ?? {}) }))
    },

    async getRequest(requestId) {
      const snapshot = await db.collection('project_sync_requests').doc(requestId).get()
      return snapshot.exists ? snapshot.data() as unknown as ProjectSyncRequest : null
    },

    async getManifest(requestId, replicaId) {
      const head = await db.collection('project_sync_manifest_heads').doc(manifestHeadId(requestId, replicaId)).get()
      const data = head.data() ?? {}
      if (!head.exists || typeof data.manifestId !== 'string' || !Number.isSafeInteger(data.chunkCount)) return null
      const chunks = await Promise.all(Array.from({ length: Number(data.chunkCount) }, (_, index) => (
        db.collection('project_sync_manifest_chunks').doc(`${data.manifestId}_${index}`).get()
      )))
      if (chunks.some((chunk) => !chunk.exists || !Array.isArray(chunk.data()?.entries))) return null
      const entries = chunks.flatMap((chunk) => chunk.data()!.entries as ProjectManifestEntry[])
      return {
        version: 1,
        projectId: String(data.projectId),
        revision: String(data.revision),
        entryCount: Number(data.entryCount),
        totalBytes: Number(data.totalBytes),
        entries,
      }
    },

    async putManifest(requestId, replicaId, manifest) {
      const expiresAt = Timestamp.fromMillis(Date.now() + PROJECT_SYNC_STATE_RETENTION_MS)
      const manifestId = `manifest_${key(requestId, replicaId, manifest.revision).slice(0, 40)}`
      const chunks = Array.from({ length: Math.ceil(manifest.entries.length / MANIFEST_CHUNK_ENTRIES) || 1 }, (_, index) => (
        manifest.entries.slice(index * MANIFEST_CHUNK_ENTRIES, (index + 1) * MANIFEST_CHUNK_ENTRIES)
      ))
      const batch = db.batch()
      chunks.forEach((entries, index) => batch.set(
        db.collection('project_sync_manifest_chunks').doc(`${manifestId}_${index}`),
        { manifestId, index, entries, expiresAt },
      ))
      batch.set(db.collection('project_sync_manifest_heads').doc(manifestHeadId(requestId, replicaId)), {
        requestId,
        replicaId,
        manifestId,
        projectId: manifest.projectId,
        revision: manifest.revision,
        entryCount: manifest.entryCount,
        totalBytes: manifest.totalBytes,
        chunkCount: chunks.length,
        updatedAt: new Date().toISOString(),
        expiresAt,
      })
      await batch.commit()
    },

    async ensureCasReadiness(input) {
      const objectCount = uniqueManifestObjects(input.manifest).length
      const readinessRef = db.collection('project_sync_cas_readiness').doc(
        readinessId(input.orgId, input.projectId, input.manifest.revision),
      )
      return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(readinessRef)
        const row = snapshot.data() ?? {}
        if (snapshot.exists) {
          if (row.orgId !== input.orgId || row.projectId !== input.projectId
            || row.revision !== input.manifest.revision || row.objectCount !== objectCount
            || !Number.isSafeInteger(row.verifiedObjectCount)) {
            throw new Error('project sync CAS readiness integrity check failed')
          }
          const verifiedObjectCount = Number(row.verifiedObjectCount)
          if (verifiedObjectCount < 0 || verifiedObjectCount > objectCount) {
            throw new Error('project sync CAS readiness integrity check failed')
          }
          transaction.set(readinessRef, {
            updatedAt: input.now,
            expiresAt: Timestamp.fromMillis(Date.parse(input.now) + PROJECT_SYNC_STATE_RETENTION_MS),
          }, { merge: true })
          return { revision: input.manifest.revision, objectCount, verifiedObjectCount, ready: verifiedObjectCount === objectCount }
        }
        transaction.set(readinessRef, {
          orgId: input.orgId,
          projectId: input.projectId,
          revision: input.manifest.revision,
          objectCount,
          verifiedObjectCount: 0,
          status: objectCount === 0 ? 'ready' : 'pending',
          createdAt: input.now,
          updatedAt: input.now,
          expiresAt: Timestamp.fromMillis(Date.parse(input.now) + PROJECT_SYNC_STATE_RETENTION_MS),
        })
        return { revision: input.manifest.revision, objectCount, verifiedObjectCount: 0, ready: objectCount === 0 }
      })
    },

    async advanceCasReadiness(input) {
      const readinessRef = db.collection('project_sync_cas_readiness').doc(
        readinessId(input.orgId, input.projectId, input.revision),
      )
      return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(readinessRef)
        const row = snapshot.data() ?? {}
        if (!snapshot.exists || row.orgId !== input.orgId || row.projectId !== input.projectId
          || row.revision !== input.revision || row.objectCount !== input.objectCount
          || !Number.isSafeInteger(row.verifiedObjectCount)) {
          throw new Error('project sync CAS readiness integrity check failed')
        }
        const current = Number(row.verifiedObjectCount)
        if (input.verifiedObjectCount < 0 || input.verifiedObjectCount > input.objectCount
          || (current !== input.expectedVerifiedObjectCount && current !== input.verifiedObjectCount)) {
          throw new Error('project sync CAS readiness changed before upload verification')
        }
        if (current === input.expectedVerifiedObjectCount) {
          transaction.set(readinessRef, {
            verifiedObjectCount: input.verifiedObjectCount,
            status: input.verifiedObjectCount === input.objectCount ? 'ready' : 'pending',
            updatedAt: input.now,
            expiresAt: Timestamp.fromMillis(Date.parse(input.now) + PROJECT_SYNC_STATE_RETENTION_MS),
          }, { merge: true })
        }
        return {
          revision: input.revision,
          objectCount: input.objectCount,
          verifiedObjectCount: input.verifiedObjectCount,
          ready: input.verifiedObjectCount === input.objectCount,
        }
      })
    },

    async markObjectVerified(input) {
      const now = Date.now()
      await db.collection('project_sync_objects').doc(objectId(input.orgId, input.projectId, input.sha256)).set({
        ...input,
        status: 'verified',
        verifiedAt: new Date(now).toISOString(),
        expiresAt: Timestamp.fromMillis(now + PROJECT_SYNC_OBJECT_RETENTION_MS),
      }, { merge: true })
    },

    async tryLease(input) {
      if (input.job.jobId.length < 1 || input.job.binding.requestId !== input.binding.requestId
        || input.job.binding.replicaId !== input.binding.replicaId) {
        throw new Error('project sync runtime job binding mismatch')
      }
      const leaseRef = db.collection('project_sync_runtime_jobs').doc(input.job.jobId)
      const nowMs = Date.parse(input.now)
      const payload = projectSyncRuntimeLeasePayload(input.job)
      const payloadHash = projectSyncRuntimePayloadHash(input.job)
      return db.runTransaction(async (transaction) => {
        const current = await transaction.get(leaseRef)
        const row = current.data() ?? {}
        if (current.exists && (row.jobKind !== input.job.kind || row.payloadHash !== payloadHash
          || row.requestId !== input.binding.requestId || row.replicaId !== input.binding.replicaId
          || row.deviceId !== input.deviceId)) {
          throw new Error('project sync runtime lease contract mismatch')
        }
        if (row.status === 'completed') return false
        if (row.status === 'leased' && timestampMs(row.leaseExpiresAt) > nowMs) return false
        transaction.set(leaseRef, {
          jobId: input.job.jobId,
          jobKind: input.job.kind,
          payload,
          payloadHash,
          requestId: input.binding.requestId,
          orgId: input.binding.orgId,
          projectId: input.binding.projectId,
          replicaId: input.binding.replicaId,
          locationId: input.binding.locationId,
          mappingId: input.binding.mappingId,
          deviceId: input.deviceId,
          credentialVersion: input.credentialVersion,
          status: 'leased',
          leasedAt: input.now,
          leaseExpiresAt: Timestamp.fromMillis(nowMs + (input.ttlMs ?? DEFAULT_PROJECT_SYNC_RUNTIME_LEASE_MS)),
          expiresAt: Timestamp.fromMillis(nowMs + PROJECT_SYNC_RUNTIME_JOB_RETENTION_MS),
          updatedAt: input.now,
        }, { merge: true })
        return true
      })
    },

    async getLease(jobId) {
      const snapshot = await db.collection('project_sync_runtime_jobs').doc(jobId).get()
      if (!snapshot.exists) return null
      const row = snapshot.data() ?? {}
      if (!['inventory', 'upload', 'apply', 'failure'].includes(String(row.jobKind))
        || !['leased', 'completed'].includes(String(row.status)) || typeof row.payloadHash !== 'string'
        || !row.payload || typeof row.payload !== 'object'
        || (row.payload as Row).kind !== row.jobKind
        || createHash('sha256').update(JSON.stringify(row.payload)).digest('hex') !== row.payloadHash
        || [row.requestId, row.orgId, row.projectId, row.replicaId, row.locationId, row.mappingId, row.deviceId]
          .some((value) => typeof value !== 'string' || value.length < 1)
        || !Number.isSafeInteger(row.credentialVersion)) return null
      return {
        jobId,
        jobKind: row.jobKind as ProjectSyncRuntimeJob['kind'],
        binding: {
          capability: 'workspace.sync',
          requestId: String(row.requestId),
          orgId: String(row.orgId),
          projectId: String(row.projectId),
          replicaId: String(row.replicaId),
          locationId: String(row.locationId),
          mappingId: String(row.mappingId),
        },
        deviceId: String(row.deviceId),
        credentialVersion: Number(row.credentialVersion),
        payloadHash: row.payloadHash,
        payload: row.payload as ProjectSyncRuntimeLeasePayload,
        status: row.status as 'leased' | 'completed',
      }
    },

    async completeLease(input) {
      const leaseRef = db.collection('project_sync_runtime_jobs').doc(input.jobId)
      const now = input.now ?? new Date().toISOString()
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(leaseRef)
        const row = snapshot.data() ?? {}
        const binding = input.binding
        if (!snapshot.exists || row.deviceId !== input.identity.deviceId
          || !Number.isSafeInteger(row.credentialVersion)
          || input.identity.credentialVersion < Number(row.credentialVersion) || row.jobKind !== input.jobKind
          || row.payloadHash !== input.payloadHash || row.requestId !== binding.requestId
          || row.orgId !== binding.orgId || row.projectId !== binding.projectId
          || row.replicaId !== binding.replicaId || row.locationId !== binding.locationId
          || row.mappingId !== binding.mappingId || !row.payload || typeof row.payload !== 'object'
          || (row.payload as Row).kind !== row.jobKind
          || createHash('sha256').update(JSON.stringify(row.payload)).digest('hex') !== row.payloadHash) {
          throw new Error('project sync runtime lease completion mismatch')
        }
        if (row.status === 'completed') return
        if (row.status !== 'leased') throw new Error('project sync runtime lease is not active')
        transaction.set(leaseRef, {
          status: 'completed',
          completedAt: now,
          updatedAt: now,
          expiresAt: Timestamp.fromMillis(Date.parse(now) + PROJECT_SYNC_RUNTIME_JOB_RETENTION_MS),
        }, { merge: true })
      })
    },

    async releaseLease(input) {
      const leaseRef = db.collection('project_sync_runtime_jobs').doc(input.jobId)
      const now = input.now ?? new Date().toISOString()
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(leaseRef)
        const row = snapshot.data() ?? {}
        const binding = input.binding
        if (!snapshot.exists || row.status !== 'leased' || row.deviceId !== input.identity.deviceId
          || !Number.isSafeInteger(row.credentialVersion) || input.identity.credentialVersion < Number(row.credentialVersion)
          || row.jobKind !== input.jobKind || row.payloadHash !== input.payloadHash
          || row.requestId !== binding.requestId || row.orgId !== binding.orgId || row.projectId !== binding.projectId
          || row.replicaId !== binding.replicaId || row.locationId !== binding.locationId || row.mappingId !== binding.mappingId
          || !row.payload || typeof row.payload !== 'object' || (row.payload as Row).kind !== row.jobKind
          || createHash('sha256').update(JSON.stringify(row.payload)).digest('hex') !== row.payloadHash) {
          throw new Error('project sync runtime lease release mismatch')
        }
        transaction.set(leaseRef, {
          status: 'retryable',
          leaseExpiresAt: Timestamp.fromMillis(0),
          releasedAt: now,
          updatedAt: now,
          expiresAt: Timestamp.fromMillis(Date.parse(now) + PROJECT_SYNC_RUNTIME_JOB_RETENTION_MS),
        }, { merge: true })
      })
    },
  }
}
