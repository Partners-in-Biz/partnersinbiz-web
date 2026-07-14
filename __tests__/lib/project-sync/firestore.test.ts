import { createProjectSyncFirestoreRepository, projectSyncHeadId, type ProjectSyncFirestore } from '@/lib/project-sync/firestore'
import { createProjectSyncRequest } from '@/lib/project-sync/model'
import { projectSyncReplicaPatches } from '@/lib/project-sync/coordinator'

type Row = Record<string, unknown>

function fakeFirestore(seed: Record<string, Record<string, Row>>) {
  const rows = structuredClone(seed)
  const writes: Array<{ operation: string; collection: string; id: string; data?: Row }> = []
  const db: ProjectSyncFirestore = {
    collection(collectionName) {
      return {
        doc(id) {
          return { collectionName, id }
        },
      }
    },
    async runTransaction(callback) {
      return callback({
        get: async (ref) => ({ id: ref.id, exists: Boolean(rows[ref.collectionName]?.[ref.id]), data: () => rows[ref.collectionName]?.[ref.id] }),
        create(ref, data) {
          writes.push({ operation: 'create', collection: ref.collectionName, id: ref.id, data })
          rows[ref.collectionName] ??= {}
          rows[ref.collectionName][ref.id] = data
        },
        set(ref, data) {
          writes.push({ operation: 'set', collection: ref.collectionName, id: ref.id, data })
          rows[ref.collectionName] ??= {}
          rows[ref.collectionName][ref.id] = { ...(rows[ref.collectionName][ref.id] ?? {}), ...data }
        },
      })
    },
  }
  return { db, rows, writes }
}

function request() {
  return createProjectSyncRequest({
    requestId: 'sync-request-a', orgId: 'org-a', projectId: 'project-a', canonicalLocationId: 'vps-location',
    requestedByUserId: 'peet', now: '2026-07-13T22:00:00.000Z',
    replicas: [
      { replicaId: 'replica-vps', locationId: 'vps-location', mappingId: 'map-vps', orgId: 'org-a', projectId: 'project-a', availability: 'online', currentRevision: null },
      { replicaId: 'replica-mac', locationId: 'mac-location', mappingId: 'map-mac', orgId: 'org-a', projectId: 'project-a', availability: 'online', currentRevision: null },
    ],
  })
}

describe('project sync Firestore repository', () => {
  it('atomically creates the tenant-scoped request, head, replica patches, and audit event', async () => {
    const syncRequest = request()
    const { db, rows, writes } = fakeFirestore({
      project_location_replicas: {
        'replica-vps': { replicaId: 'replica-vps', orgId: 'org-a', projectId: 'project-a', active: true },
        'replica-mac': { replicaId: 'replica-mac', orgId: 'org-a', projectId: 'project-a', active: true },
      },
    })
    const repository = createProjectSyncFirestoreRepository(db)
    const result = await repository.createIfNoActive(syncRequest, projectSyncReplicaPatches(syncRequest))
    expect(result).toEqual({ created: true, request: syncRequest })
    expect(rows.project_sync_requests['sync-request-a']).toEqual(syncRequest)
    expect(Object.values(rows.project_sync_heads)).toEqual([
      expect.objectContaining({ orgId: 'org-a', projectId: 'project-a', requestId: 'sync-request-a', status: 'pending_inventory' }),
    ])
    expect(rows.project_location_replicas['replica-vps']).toEqual(expect.objectContaining({ syncStatus: 'pending' }))
    expect(writes.some((write) => write.collection === 'project_sync_events')).toBe(true)
  })

  it('returns an existing active request instead of creating competing sync work', async () => {
    const syncRequest = request()
    const headId = projectSyncHeadId('org-a', 'project-a')
    const { db, writes } = fakeFirestore({
      project_sync_heads: { [headId]: { orgId: 'org-a', projectId: 'project-a', requestId: syncRequest.requestId, status: syncRequest.status } },
      project_sync_requests: { [syncRequest.requestId]: syncRequest as unknown as Row },
      project_location_replicas: {
        'replica-vps': { replicaId: 'replica-vps', orgId: 'org-a', projectId: 'project-a', active: true },
        'replica-mac': { replicaId: 'replica-mac', orgId: 'org-a', projectId: 'project-a', active: true },
      },
    })
    const result = await createProjectSyncFirestoreRepository(db)
      .createIfNoActive({ ...syncRequest, requestId: 'sync-request-b' }, projectSyncReplicaPatches(syncRequest))
    expect(result).toEqual({ created: false, request: syncRequest })
    expect(writes).toEqual([])
  })

  it('re-attests an unstarted active request after every replica installs the native executor', async () => {
    const unverified = request()
    const verifiedAttempt = { ...request(), requestId: 'sync-request-b', continuousExecutorVerified: true }
    const headId = projectSyncHeadId('org-a', 'project-a')
    const { db, rows } = fakeFirestore({
      project_sync_heads: { [headId]: { orgId: 'org-a', projectId: 'project-a', requestId: unverified.requestId, status: unverified.status } },
      project_sync_requests: { [unverified.requestId]: unverified as unknown as Row },
      project_location_replicas: {
        'replica-vps': { replicaId: 'replica-vps', orgId: 'org-a', projectId: 'project-a', active: true },
        'replica-mac': { replicaId: 'replica-mac', orgId: 'org-a', projectId: 'project-a', active: true },
      },
    })

    const result = await createProjectSyncFirestoreRepository(db)
      .createIfNoActive(verifiedAttempt, projectSyncReplicaPatches(verifiedAttempt))

    expect(result.created).toBe(true)
    expect(result.request).toEqual(expect.objectContaining({
      requestId: unverified.requestId,
      continuousExecutorVerified: true,
      stateVersion: unverified.stateVersion + 1,
    }))
    expect(rows.project_location_replicas['replica-vps'].syncRequest).toEqual(expect.objectContaining({
      requestId: unverified.requestId,
      continuousExecutorVerified: true,
    }))
  })

  it('uses stateVersion compare-and-set and rejects replica tenant drift', async () => {
    const syncRequest = request()
    const { db } = fakeFirestore({
      project_sync_requests: { [syncRequest.requestId]: syncRequest as unknown as Row },
      project_location_replicas: {
        'replica-vps': { replicaId: 'replica-vps', orgId: 'org-a', projectId: 'project-a', active: true },
        'replica-mac': { replicaId: 'replica-mac', orgId: 'wrong-org', projectId: 'project-a', active: true },
      },
    })
    const repository = createProjectSyncFirestoreRepository(db)
    expect(await repository.compareAndSet(syncRequest.requestId, 99, syncRequest, [])).toBe(false)
    await expect(repository.compareAndSet(
      syncRequest.requestId,
      syncRequest.stateVersion,
      { ...syncRequest, stateVersion: syncRequest.stateVersion + 1 },
      projectSyncReplicaPatches(syncRequest),
    )).rejects.toThrow('replica tenant binding changed')
  })
})
