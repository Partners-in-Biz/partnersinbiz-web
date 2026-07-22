import {
  PARTNERS_PROJECT_LOCATION_ORG_ID,
  PARTNERS_PROJECT_LOCATION_WORKSPACE_ID,
  type PartnersProjectLocationMigrationDependencies,
  type PartnersProjectLocationMigrationPreflight,
} from './migration'
import type { ProjectExecutionLocation, ProjectLocationReplica } from './model'
import {
  PROJECT_EXECUTION_LOCATIONS_COLLECTION,
  PROJECT_LOCATION_REPLICAS_COLLECTION,
} from './store'
import { normalizeRuntimeTargets, runtimeTargetPhysicalTransportIdentity } from '@/lib/agents/runtime-targets'

export const PROJECT_LOCATION_MIGRATION_RUNS_COLLECTION = 'project_location_migration_runs'

interface MigrationDocumentSnapshot {
  id: string
  exists: boolean
  data(): Record<string, unknown> | undefined
}

interface MigrationQuerySnapshot { docs: MigrationDocumentSnapshot[] }

interface MigrationDocumentReference {
  get(): Promise<MigrationDocumentSnapshot>
  create(data: Record<string, unknown>): Promise<unknown>
  set(data: Record<string, unknown>, options?: { merge: boolean }): Promise<unknown>
}

interface MigrationQuery { get(): Promise<MigrationQuerySnapshot> }

interface MigrationCollection {
  doc(id: string): MigrationDocumentReference
  get(): Promise<MigrationQuerySnapshot>
  where(field: string, operation: '==' | 'array-contains', value: unknown): MigrationQuery
}

export interface ProjectLocationMigrationFirestore {
  collection(name: string): MigrationCollection
}

const PROJECT_ORG_SCALAR_FIELDS = [
  'orgId', 'sourceOrgId', 'ownerOrgId', 'issuerOrgId', 'clientId', 'clientOrgId', 'recipientOrgId', 'targetOrgId',
] as const
const PROJECT_ORG_ARRAY_FIELDS = [
  'sourceOrgIds', 'ownerOrgIds', 'issuerOrgIds', 'clientOrgIds', 'recipientOrgIds', 'targetOrgIds', 'linkedOrgIds',
] as const

