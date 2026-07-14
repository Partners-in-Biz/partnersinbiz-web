import {
  applyProjectSyncInventory,
  buildProjectContentManifest,
  createProjectSyncRequest,
  type ProjectContentManifest,
  type ProjectSyncReplicaInput,
  type ProjectSyncWorkerBinding,
} from '@/lib/project-sync/model'
import { planProjectSyncRuntimeJob } from '@/lib/project-sync/runtime-jobs'

const NOW = '2026-07-14T08:00:00.000Z'
const replicas: ProjectSyncReplicaInput[] = [
  { replicaId: 'source', locationId: 'linked-device:vps-a', mappingId: 'map-vps', orgId: 'org-a', projectId: 'project-a', availability: 'online', currentRevision: null },
  { replicaId: 'target', locationId: 'linked-device:mac-a', mappingId: 'map-mac', orgId: 'org-a', projectId: 'project-a', availability: 'online', currentRevision: null },
]

function binding(requestId: string, replica: ProjectSyncReplicaInput): ProjectSyncWorkerBinding {
  return { capability: 'workspace.sync', requestId, orgId: replica.orgId, projectId: replica.projectId, replicaId: replica.replicaId, locationId: replica.locationId, mappingId: replica.mappingId }
}

const baseline = buildProjectContentManifest({ projectId: 'project-a', entries: [
  { type: 'file', path: 'README.md', size: 3, sha256: 'a'.repeat(64) },
] })
const changed = buildProjectContentManifest({ projectId: 'project-a', entries: [
  { type: 'file', path: 'README.md', size: 4, sha256: 'b'.repeat(64) },
] })

function readyRequest() {
  const initial = createProjectSyncRequest({
    requestId: 'request-a', orgId: 'org-a', projectId: 'project-a', canonicalLocationId: 'linked-device:vps-a',
    requestedByUserId: 'peet', replicas: replicas.map((replica) => ({ ...replica, currentRevision: baseline.revision })),
    continuousExecutorVerified: true, now: NOW,
  })
  const withSource = applyProjectSyncInventory(initial, { binding: binding(initial.requestId, replicas[0]), manifest: changed, observedAt: NOW })
  return applyProjectSyncInventory(withSource, { binding: binding(initial.requestId, replicas[1]), manifest: baseline, observedAt: NOW })
}

