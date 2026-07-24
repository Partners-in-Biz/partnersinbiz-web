/**
 * Server-only helpers that find the best available project-sync manifest for
 * a conversation's bound workspace, so the Agent Workbench Files tab can
 * render a real (synced) tree instead of only the Phase 1 event-derived
 * heuristic in `from-events.ts`.
 *
 * How this fits together (see `lib/project-sync/*`):
 * - `ProjectSyncFirestoreRepository.getLatest(orgId, projectId)` resolves the
 *   most recent `ProjectSyncRequest` for a project via the
 *   `project_sync_heads/{orgId}_{projectId}` pointer doc.
 * - Each request tracks one `ProjectSyncReplicaState` per linked-computer /
 *   VPS replica, each optionally carrying an `inventoryRevision`.
 * - `ProjectSyncRuntimeRepository.getManifest(requestId, replicaId)` reads
 *   the actual `ProjectContentManifest` (entries) for one replica's reported
 *   revision from `project_sync_manifest_heads` / `_chunks`.
 *
 * Known limitations (documented rather than solved for Phase 2a):
 * - Only the single most recent sync request for the project is considered.
 *   If a project has multiple historical requests and the head pointer is
 *   stale, older requests are not searched — this mirrors what
 *   `GET /api/v1/projects/[projectId]/sync` already does for the sync status
 *   UI, so it is a pre-existing constraint, not a new one.
 * - There is no reverse index from `projectId` straight to a manifest, so a
 *   request lookup is always required first.
 * - When a request has multiple replicas with divergent revisions (mid-sync
 *   or conflicted), we pick one heuristically: prefer the replica matching
 *   the conversation's bound folder mapping (`workspaceContext.mappingId`),
 *   then the request's canonical location, then any replica with an
 *   inventory. This is "best effort", not authoritative for a specific
 *   runtime target.
 */
import { adminDb } from '@/lib/firebase/admin'
import { createProjectSyncFirestoreRepository, type ProjectSyncFirestore } from '@/lib/project-sync/firestore'
import { createProjectSyncRuntimeRepository } from '@/lib/project-sync/runtime-store'
import type { ProjectContentManifest, ProjectSyncReplicaState, ProjectSyncRequest } from '@/lib/project-sync/model'
import { manifestToWorkbenchFileTree } from './manifest-tree'
import type { WorkbenchFileNode } from './types'

export interface ResolveWorkbenchSyncInput {
  orgId: string
  projectId: string | null
  mappingId?: string | null
}

export interface WorkbenchSyncManifestResolution {
  source: 'sync' | 'none'
  manifest: ProjectContentManifest | null
  requestId?: string
  replicaId?: string
}

export interface WorkbenchSyncTreeResolution {
  source: 'sync' | 'none'
  tree: WorkbenchFileNode[]
  revision?: string
  requestId?: string
  replicaId?: string
  entryCount?: number
}

function pickReplica(request: ProjectSyncRequest, mappingId: string | null): ProjectSyncReplicaState | null {
  const withInventory = request.replicaStates.filter((replica) => replica.inventoryRevision !== null)
  if (withInventory.length === 0) return null
  if (mappingId) {
    const mapped = withInventory.find((replica) => replica.mappingId === mappingId)
    if (mapped) return mapped
  }
  const canonical = withInventory.find((replica) => replica.locationId === request.canonicalLocationId)
  if (canonical) return canonical
  return withInventory[0]
}

/**
 * Resolves the raw manifest (entries + revision) for a conversation's bound
 * project, if a synced replica is available. Returns `{ source: 'none' }`
 * whenever there is no project binding, no sync request, or no replica has
 * reported an inventory yet — callers should fall back to the event-derived
 * Phase 1 tree in that case.
 */
export async function resolveWorkbenchSyncManifest(
  input: ResolveWorkbenchSyncInput,
): Promise<WorkbenchSyncManifestResolution> {
  const orgId = input.orgId?.trim()
  const projectId = input.projectId?.trim()
  const empty: WorkbenchSyncManifestResolution = { source: 'none', manifest: null }
  if (!orgId || !projectId) return empty

  try {
    const syncRepo = createProjectSyncFirestoreRepository(adminDb as unknown as ProjectSyncFirestore)
    const request = await syncRepo.getLatest(orgId, projectId)
    if (!request) return empty

    const replica = pickReplica(request, input.mappingId?.trim() || null)
    if (!replica) return empty

    const runtimeRepo = createProjectSyncRuntimeRepository()
    const manifest = await runtimeRepo.getManifest(request.requestId, replica.replicaId)
    if (!manifest) return { source: 'none', manifest: null, requestId: request.requestId, replicaId: replica.replicaId }

    return { source: 'sync', manifest, requestId: request.requestId, replicaId: replica.replicaId }
  } catch (error) {
    console.error('[workbench-resolve-sync]', error)
    return empty
  }
}

/** Convenience wrapper for the Files tab: manifest entries pre-converted to a `WorkbenchFileNode[]` tree. */
export async function resolveWorkbenchSyncTree(input: ResolveWorkbenchSyncInput): Promise<WorkbenchSyncTreeResolution> {
  const resolved = await resolveWorkbenchSyncManifest(input)
  if (resolved.source === 'none' || !resolved.manifest) {
    return { source: 'none', tree: [], requestId: resolved.requestId, replicaId: resolved.replicaId }
  }
  return {
    source: 'sync',
    tree: manifestToWorkbenchFileTree(resolved.manifest.entries),
    revision: resolved.manifest.revision,
    requestId: resolved.requestId,
    replicaId: resolved.replicaId,
    entryCount: resolved.manifest.entryCount,
  }
}
