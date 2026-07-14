import { adminDb } from '@/lib/firebase/admin'
import { isActiveOrgMembershipRow } from '@/lib/linked-computers/policy'
import {
  canAccessExecutionLocation,
  executionLocationPresence,
  type BoundRuntimeTargetPresence,
  type PublicExecutionLocationPresence,
} from './access'
import type { ProjectExecutionLocation } from './model'
import { PROJECT_EXECUTION_LOCATIONS_COLLECTION } from './store'

interface SnapshotLike {
  exists?: boolean
  data(): Record<string, unknown> | undefined
}

interface QuerySnapshotLike { docs: Array<{ data(): Record<string, unknown> }> }
interface DbLike {
  collection(name: string): {
    doc?(id: string): { get(): Promise<SnapshotLike> }
    where?(field: string, op: string, value: unknown): { get(): Promise<QuerySnapshotLike> }
  }
}

export interface ExecutionLocationDiscoveryInput {
  userId: string
  orgId: string
  workspaceId: string
  compatibilityTargets: BoundRuntimeTargetPresence[]
}

interface DiscoveryOptions { db?: DbLike }

function membershipActive(row: Record<string, unknown> | undefined, orgId: string, userId: string): boolean {
  if (!row || row.orgId !== orgId || (row.uid !== userId && row.userId !== userId)) return false
  return isActiveOrgMembershipRow(row)
}

async function membership(db: DbLike, orgId: string, userId: string) {
  const memberRef = db.collection('orgMembers').doc?.(`${orgId}_${userId}`)
  if (!memberRef) return { active: false }
  const snapshot = await memberRef.get()
  const row = snapshot.data()
  return {
    active: snapshot.exists !== false && membershipActive(row, orgId, userId),
    role: typeof row?.role === 'string' ? row.role : undefined,
  }
}

export async function discoverAuthorizedExecutionLocationTargets(
  input: ExecutionLocationDiscoveryInput,
  options: DiscoveryOptions = {},
): Promise<PublicExecutionLocationPresence[]> {
  const db = options.db ?? adminDb as unknown as DbLike
  const locationsQuery = db.collection(PROJECT_EXECUTION_LOCATIONS_COLLECTION).where?.('allowedOrgIds', 'array-contains', input.orgId)
  if (!locationsQuery) return []
  const [locationsSnapshot, activeMembership] = await Promise.all([
    locationsQuery.get(),
    membership(db, input.orgId, input.userId),
  ])
  const transports = new Map(input.compatibilityTargets.map((target) => [target.id, target]))
  return locationsSnapshot.docs
    .map((doc) => doc.data() as unknown as ProjectExecutionLocation)
    .filter((location) => canAccessExecutionLocation({
      location,
      userId: input.userId,
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      membership: activeMembership,
    }))
    .map((location) => executionLocationPresence(
      location,
      transports.get(location.legacyCompatibilityTargetId ?? location.runtimeTargetId),
    ))
    .sort((left, right) => {
      if (left.kind === 'vps' && right.kind !== 'vps') return -1
      if (right.kind === 'vps' && left.kind !== 'vps') return 1
      return left.label.localeCompare(right.label)
    })
}

export async function authorizeExecutionLocationDispatch(
  input: ExecutionLocationDiscoveryInput & { runtimeTargetId: string },
  options: DiscoveryOptions = {},
): Promise<{
  locationId: string
  runtimeTargetId: string
  machineLabel: string
  kind: PublicExecutionLocationPresence['kind']
  organizationAccessible: boolean
}> {
  const targets = await discoverAuthorizedExecutionLocationTargets(input, options)
  const target = targets.find((candidate) => candidate.id === input.runtimeTargetId)
  if (!target) throw new Error('Execution location not authorized')
  if (!target.selectable) throw new Error('Computer unavailable')
  return {
    locationId: target.locationId,
    runtimeTargetId: target.id,
    machineLabel: target.label,
    kind: target.kind,
    organizationAccessible: target.visibility === 'organization',
  }
}