function dataOf(snapshot: MigrationDocumentSnapshot): Record<string, unknown> {
  return snapshot.data() ?? {}
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

async function loadPreflight(
  db: ProjectLocationMigrationFirestore,
  peetUserId: string,
): Promise<PartnersProjectLocationMigrationPreflight> {
  const orgId = PARTNERS_PROJECT_LOCATION_ORG_ID
  const workspaceId = PARTNERS_PROJECT_LOCATION_WORKSPACE_ID
  const projectQueries = [
    ...PROJECT_ORG_SCALAR_FIELDS.map((field) => db.collection('projects').where(field, '==', orgId).get()),
    ...PROJECT_ORG_ARRAY_FIELDS.map((field) => db.collection('projects').where(field, 'array-contains', orgId).get()),
  ]
  const [organizationDoc, workspaceDoc, userDoc, membershipDoc, dispatchSnapshot, ...projectSnapshots] = await Promise.all([
    db.collection('organizations').doc(orgId).get(),
    db.collection('org_workspaces').doc(workspaceId).get(),
    db.collection('users').doc(peetUserId).get(),
    db.collection('orgMembers').doc(`${orgId}_${peetUserId}`).get(),
    db.collection('agent_dispatch_configs').get(),
    ...projectQueries,
  ])
  const organization = dataOf(organizationDoc)
  const workspace = dataOf(workspaceDoc)
  const user = dataOf(userDoc)
  const membership = dataOf(membershipDoc)
  const legacyRuntimeTargetIds = new Set<string>()
  const legacyRuntimeTargetIdentities: Record<string, string> = {}
  for (const dispatchDoc of dispatchSnapshot.docs) {
    const targets = dataOf(dispatchDoc).runtimeTargets
    if (!targets || typeof targets !== 'object' || Array.isArray(targets)) continue
    for (const [targetKey, targetValue] of Object.entries(targets as Record<string, unknown>)) {
      if (targetKey.trim()) legacyRuntimeTargetIds.add(targetKey.trim())
      if (targetValue && typeof targetValue === 'object' && !Array.isArray(targetValue)) {
        const id = optionalString((targetValue as Record<string, unknown>).id)
        if (id) legacyRuntimeTargetIds.add(id)
      }
    }
    if (dispatchDoc.id === 'pip') {
      for (const target of normalizeRuntimeTargets(targets)) {
        legacyRuntimeTargetIdentities[target.id] = runtimeTargetPhysicalTransportIdentity(target)
      }
    }
  }
  const projects = new Map<string, { id: string; data: Record<string, unknown> }>()
  for (const snapshot of projectSnapshots) {
    for (const doc of snapshot.docs) projects.set(doc.id, { id: doc.id, data: dataOf(doc) })
  }

  return {
    organization: {
      id: organizationDoc.id,
      exists: organizationDoc.exists,
      ...(typeof organization.active === 'boolean' ? { active: organization.active } : {}),
      ...(typeof organization.deleted === 'boolean' ? { deleted: organization.deleted } : {}),
    },
    workspace: {
      id: workspaceDoc.id,
      exists: workspaceDoc.exists,
      ...(optionalString(workspace.orgId) ? { orgId: optionalString(workspace.orgId) } : {}),
      ...(optionalString(workspace.status) ? { status: optionalString(workspace.status) } : {}),
    },
    humanOwner: {
      uid: peetUserId,
      exists: userDoc.exists,
      ...(optionalString(user.role) ? { role: optionalString(user.role) } : {}),
      ...(optionalString(user.displayName) ? { displayName: optionalString(user.displayName) } : {}),
    },
    membership: {
      exists: membershipDoc.exists,
      ...(membershipDoc.exists ? { orgId, userId: peetUserId } : {}),
      ...(optionalString(membership.role) ? { role: optionalString(membership.role) } : {}),
      ...(optionalString(membership.status) ? { status: optionalString(membership.status) } : {}),
    },
    legacyRuntimeTargetIds: Array.from(legacyRuntimeTargetIds).sort(),
    legacyRuntimeTargetIdentities,
    projects: Array.from(projects.values()).sort((left, right) => left.id.localeCompare(right.id)),
  }
}

export function createPartnersProjectLocationFirestoreDependencies(
  db: ProjectLocationMigrationFirestore,
  peetUserId: string,
  now: () => unknown,
): PartnersProjectLocationMigrationDependencies {
  return {
    loadPreflight: () => loadPreflight(db, peetUserId),
    now,
    repository: {
      async getLocation(locationId: string): Promise<ProjectExecutionLocation | null> {
        const doc = await db.collection(PROJECT_EXECUTION_LOCATIONS_COLLECTION).doc(locationId).get()
        return doc.exists ? dataOf(doc) as unknown as ProjectExecutionLocation : null
      },
      async getReplica(replicaId: string): Promise<ProjectLocationReplica | null> {
        const doc = await db.collection(PROJECT_LOCATION_REPLICAS_COLLECTION).doc(replicaId).get()
        return doc.exists ? dataOf(doc) as unknown as ProjectLocationReplica : null
      },
      async createLocation(location: ProjectExecutionLocation): Promise<void> {
        await db.collection(PROJECT_EXECUTION_LOCATIONS_COLLECTION).doc(location.locationId)
          .create(location as unknown as Record<string, unknown>)
      },
      async patchLocationTransportIdentity(locationId: string, transportIdentity: string): Promise<void> {
        await db.collection(PROJECT_EXECUTION_LOCATIONS_COLLECTION).doc(locationId).set({
          transportIdentity,
          updatedAt: now(),
        }, { merge: true })
      },
      async createReplica(replica: ProjectLocationReplica): Promise<void> {
        await db.collection(PROJECT_LOCATION_REPLICAS_COLLECTION).doc(replica.replicaId)
          .create(replica as unknown as Record<string, unknown>)
      },
      async writeAudit(runId: string, audit: Record<string, unknown>): Promise<void> {
        await db.collection(PROJECT_LOCATION_MIGRATION_RUNS_COLLECTION).doc(runId).set(audit, { merge: true })
      },
    },
  }
}
