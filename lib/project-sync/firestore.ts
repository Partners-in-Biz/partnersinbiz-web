import { createHash } from 'node:crypto'
import {
  projectSyncReplicaPatches,
  type ProjectSyncCoordinatorRepository,
  type ProjectSyncReplicaPatch,
} from './coordinator'
import type { ProjectSyncRequest } from './model'
import { PROJECT_LOCATION_REPLICAS_COLLECTION } from '@/lib/project-locations/store'

export const PROJECT_SYNC_REQUESTS_COLLECTION = 'project_sync_requests'
export const PROJECT_SYNC_HEADS_COLLECTION = 'project_sync_heads'
export const PROJECT_SYNC_EVENTS_COLLECTION = 'project_sync_events'

interface SyncDocumentReference { collectionName: string; id: string }
interface SyncDocumentSnapshot {
  id: string
  exists: boolean
  data(): Record<string, unknown> | undefined
}
interface SyncCollection { doc(id: string): SyncDocumentReference }
interface SyncTransaction {
  get(reference: SyncDocumentReference): Promise<SyncDocumentSnapshot>
  create(reference: SyncDocumentReference, data: Record<string, unknown>): void
  set(reference: SyncDocumentReference, data: Record<string, unknown>, options?: { merge: boolean }): void
}

export interface ProjectSyncFirestore {
  collection(name: string): SyncCollection
  runTransaction<T>(callback: (transaction: SyncTransaction) => Promise<T>): Promise<T>
}

export interface ProjectSyncFirestoreRepository extends ProjectSyncCoordinatorRepository {
  getLatest(orgId: string, projectId: string): Promise<ProjectSyncRequest | null>
}

function requestFrom(snapshot: SyncDocumentSnapshot): ProjectSyncRequest | null {
  return snapshot.exists ? snapshot.data() as unknown as ProjectSyncRequest : null
}

function terminal(status: string): boolean {
  return ['synced', 'failed', 'cancelled'].includes(status)
}

function canReattest(active: ProjectSyncRequest, candidate: ProjectSyncRequest): boolean {
  if (active.continuousExecutorVerified || !candidate.continuousExecutorVerified
    || !['waiting_for_locations', 'pending_inventory'].includes(active.status)
    || active.transfers.length > 0
    || active.replicaStates.some((replica) => replica.inventoryRevision !== null)
    || active.replicaStates.length !== candidate.replicaStates.length) return false
  return active.replicaStates.every((replica) => candidate.replicaStates.some((other) => (
    other.replicaId === replica.replicaId
      && other.locationId === replica.locationId
      && other.mappingId === replica.mappingId
      && other.orgId === replica.orgId
      && other.projectId === replica.projectId
  )))
}

export function projectSyncHeadId(orgId: string, projectId: string): string {
  return `head_${createHash('sha256').update(`${orgId}\0${projectId}`).digest('hex').slice(0, 40)}`
}

function assertReplicaBindings(
  request: ProjectSyncRequest,
  patches: ProjectSyncReplicaPatch[],
  snapshots: SyncDocumentSnapshot[],
): void {
  if (patches.length !== snapshots.length) throw new Error('project sync replica preflight is incomplete')
  for (let index = 0; index < patches.length; index += 1) {
    const patch = patches[index]
    const snapshot = snapshots[index]
    const row = snapshot.data() ?? {}
    const state = request.replicaStates.find((candidate) => candidate.replicaId === patch.replicaId)
    if (!snapshot.exists || snapshot.id !== patch.replicaId || row.active !== true || row.orgId !== request.orgId
      || row.projectId !== request.projectId || !state || state.replicaId !== patch.replicaId) {
      throw new Error('project sync replica tenant binding changed')
    }
  }
}

function headData(request: ProjectSyncRequest): Record<string, unknown> {
  return {
    orgId: request.orgId,
    projectId: request.projectId,
    requestId: request.requestId,
    status: request.status,
    stateVersion: request.stateVersion,
    updatedAt: request.updatedAt,
  }
}

function eventData(request: ProjectSyncRequest, type: 'request_created' | 'state_transition'): Record<string, unknown> {
  return {
    eventId: `${request.requestId}_${request.stateVersion}`,
    type,
    requestId: request.requestId,
    orgId: request.orgId,
    projectId: request.projectId,
    status: request.status,
    stateVersion: request.stateVersion,
    createdAt: request.updatedAt,
  }
}

