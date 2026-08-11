/**
 * GET /api/v1/workspaces — list VPS-canonical PiB workspaces for the caller/org.
 *
 * Cost notes (2026-08-11):
 * - Projects are library-first: only user-library project docs are loaded.
 *   The previous 11-field projects fan-out scanned org-wide project indexes on
 *   every catalogue hit even though non-library projects were discarded.
 * - Runtime discovery is request-memoized so multi-workspace orgs do not
 *   re-scan linked_devices / grants / mappings / credentials per workspace.
 * - A 20s process-local response cache collapses multi-tab bursts.
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { ORG_WORKSPACES_COLLECTION, type OrgWorkspaceRecord } from '@/lib/client-provisioning/workspace-context'
import {
  normalizeRuntimeTargets,
  publicRuntimeTargetPresence,
  runtimeTargetPhysicalTransportIdentity,
} from '@/lib/agents/runtime-targets'
import { discoverAuthorizedRuntimeTargets, type PublicAuthorizedRuntimeTarget } from '@/lib/linked-computers/runtime-targets'
import { discoverAuthorizedExecutionLocationTargets } from '@/lib/project-locations/discovery'
import type { PublicExecutionLocationPresence } from '@/lib/project-locations/access'
import {
  PROJECT_LOCATION_REPLICAS_COLLECTION,
} from '@/lib/project-locations/store'
import {
  projectReplicaRuntimeUnavailableReason,
  type ProjectLocationReplica,
  type ProjectReplicaRuntimeUnavailableReason,
} from '@/lib/project-locations/model'
import { legacyProjectAccessForUser, projectOrganizationDocId } from '@/lib/projects/collaboration'
import { listUserLibraryProjectIds } from '@/lib/projects/user-library'
import { AGENT_IDS, type AgentId } from '@/lib/agents/types'
import {
  readWorkspaceCatalogueCache,
  workspaceCatalogueCacheKey,
  writeWorkspaceCatalogueCache,
} from '@/lib/workspaces/catalogue-response-cache'
import { createRequestScopedDb } from '@/lib/workspaces/request-scoped-db'

export const dynamic = 'force-dynamic'

export interface PublicWorkspaceSummary {
  id: string
  workspaceId: string
  orgId: string
  orgSlug: string
  orgName: string
  agentDomain: string
  sourceOfTruth: OrgWorkspaceRecord['sourceOfTruth']
  syncMode: OrgWorkspaceRecord['syncMode']
  defaultRuntimeTarget: OrgWorkspaceRecord['defaultRuntimeTarget']
  folderVersion: number
  companyId: string | null
  contactIds: string[]
}

export interface PublicWorkspaceProjectLocation {
  replicaId: string
  locationId: string
  label: string
  kind: ProjectLocationReplica['locationKind']
  platform: ProjectLocationReplica['locationPlatform']
  workspaceId: string
  runtimeTargetId?: string
  availability: ProjectLocationReplica['availability']
  syncStatus: ProjectLocationReplica['syncStatus']
  canonical: boolean
  selectable: boolean
  authenticatedRuntime: boolean
  unavailableReason?: ProjectReplicaRuntimeUnavailableReason | string
}

export interface PublicWorkspaceProjectSummary {
  id: string
  name: string
  locations: PublicWorkspaceProjectLocation[]
}

type WorkspaceCataloguePayload = {
  workspaces: PublicWorkspaceSummary[]
  runtimeTargets: WorkspaceRuntimeTarget[]
  runtimeTargetsByWorkspace: Record<string, WorkspaceRuntimeTarget[]>
  projects: PublicWorkspaceProjectSummary[]
}

type WorkspaceRuntimeTarget = PublicExecutionLocationPresence | PublicAuthorizedRuntimeTarget

function toPublicWorkspaceSummary(workspace: OrgWorkspaceRecord): PublicWorkspaceSummary {
  return {
    id: workspace.id,
    workspaceId: workspace.workspaceId,
    orgId: workspace.orgId,
    orgSlug: workspace.orgSlug,
    orgName: workspace.orgName,
    agentDomain: workspace.agentDomain,
    sourceOfTruth: workspace.sourceOfTruth,
    syncMode: workspace.syncMode,
    defaultRuntimeTarget: workspace.defaultRuntimeTarget,
    folderVersion: workspace.folderVersion,
    companyId: workspace.companyId ?? null,
    contactIds: workspace.contactIds ?? [],
  }
}

async function loadLibraryProjectDocs(projectIds: string[]) {
  if (projectIds.length === 0) return [] as Array<{ id: string; exists: boolean; data: () => Record<string, unknown> }>
  // Chunk getAll to stay under Firestore's practical batch limits.
  const chunkSize = 100
  const docs: Array<{ id: string; exists: boolean; data: () => Record<string, unknown> }> = []
  for (let offset = 0; offset < projectIds.length; offset += chunkSize) {
    const chunk = projectIds.slice(offset, offset + chunkSize)
    const refs = chunk.map((projectId) => adminDb.collection('projects').doc(projectId))
    const snapshots = typeof (adminDb as { getAll?: (...args: unknown[]) => Promise<FirebaseFirestore.DocumentSnapshot[]> }).getAll === 'function'
      ? await (adminDb as unknown as { getAll: (...args: FirebaseFirestore.DocumentReference[]) => Promise<FirebaseFirestore.DocumentSnapshot[]> }).getAll(...refs)
      : await Promise.all(refs.map((ref) => ref.get()))
    for (const snapshot of snapshots) {
      docs.push({
        id: snapshot.id,
        exists: snapshot.exists,
        data: () => (snapshot.data() ?? {}) as Record<string, unknown>,
      })
    }
  }
  return docs.filter((doc) => doc.exists)
}

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const { searchParams } = new URL(req.url)
  const orgScope = resolveOrgScope(user, searchParams.get('orgId'))
  if (!orgScope.ok) return apiError(orgScope.error, orgScope.status)
  const requestedRuntimeAgentId = searchParams.get('agentId')?.trim()
  const runtimeAgentId: AgentId = requestedRuntimeAgentId
    && AGENT_IDS.includes(requestedRuntimeAgentId as AgentId)
    ? requestedRuntimeAgentId as AgentId
    : 'pip'

  const cacheKey = workspaceCatalogueCacheKey({
    orgId: orgScope.orgId,
    userId: user.uid,
    agentId: runtimeAgentId,
  })
  // Keep unit tests deterministic: catalogue mocks mutate between calls in one case.
  const catalogueCacheEnabled = process.env.NODE_ENV !== 'test'
  const cached = catalogueCacheEnabled
    ? readWorkspaceCatalogueCache<WorkspaceCataloguePayload>(cacheKey)
    : null
  if (cached) {
    const hit = apiSuccess(cached)
    hit.headers.set('Cache-Control', 'private, max-age=15')
    hit.headers.set('X-PiB-Catalogue-Cache', 'hit')
    return hit
  }

  const [snap, runtimeDoc, projectOrganizationAccess, projectMemberAccess, projectReplicas, libraryProjectIds] = await Promise.all([
    adminDb.collection(ORG_WORKSPACES_COLLECTION)
      .where('orgId', '==', orgScope.orgId)
      .where('status', '==', 'active')
      .get(),
    // Compatibility transports are agent-profile specific. The selected
    // session agent must drive this catalogue or the browser can show Pip's
    // Mac as online immediately before conversation creation authorizes the
    // same target against another agent and rejects it as unavailable.
    adminDb.collection('agent_dispatch_configs').doc(runtimeAgentId).get(),
    adminDb.collection('projectOrganizations').where('orgId', '==', orgScope.orgId).get(),
    adminDb.collection('projectMembers').where('uid', '==', user.uid).get(),
    adminDb.collection(PROJECT_LOCATION_REPLICAS_COLLECTION).where('orgId', '==', orgScope.orgId).get(),
    listUserLibraryProjectIds(orgScope.orgId, user.uid),
  ])
  const libraryProjectIdSet = new Set(libraryProjectIds)
  const libraryProjectDocs = await loadLibraryProjectDocs(libraryProjectIds)

  // Explicit project-organisation grants are first-class access records and
  // may exist without legacy link fields on the project document.
  const canonicalProjectAccess = new Map<string, Record<string, unknown>>()
  for (const doc of projectOrganizationAccess.docs) {
    const row = doc.data() as Record<string, unknown>
    const projectId = typeof row.projectId === 'string' ? row.projectId.trim() : ''
    if (!projectId) continue
    const isCanonicalDocument = doc.id === projectOrganizationDocId(projectId, orgScope.orgId)
    if (!canonicalProjectAccess.has(projectId) || isCanonicalDocument) {
      canonicalProjectAccess.set(projectId, row)
    }
  }
  const explicitlySharedProjectIds = new Set(Array.from(canonicalProjectAccess.entries())
    .filter(([, row]) => row.status === 'active')
    .map(([projectId]) => projectId))
  const memberProjectIds = new Set(projectMemberAccess.docs
    .filter((doc) => {
      const row = doc.data()
      return row.orgId === orgScope.orgId && row.status === 'active'
    })
    .map((doc) => doc.data().projectId)
    .filter((projectId): projectId is string => typeof projectId === 'string' && projectId.length > 0))

  const workspaces = snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as OrgWorkspaceRecord)
    .sort((a, b) => a.orgName.localeCompare(b.orgName))
    .map(toPublicWorkspaceSummary)

  const rawCompatibilityRuntimeTargets = runtimeDoc.data()?.runtimeTargets
  const normalizedCompatibilityTargets = new Map(
    normalizeRuntimeTargets(rawCompatibilityRuntimeTargets).map((target) => [target.id, target]),
  )
  const compatibilityRuntimeTargets = publicRuntimeTargetPresence(rawCompatibilityRuntimeTargets).map((target) => {
    const normalized = normalizedCompatibilityTargets.get(target.id)
    return normalized
      ? { ...target, transportIdentity: runtimeTargetPhysicalTransportIdentity(normalized) }
      : target
  })

  // One request-scoped memo so every workspace reuses the same linked-device
  // collection scans and execution-location query instead of N full fan-outs.
  const requestDb = createRequestScopedDb(adminDb as unknown as Parameters<typeof createRequestScopedDb>[0])
  const runtimeTargetsByWorkspace: Record<string, WorkspaceRuntimeTarget[]> = Object.fromEntries(await Promise.all(workspaces.map(async (workspace) => {
    const [scopedCompatibility, linked] = await Promise.all([
      discoverAuthorizedExecutionLocationTargets({
        userId: user.uid,
        orgId: orgScope.orgId,
        workspaceId: workspace.workspaceId,
        compatibilityTargets: compatibilityRuntimeTargets,
      }, { db: requestDb }).catch(() => []),
      discoverAuthorizedRuntimeTargets({
        userId: user.uid,
        orgId: orgScope.orgId,
        workspaceId: workspace.workspaceId,
        agentId: runtimeAgentId,
      }, { db: requestDb }).catch(() => []),
    ])
    const deduped = new Map<string, WorkspaceRuntimeTarget>()
    for (const target of [...scopedCompatibility, ...linked]) {
      const dedupeKey = 'mappingId' in target && typeof target.mappingId === 'string' && target.mappingId
        ? `${target.id}::${target.mappingId}`
        : target.id
      const existing = deduped.get(dedupeKey)
      // One physical machine may have both a first-class project location and
      // a native linked-runtime row. Merge the transport details into the
      // location row so the browser retains the server-authorized locationId.
      // Multiple Workspace mappings on the same machine stay as separate rows.
      if (!existing) {
        deduped.set(dedupeKey, target)
        continue
      }
      const merged = { ...existing, ...target } as WorkspaceRuntimeTarget
      // Public linked runtimes also have their own dynamic location ID. When
      // a migrated first-class location uses the same transport, retain the
      // canonical persisted location ID (for example partners-vps).
      if ('locationId' in existing) merged.locationId = existing.locationId
      deduped.set(dedupeKey, merged)
    }
    return [workspace.workspaceId, Array.from(deduped.values())]
  })))
  // Compatibility field for older clients, now derived from the same scoped
  // per-Workspace authorization results instead of the global runtime config.
  const runtimeTargets = Array.from(new Map(
    Object.values(runtimeTargetsByWorkspace).flat().map((target) => [
      'mappingId' in target && typeof target.mappingId === 'string' && target.mappingId
        ? `${target.id}::${target.mappingId}`
        : target.id,
      target,
    ]),
  ).values())
  const projectsById = new Map<string, PublicWorkspaceProjectSummary>()
  for (const projectDoc of libraryProjectDocs) {
    if (!libraryProjectIdSet.has(projectDoc.id)) continue
    const data = projectDoc.data() ?? {}
    if (data.deleted === true || data.archived === true) continue
    const hasCanonicalAccess = canonicalProjectAccess.has(projectDoc.id)
    const explicitlyShared = explicitlySharedProjectIds.has(projectDoc.id)
    // A canonical project-organisation row is authoritative, including an
    // inactive tombstone. Neither a legacy org field nor a project-member
    // row may resurrect the project inside this organisation's Workspace.
    if (hasCanonicalAccess && !explicitlyShared) continue
    if (!explicitlyShared
      && !memberProjectIds.has(projectDoc.id)
      && !legacyProjectAccessForUser(user, data, orgScope.orgId)) continue
    const name = typeof data.name === 'string' ? data.name.trim() : ''
    if (name) projectsById.set(projectDoc.id, { id: projectDoc.id, name, locations: [] })
  }

  const locationMapsByProject = new Map<string, Map<string, PublicWorkspaceProjectLocation>>()
  for (const replicaDoc of projectReplicas.docs) {
    const replica = replicaDoc.data() as ProjectLocationReplica
    const project = projectsById.get(replica.projectId)
    if (!project || replica.orgId !== orgScope.orgId || replica.active !== true) continue
    const runtime = (runtimeTargetsByWorkspace[replica.workspaceId] ?? []).find((target) => (
      'locationId' in target && target.locationId === replica.locationId
      && (!('mappingId' in target) || !replica.mappingId || target.mappingId === replica.mappingId)
    ))
    const nativeLocation = replica.locationId.startsWith('linked-device:')
    // Native replica access is always reconciled against the current device
    // grant/mapping. Snapshot visibility must not outlive a revoked grant.
    if (nativeLocation && !runtime) continue
    if (!nativeLocation && replica.locationVisibility === 'private'
      && (replica.locationOwner.type !== 'user' || replica.locationOwner.userId !== user.uid)) continue
    const replicaUnavailableReason = projectReplicaRuntimeUnavailableReason(replica)
    const runtimeUnavailableReason = runtime?.selectable === true
      ? undefined
      : typeof runtime?.unavailableReason === 'string' ? runtime.unavailableReason : 'computer_offline'
    // Native linked-device replicas: live device heartbeat is authoritative for chat
    // readiness. Stale replica.availability/syncStatus must not hide a healthy Mac/VPS.
    // Legacy locations still use stored replica readiness (and require adoption).
    const unavailableReason = nativeLocation
      ? (runtime?.selectable === true ? undefined : (runtimeUnavailableReason ?? 'computer_offline'))
      : (runtimeUnavailableReason ?? replicaUnavailableReason)
    const availability = nativeLocation
      ? (runtime?.selectable === true ? 'online' : 'offline')
      : replica.availability
    const publicLocation: PublicWorkspaceProjectLocation = {
      replicaId: replica.replicaId,
      locationId: replica.locationId,
      label: replica.locationLabel,
      kind: replica.locationKind,
      platform: replica.locationPlatform,
      workspaceId: replica.workspaceId,
      ...(runtime ? { runtimeTargetId: runtime.id } : {}),
      availability,
      syncStatus: replica.syncStatus,
      canonical: replica.isCanonical === true,
      selectable: !unavailableReason,
      authenticatedRuntime: nativeLocation,
      ...(unavailableReason ? { unavailableReason } : {}),
    }
    const locations = locationMapsByProject.get(replica.projectId) ?? new Map<string, PublicWorkspaceProjectLocation>()
    locations.set(replica.locationId, publicLocation)
    locationMapsByProject.set(replica.projectId, locations)
  }
  for (const [projectId, locationMap] of locationMapsByProject) {
    const project = projectsById.get(projectId)
    if (!project) continue
    project.locations = Array.from(locationMap.values()).sort((left, right) => {
      if (left.kind === 'vps' && right.kind !== 'vps') return -1
      if (right.kind === 'vps' && left.kind !== 'vps') return 1
      return left.label.localeCompare(right.label)
    })
  }
  const projects = Array.from(projectsById.values()).sort((a, b) => a.name.localeCompare(b.name))

  const payload: WorkspaceCataloguePayload = {
    workspaces,
    runtimeTargets,
    runtimeTargetsByWorkspace,
    projects,
  }
  if (catalogueCacheEnabled) writeWorkspaceCatalogueCache(cacheKey, payload)

  const miss = apiSuccess(payload)
  miss.headers.set('Cache-Control', 'private, max-age=15')
  miss.headers.set('X-PiB-Catalogue-Cache', 'miss')
  return miss
})