describe('project sync runtime job planner', () => {
  it('claims exact-bound inventory first and schedules recurring inventory after synchronization', () => {
    const initial = createProjectSyncRequest({
      requestId: 'request-a', orgId: 'org-a', projectId: 'project-a', canonicalLocationId: 'linked-device:vps-a',
      requestedByUserId: 'peet', replicas, continuousExecutorVerified: true, now: NOW,
    })
    expect(planProjectSyncRuntimeJob({ request: initial, replicaId: 'source' })).toEqual(expect.objectContaining({
      kind: 'inventory',
      binding: binding('request-a', replicas[0]),
      recurring: false,
      bootstrapMissingRoot: false,
    }))
    expect(planProjectSyncRuntimeJob({ request: initial, replicaId: 'target' })).toEqual(expect.objectContaining({
      kind: 'inventory',
      binding: binding('request-a', replicas[1]),
      recurring: false,
      bootstrapMissingRoot: true,
    }))
    const synced = { ...initial, status: 'synced' as const, replicaStates: initial.replicaStates.map((state) => ({
      ...state, status: 'synced' as const, inventoryRevision: baseline.revision, inventoryObservedAt: NOW,
    })) }
    expect(planProjectSyncRuntimeJob({ request: synced, replicaId: 'source', now: '2026-07-14T08:01:00.000Z' }))
      .toEqual(expect.objectContaining({ kind: 'inventory', recurring: true }))
  })

  it('schedules an apply when only executable intent differs', () => {
    const plain = buildProjectContentManifest({ projectId: 'project-a', entries: [
      { type: 'file', path: 'run.sh', size: 4, sha256: 'c'.repeat(64) },
    ] })
    const executable = buildProjectContentManifest({ projectId: 'project-a', entries: [
      { type: 'file', path: 'run.sh', size: 4, sha256: 'c'.repeat(64), executable: true },
    ] })
    const initial = createProjectSyncRequest({
      requestId: 'request-mode', orgId: 'org-a', projectId: 'project-a', canonicalLocationId: 'linked-device:vps-a',
      requestedByUserId: 'peet', replicas: replicas.map((replica) => ({ ...replica, currentRevision: plain.revision })),
      continuousExecutorVerified: true, now: NOW,
    })
    const request = applyProjectSyncInventory(applyProjectSyncInventory(initial, {
      binding: binding(initial.requestId, replicas[0]), manifest: executable, observedAt: NOW,
    }), {
      binding: binding(initial.requestId, replicas[1]), manifest: plain, observedAt: NOW,
    })

    expect(planProjectSyncRuntimeJob({
      request, replicaId: 'target', sourceManifest: executable, targetManifest: plain,
      casReadiness: { revision: executable.revision, objectCount: 1, verifiedObjectCount: 1, ready: true },
    })).toEqual(expect.objectContaining({
      kind: 'apply',
      objects: [{ path: 'run.sh', size: 4, sha256: 'c'.repeat(64) }],
    }))
  })

  it('uploads source objects before exposing verified downloads to the exact target transfer', () => {
    const request = readyRequest()
    expect(planProjectSyncRuntimeJob({
      request,
      replicaId: 'source',
      sourceManifest: changed,
      casReadiness: { revision: changed.revision, objectCount: 1, verifiedObjectCount: 0, ready: false },
    }))
      .toEqual(expect.objectContaining({
        kind: 'upload',
        objects: [{ path: 'README.md', sha256: 'b'.repeat(64), size: 4 }],
      }))
    expect(planProjectSyncRuntimeJob({
      request, replicaId: 'target', sourceManifest: changed, targetManifest: baseline,
      casReadiness: { revision: changed.revision, objectCount: 1, verifiedObjectCount: 0, ready: false },
    })).toBeNull()
    expect(planProjectSyncRuntimeJob({
      request, replicaId: 'target', sourceManifest: changed, targetManifest: baseline,
      casReadiness: { revision: changed.revision, objectCount: 1, verifiedObjectCount: 1, ready: true },
    })).toEqual(expect.objectContaining({
      kind: 'apply',
      transferId: request.transfers[0].transferId,
      expectedTargetRevision: baseline.revision,
      objects: [{ path: 'README.md', sha256: 'b'.repeat(64), size: 4 }],
    }))
  })

  it('deduplicates content and emits bounded deterministic upload batches', () => {
    const duplicateContent = buildProjectContentManifest({ projectId: 'project-a', entries: [
      { type: 'file', path: 'a.txt', size: 4, sha256: 'b'.repeat(64) },
      { type: 'file', path: 'b.txt', size: 4, sha256: 'b'.repeat(64) },
      { type: 'file', path: 'c.txt', size: 5, sha256: 'c'.repeat(64) },
    ] })
    const request = readyRequest()
    request.transfers[0].desiredRevision = duplicateContent.revision
    request.replicaStates = request.replicaStates.map((state) => state.replicaId === 'source'
      ? { ...state, inventoryRevision: duplicateContent.revision }
      : state)

    const first = planProjectSyncRuntimeJob({
      request,
      replicaId: 'source',
      sourceManifest: duplicateContent,
      casReadiness: { revision: duplicateContent.revision, objectCount: 2, verifiedObjectCount: 0, ready: false },
      uploadBatchSize: 1,
    })
    const second = planProjectSyncRuntimeJob({
      request,
      replicaId: 'source',
      sourceManifest: duplicateContent,
      casReadiness: { revision: duplicateContent.revision, objectCount: 2, verifiedObjectCount: 1, ready: false },
      uploadBatchSize: 1,
    })
    expect(first).toEqual(expect.objectContaining({ kind: 'upload', objectStartIndex: 0, objects: [
      { path: 'a.txt', size: 4, sha256: 'b'.repeat(64) },
    ] }))
    expect(second).toEqual(expect.objectContaining({ kind: 'upload', objectStartIndex: 1, objects: [
      { path: 'c.txt', size: 5, sha256: 'c'.repeat(64) },
    ] }))
  })

  it('refuses jobs for unverified executors or mismatched replica identities', () => {
    const request = readyRequest()
    expect(planProjectSyncRuntimeJob({ request: { ...request, continuousExecutorVerified: false }, replicaId: 'source', sourceManifest: changed })).toBeNull()
    expect(planProjectSyncRuntimeJob({ request, replicaId: 'outside', sourceManifest: changed })).toBeNull()
  })
})
