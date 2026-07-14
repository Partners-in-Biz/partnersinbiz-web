import type { ProjectExecutionLocation, ProjectLocationReplica } from './model'
import {
  PROJECT_EXECUTION_LOCATIONS_COLLECTION,
  PROJECT_LOCATION_REPLICAS_COLLECTION,
} from './store'
import {
  PARTNERS_LOCATION_VERIFICATION_RUNS_COLLECTION,
  type ProjectLocationVerificationRepository,
} from './verification'

interface VerificationDocumentSnapshot {
  id: string
  exists: boolean
  data(): Record<string, unknown> | undefined
}

interface VerificationQuerySnapshot { docs: VerificationDocumentSnapshot[] }

interface VerificationDocumentReference {
  id: string
  collectionName: string
  get(): Promise<VerificationDocumentSnapshot>
  set(data: Record<string, unknown>, options?: { merge: boolean }): Promise<unknown>
}

interface VerificationWriteBatch {
  set(
    reference: VerificationDocumentReference,
    data: Record<string, unknown>,
    options?: { merge: boolean },
  ): VerificationWriteBatch
  commit(): Promise<unknown>
}

interface VerificationQuery { get(): Promise<VerificationQuerySnapshot> }

interface VerificationCollection {
  doc(id: string): VerificationDocumentReference
  where(field: string, operation: '==', value: unknown): VerificationQuery
}

export interface ProjectLocationVerificationFirestore {
  collection(name: string): VerificationCollection
  batch(): VerificationWriteBatch
}

function dataOf(snapshot: VerificationDocumentSnapshot): Record<string, unknown> {
  return snapshot.data() ?? {}
}

export function createProjectLocationVerificationFirestoreRepository(
  db: ProjectLocationVerificationFirestore,
): ProjectLocationVerificationRepository {
  return {
    async getLocation(locationId): Promise<ProjectExecutionLocation | null> {
      const doc = await db.collection(PROJECT_EXECUTION_LOCATIONS_COLLECTION).doc(locationId).get()
      return doc.exists ? dataOf(doc) as unknown as ProjectExecutionLocation : null
    },
    async listActiveReplicas(locationId): Promise<ProjectLocationReplica[]> {
      const snapshot = await db.collection(PROJECT_LOCATION_REPLICAS_COLLECTION)
        .where('locationId', '==', locationId).get()
      return snapshot.docs.map((doc) => dataOf(doc) as unknown as ProjectLocationReplica)
        .filter((replica) => replica.active === true)
        .sort((left, right) => left.replicaId.localeCompare(right.replicaId))
    },
    async commitVerification(commit): Promise<void> {
      const runId = typeof commit.completedAudit.runId === 'string' ? commit.completedAudit.runId : ''
      if (!/^[a-f0-9]{64}$/.test(runId)) throw new Error('verification commit requires its immutable run id')
      const batch = db.batch()
      for (const update of commit.updates) {
        batch.set(
          db.collection(PROJECT_EXECUTION_LOCATIONS_COLLECTION).doc(update.locationId),
          update.locationPatch,
          { merge: true },
        )
        for (const replica of update.replicas) {
          batch.set(
            db.collection(PROJECT_LOCATION_REPLICAS_COLLECTION).doc(replica.replicaId),
            replica.patch,
            { merge: true },
          )
        }
      }
      batch.set(
        db.collection(PARTNERS_LOCATION_VERIFICATION_RUNS_COLLECTION).doc(runId),
        commit.completedAudit,
        { merge: true },
      )
      await batch.commit()
    },
    async writeAudit(runId, audit): Promise<void> {
      await db.collection(PARTNERS_LOCATION_VERIFICATION_RUNS_COLLECTION).doc(runId).set(audit, { merge: true })
    },
  }
}
