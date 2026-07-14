import {
  recordAuthorizedProjectSyncInventory,
  recordAuthorizedProjectSyncTransferReceipt,
  startProjectSync,
  type ProjectSyncCoordinatorRepository,
  type ProjectSyncReplicaPatch,
} from '@/lib/project-sync/coordinator'
import { buildProjectContentManifest, type ProjectSyncRequest, type ProjectSyncReplicaInput } from '@/lib/project-sync/model'

const NOW = '2026-07-13T22:00:00.000Z'

function replicas(): ProjectSyncReplicaInput[] {
  return [
    { replicaId: 'replica-vps', locationId: 'partners-vps', mappingId: 'map-vps', orgId: 'org-a', projectId: 'project-a', availability: 'online', currentRevision: null },
    { replicaId: 'replica-mac', locationId: 'peets-mac-mini', mappingId: 'map-mac', orgId: 'org-a', projectId: 'project-a', availability: 'offline', currentRevision: null },
  ]
}

function memoryRepository(): ProjectSyncCoordinatorRepository & {
  requests: Map<string, ProjectSyncRequest>
  replicaPatches: ProjectSyncReplicaPatch[]
} {
  const requests = new Map<string, ProjectSyncRequest>()
  const replicaPatches: ProjectSyncReplicaPatch[] = []
  return {
    requests,
    replicaPatches,
    getRequest: async (requestId) => requests.get(requestId) ?? null,
    createIfNoActive: async (request, patches) => {
      const active = [...requests.values()].find((row) => row.orgId === request.orgId && row.projectId === request.projectId
        && !['synced', 'failed', 'cancelled'].includes(row.status))
      if (active) return { created: false, request: active }
      requests.set(request.requestId, request)
      replicaPatches.push(...patches)
      return { created: true, request }
    },
    compareAndSet: async (requestId, expectedStateVersion, request, patches) => {
      const current = requests.get(requestId)
      if (!current || current.stateVersion !== expectedStateVersion) return false
      requests.set(requestId, request)
      replicaPatches.push(...patches)
      return true
    },
  }
}