export function createProjectSyncFirestoreRepository(db: ProjectSyncFirestore): ProjectSyncFirestoreRepository {
  const requestRef = (requestId: string) => db.collection(PROJECT_SYNC_REQUESTS_COLLECTION).doc(requestId)
  const headRef = (orgId: string, projectId: string) => db.collection(PROJECT_SYNC_HEADS_COLLECTION)
    .doc(projectSyncHeadId(orgId, projectId))
  const eventRef = (request: ProjectSyncRequest) => db.collection(PROJECT_SYNC_EVENTS_COLLECTION)
    .doc(`${request.requestId}_${request.stateVersion}`)
  const replicaRefs = (patches: ProjectSyncReplicaPatch[]) => patches
    .map((patch) => db.collection(PROJECT_LOCATION_REPLICAS_COLLECTION).doc(patch.replicaId))

  return {
    async getRequest(requestId): Promise<ProjectSyncRequest | null> {
      return db.runTransaction(async (transaction) => requestFrom(await transaction.get(requestRef(requestId))))
    },

    async getLatest(orgId, projectId): Promise<ProjectSyncRequest | null> {
      return db.runTransaction(async (transaction) => {
        const head = await transaction.get(headRef(orgId, projectId))
        const currentRequestId = typeof head.data()?.requestId === 'string' ? head.data()!.requestId as string : null
        return currentRequestId ? requestFrom(await transaction.get(requestRef(currentRequestId))) : null
      })
    },

    async createIfNoActive(request, patches) {
      return db.runTransaction(async (transaction) => {
        const requestedRef = requestRef(request.requestId)
        const currentHeadRef = headRef(request.orgId, request.projectId)
        const [requested, head] = await Promise.all([
          transaction.get(requestedRef),
          transaction.get(currentHeadRef),
        ])
        if (requested.exists) {
          const existing = requestFrom(requested)!
          if (existing.orgId !== request.orgId || existing.projectId !== request.projectId) {
            throw new Error('project sync idempotency identity collision')
          }
          return { created: false, request: existing }
        }
        const activeRequestId = typeof head.data()?.requestId === 'string' ? head.data()!.requestId as string : null
        if (activeRequestId) {
          const active = requestFrom(await transaction.get(requestRef(activeRequestId)))
          if (active && !terminal(active.status)) {
            if (!canReattest(active, request)) return { created: false, request: active }
            const reattested: ProjectSyncRequest = {
              ...active,
              stateVersion: active.stateVersion + 1,
              continuousExecutorVerified: true,
              updatedAt: request.updatedAt,
            }
            const reattestedPatches = projectSyncReplicaPatches(reattested)
            const refs = replicaRefs(reattestedPatches)
            const snapshots = await Promise.all(refs.map((reference) => transaction.get(reference)))
            assertReplicaBindings(reattested, reattestedPatches, snapshots)
            transaction.set(requestRef(active.requestId), reattested as unknown as Record<string, unknown>)
            transaction.set(currentHeadRef, headData(reattested))
            for (let index = 0; index < reattestedPatches.length; index += 1) {
              transaction.set(refs[index], reattestedPatches[index].patch, { merge: true })
            }
            transaction.create(eventRef(reattested), eventData(reattested, 'state_transition'))
            return { created: true, request: reattested }
          }
        }
        const snapshots = await Promise.all(replicaRefs(patches).map((reference) => transaction.get(reference)))
        assertReplicaBindings(request, patches, snapshots)
        transaction.create(requestedRef, request as unknown as Record<string, unknown>)
        transaction.set(currentHeadRef, headData(request))
        for (let index = 0; index < patches.length; index += 1) {
          transaction.set(replicaRefs(patches)[index], patches[index].patch, { merge: true })
        }
        transaction.create(eventRef(request), eventData(request, 'request_created'))
        return { created: true, request }
      })
    },

    async compareAndSet(requestId, expectedStateVersion, request, patches): Promise<boolean> {
      return db.runTransaction(async (transaction) => {
        const ref = requestRef(requestId)
        const current = requestFrom(await transaction.get(ref))
        if (!current || current.stateVersion !== expectedStateVersion) return false
        if (current.orgId !== request.orgId || current.projectId !== request.projectId
          || request.stateVersion !== expectedStateVersion + 1) {
          throw new Error('project sync state transition identity mismatch')
        }
        const refs = replicaRefs(patches)
        const snapshots = await Promise.all(refs.map((reference) => transaction.get(reference)))
        assertReplicaBindings(request, patches, snapshots)
        transaction.set(ref, request as unknown as Record<string, unknown>)
        transaction.set(headRef(request.orgId, request.projectId), headData(request))
        for (let index = 0; index < patches.length; index += 1) {
          transaction.set(refs[index], patches[index].patch, { merge: true })
        }
        transaction.create(eventRef(request), eventData(request, 'state_transition'))
        return true
      })
    },
  }
}