describe('project sync coordinator persistence contract', () => {
  it('atomically records a truthful request and pending/offline replica states', async () => {
    const repository = memoryRepository()
    const result = await startProjectSync({
      orgId: 'org-a', projectId: 'project-a', canonicalLocationId: 'partners-vps',
      requestedByUserId: 'peet', replicas: replicas(), idempotencyKey: 'manual-sync-1', now: NOW,
    }, { repository })
    expect(result.created).toBe(true)
    expect(result.request.requestId).toMatch(/^psync_[a-f0-9]{40}$/)
    expect(result.request.status).toBe('waiting_for_locations')
    expect(repository.replicaPatches).toEqual([
      expect.objectContaining({ replicaId: 'replica-vps', patch: expect.objectContaining({ syncStatus: 'pending' }) }),
      expect.objectContaining({ replicaId: 'replica-mac', patch: expect.objectContaining({ syncStatus: 'offline' }) }),
    ])
    expect(JSON.stringify(repository.replicaPatches)).not.toContain('synced')

    const repeated = await startProjectSync({
      orgId: 'org-a', projectId: 'project-a', canonicalLocationId: 'partners-vps',
      requestedByUserId: 'peet', replicas: replicas(), idempotencyKey: 'different-key', now: NOW,
    }, { repository })
    expect(repeated.created).toBe(false)
    expect(repeated.request.requestId).toBe(result.request.requestId)
  })

  it('persists native executor verification only when supplied by the eligibility preflight', async () => {
    const repository = memoryRepository()
    const result = await startProjectSync({
      orgId: 'org-a', projectId: 'project-a', canonicalLocationId: 'partners-vps',
      requestedByUserId: 'peet', replicas: replicas().map((row) => ({ ...row, availability: 'online' })),
      idempotencyKey: 'verified-native-sync', now: NOW, continuousExecutorVerified: true,
    }, { repository })

    expect(result.request.continuousExecutorVerified).toBe(true)
    expect(repository.replicaPatches.every((row) => (
      (row.patch.syncRequest as Record<string, unknown>).continuousExecutorVerified === true
    ))).toBe(true)
  })

  it('persists signed inventory reconciliation with optimistic concurrency and exact replica revisions', async () => {
    const repository = memoryRepository()
    const started = await startProjectSync({
      orgId: 'org-a', projectId: 'project-a', canonicalLocationId: 'partners-vps',
      requestedByUserId: 'peet', replicas: replicas().map((row) => ({ ...row, availability: 'online' })),
      idempotencyKey: 'manual-sync-1', now: NOW,
    }, { repository })
    const empty = buildProjectContentManifest({ projectId: 'project-a', entries: [] })
    const first = await recordAuthorizedProjectSyncInventory({
      requestId: started.request.requestId,
      report: {
        binding: { capability: 'workspace.sync', requestId: started.request.requestId, orgId: 'org-a', projectId: 'project-a', replicaId: 'replica-vps', locationId: 'partners-vps', mappingId: 'map-vps' },
        manifest: empty,
        observedAt: NOW,
      },
    }, { repository })
    expect(first.status).toBe('pending_inventory')
    const completed = await recordAuthorizedProjectSyncInventory({
      requestId: started.request.requestId,
      report: {
        binding: { capability: 'workspace.sync', requestId: started.request.requestId, orgId: 'org-a', projectId: 'project-a', replicaId: 'replica-mac', locationId: 'peets-mac-mini', mappingId: 'map-mac' },
        manifest: empty,
        observedAt: NOW,
      },
    }, { repository })
    expect(completed.status).toBe('synced')
    const latest = repository.replicaPatches.slice(-2)
    expect(latest.every((row) => row.patch.syncStatus === 'synced' && row.patch.currentRevision === empty.revision)).toBe(true)
    expect(latest.every((row) => (row.patch.lastSync as Record<string, unknown>).continuousExecutorVerified === false)).toBe(true)
  })

  it('refuses stale inventory state instead of overwriting a concurrent coordinator update', async () => {
    const repository = memoryRepository()
    const started = await startProjectSync({
      orgId: 'org-a', projectId: 'project-a', canonicalLocationId: 'partners-vps',
      requestedByUserId: 'peet', replicas: replicas().map((row) => ({ ...row, availability: 'online' })),
      idempotencyKey: 'manual-sync-1', now: NOW,
    }, { repository })
    repository.compareAndSet = async () => false
    const empty = buildProjectContentManifest({ projectId: 'project-a', entries: [] })
    await expect(recordAuthorizedProjectSyncInventory({
      requestId: started.request.requestId,
      report: {
        binding: { capability: 'workspace.sync', requestId: started.request.requestId, orgId: 'org-a', projectId: 'project-a', replicaId: 'replica-mac', locationId: 'peets-mac-mini', mappingId: 'map-mac' },
        manifest: empty, observedAt: NOW,
      },
    }, { repository })).rejects.toThrow('state changed concurrently')
  })

  it('rejects a transfer receipt for an unknown coordinator request', async () => {
    await expect(recordAuthorizedProjectSyncTransferReceipt({
      requestId: 'missing-request',
      report: {
        binding: { capability: 'workspace.sync', requestId: 'missing-request', orgId: 'org-a', projectId: 'project-a', replicaId: 'replica-mac', locationId: 'peets-mac-mini', mappingId: 'map-mac' },
        transferId: 'missing-transfer', beforeRevision: null,
        appliedRevision: 'a'.repeat(64), verifiedManifestRevision: 'a'.repeat(64), verifiedAt: NOW,
      },
    }, { repository: memoryRepository() })).rejects.toThrow('project sync request not found')
  })
})
