import {
  applyProjectSyncInventory,
  buildProjectContentManifest,
  createProjectSyncRequest,
  type ProjectSyncReplicaInput,
  type ProjectSyncWorkerBinding,
} from '@/lib/project-sync/model'
import type { ProjectSyncExecutorLookup } from '@/lib/project-sync/native-executor'
import {
  claimDeviceProjectSyncJob,
  recordDeviceProjectSyncFailure,
  recordDeviceProjectSyncInventory,
  recordDeviceProjectSyncUploadReceipt,
} from '@/lib/project-sync/runtime-service'
import type { ProjectSyncRuntimeRepository } from '@/lib/project-sync/runtime-store'

const NOW = '2026-07-14T08:00:00.000Z'
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const replicas: ProjectSyncReplicaInput[] = [
  { replicaId: 'source', locationId: 'linked-device:vps-a', mappingId: 'map-vps', orgId: 'org-a', projectId: 'project-a', availability: 'online', currentRevision: null },
  { replicaId: 'target', locationId: 'linked-device:mac-a', mappingId: 'map-mac', orgId: 'org-a', projectId: 'project-a', availability: 'online', currentRevision: null },
]
const baseline = buildProjectContentManifest({ projectId: 'project-a', entries: [{ type: 'file', path: 'README.md', size: 3, sha256: SHA_A }] })
const changed = buildProjectContentManifest({ projectId: 'project-a', entries: [{ type: 'file', path: 'README.md', size: 4, sha256: SHA_B }] })

function binding(requestId: string, replica: ProjectSyncReplicaInput): ProjectSyncWorkerBinding {
  return { capability: 'workspace.sync', requestId, orgId: replica.orgId, projectId: replica.projectId, replicaId: replica.replicaId, locationId: replica.locationId, mappingId: replica.mappingId }
}

function readyRequest() {
  const request = createProjectSyncRequest({
    requestId: 'request-a', orgId: 'org-a', projectId: 'project-a', canonicalLocationId: 'linked-device:vps-a',
    requestedByUserId: 'peet', replicas: replicas.map((replica) => ({ ...replica, currentRevision: baseline.revision })),
    continuousExecutorVerified: true, now: NOW,
  })
  return applyProjectSyncInventory(
    applyProjectSyncInventory(request, { binding: binding(request.requestId, replicas[0]), manifest: changed, observedAt: NOW }),
    { binding: binding(request.requestId, replicas[1]), manifest: baseline, observedAt: NOW },
  )
}

function sourceLookup(request = readyRequest(), overrides: {
  device?: Record<string, unknown>
  project?: Record<string, unknown>
  projectOrganization?: Record<string, unknown>
  membership?: Record<string, unknown>
} = {}): ProjectSyncExecutorLookup {
  return {
    getDevice: async () => overrides.device ?? ({ deviceId: 'vps-a', ownerType: 'organization', ownerOrgId: 'org-a', platform: 'linux', status: 'active', credentialVersion: 2, capabilities: ['workspace.sync'], syncProtocolVersion: 1 }),
    getCredential: async () => ({ deviceId: 'vps-a', credentialVersion: 2, revokedAt: null }),
    getGrant: async () => ({ deviceId: 'vps-a', orgId: 'org-a', status: 'active', capabilities: ['workspace.sync'] }),
    getMapping: async () => ({ mappingId: 'map-vps', deviceId: 'vps-a', orgId: 'org-a', workspaceId: 'workspace-a', status: 'active' }),
    getReplica: async () => ({ replicaId: 'source', projectId: 'project-a', orgId: 'org-a', workspaceId: 'workspace-a', locationId: 'linked-device:vps-a', mappingId: 'map-vps', relativePath: 'projects/project-a', active: true }),
    getRequest: async () => request,
    getProject: async () => overrides.project ?? ({ status: 'active', active: true, archived: false, deleted: false }),
    getProjectOrganization: async () => overrides.projectOrganization ?? ({ projectId: 'project-a', orgId: 'org-a', status: 'active' }),
    getMembership: async () => overrides.membership ?? ({ orgId: 'org-a', uid: 'owner-a', status: 'active' }),
  }
}

function repository(request = readyRequest()): ProjectSyncRuntimeRepository & {
  markObjectVerified: jest.Mock
  completeLease: jest.Mock
  putManifest: jest.Mock
  tryLease: jest.Mock
    advanceCasReadiness: jest.Mock
    getLease: jest.Mock
    releaseLease: jest.Mock
} {
  const uploadPayload = {
    kind: 'upload' as const,
    manifestRevision: changed.revision,
    objectStartIndex: 0,
    objects: [{ path: 'README.md', sha256: SHA_B, size: 4 }],
  }
  return {
    listDeviceReplicas: async () => [{ replicaId: 'source', syncRequest: { requestId: 'request-a' }, active: true }],
    getRequest: async () => request,
    getManifest: async (_requestId, replicaId) => replicaId === 'source' ? changed : baseline,
    putManifest: jest.fn(async () => undefined),
    ensureCasReadiness: async () => ({ revision: changed.revision, objectCount: 1, verifiedObjectCount: 0, ready: false }),
    advanceCasReadiness: jest.fn(async () => ({ revision: changed.revision, objectCount: 1, verifiedObjectCount: 1, ready: true })),
    markObjectVerified: jest.fn(async () => undefined),
    tryLease: jest.fn(async () => true),
    getLease: jest.fn(async () => ({
      jobId: 'syncjob-upload',
      jobKind: 'upload',
      binding: binding(request.requestId, replicas[0]),
      deviceId: 'vps-a',
      credentialVersion: 2,
      payloadHash: 'lease-payload',
      payload: uploadPayload,
      status: 'leased',
    })),
    completeLease: jest.fn(async () => undefined),
    releaseLease: jest.fn(async () => undefined),
  }
}

describe('project sync runtime service', () => {
  it('does not claim file-transfer work while combined retention controls are unverified', async () => {
    const repo = repository()
    await expect(claimDeviceProjectSyncJob(
      { deviceId: 'vps-a', credentialVersion: 2 },
      { repository: repo, lookup: sourceLookup(), storageLifecycleVerified: false },
    )).resolves.toBeNull()
    expect(repo.tryLease).not.toHaveBeenCalled()
  })

  it('rechecks the canonical project organisation link on both claim and receipt', async () => {
    const request = readyRequest()
    const repo = repository(request)
    const revoked = sourceLookup(request, {
      projectOrganization: { projectId: 'project-a', orgId: 'org-a', status: 'revoked' },
    })
    await expect(claimDeviceProjectSyncJob(
      { deviceId: 'vps-a', credentialVersion: 2 },
      { repository: repo, lookup: revoked, storageLifecycleVerified: true, storage: {} as never },
    )).resolves.toBeNull()
    expect(repo.tryLease).not.toHaveBeenCalled()

    const verifyUpload = jest.fn()
    await expect(recordDeviceProjectSyncUploadReceipt({
      identity: { deviceId: 'vps-a', credentialVersion: 2 },
      jobId: 'syncjob-upload',
      binding: binding(request.requestId, replicas[0]),
      objects: [{ path: 'README.md', sha256: SHA_B, size: 4 }],
    }, { repository: repo, lookup: revoked, storage: { verifyUpload } as never }))
      .rejects.toThrow(/workspace\.sync binding denied/i)
    expect(verifyUpload).not.toHaveBeenCalled()
    expect(repo.completeLease).not.toHaveBeenCalled()
  })

  it('leases an exact-bound upload job and returns only object-specific signed URLs', async () => {
    const repo = repository()
    const signUpload = jest.fn(async (object) => ({ ...object, objectPath: `cas/${object.sha256}`, url: 'https://storage.googleapis.com/upload', expiresAt: NOW, headers: { 'content-length': String(object.size) } }))
    const job = await claimDeviceProjectSyncJob(
      { deviceId: 'vps-a', credentialVersion: 2 },
      { repository: repo, lookup: sourceLookup(), storage: { signUpload } as never, now: () => NOW, storageLifecycleVerified: true },
    )

    expect(job).toEqual(expect.objectContaining({
      kind: 'upload',
      relativePath: 'projects/project-a',
      objects: [expect.objectContaining({ sha256: SHA_B, url: 'https://storage.googleapis.com/upload' })],
    }))
    expect(signUpload).toHaveBeenCalledWith({ orgId: 'org-a', projectId: 'project-a', sha256: SHA_B, size: 4 })
    expect(repo.tryLease).toHaveBeenCalledWith(expect.objectContaining({ job: expect.objectContaining({ kind: 'upload' }) }))
  })

  it('server-verifies every upload receipt before making the CAS object eligible for targets', async () => {
    const request = readyRequest()
    const repo = repository(request)
    const verifyUpload = jest.fn(async (object) => ({ ...object, objectPath: `cas/${object.sha256}`, verified: true as const }))
    await recordDeviceProjectSyncUploadReceipt({
      identity: { deviceId: 'vps-a', credentialVersion: 2 },
      jobId: 'syncjob-upload',
      binding: binding(request.requestId, replicas[0]),
      objects: [{ path: 'README.md', sha256: SHA_B, size: 4 }],
    }, { repository: repo, lookup: sourceLookup(request), storage: { verifyUpload } as never })

    expect(verifyUpload).toHaveBeenCalledWith({ orgId: 'org-a', projectId: 'project-a', sha256: SHA_B, size: 4 })
    expect(repo.markObjectVerified).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-a', projectId: 'project-a', sha256: SHA_B, size: 4 }))
    expect(repo.advanceCasReadiness).toHaveBeenCalledWith(expect.objectContaining({
      revision: changed.revision,
      expectedVerifiedObjectCount: 0,
      verifiedObjectCount: 1,
    }))
    expect(repo.completeLease).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 'syncjob-upload',
      identity: { deviceId: 'vps-a', credentialVersion: 2 },
      binding: binding(request.requestId, replicas[0]),
      jobKind: 'upload',
      payloadHash: 'lease-payload',
    }))
  })

  it('rejects empty or partial upload receipts without verifying or completing the lease', async () => {
    const request = readyRequest()
    const repo = repository(request)
    const verifyUpload = jest.fn()
    await expect(recordDeviceProjectSyncUploadReceipt({
      identity: { deviceId: 'vps-a', credentialVersion: 2 },
      jobId: 'syncjob-upload',
      binding: binding(request.requestId, replicas[0]),
      objects: [],
    }, { repository: repo, lookup: sourceLookup(request), storage: { verifyUpload } as never }))
      .rejects.toThrow(/complete leased object set/i)
    expect(verifyUpload).not.toHaveBeenCalled()
    expect(repo.advanceCasReadiness).not.toHaveBeenCalled()
    expect(repo.completeLease).not.toHaveBeenCalled()
  })

  it('does not lease a job when signed URL materialization fails', async () => {
    const repo = repository()
    await expect(claimDeviceProjectSyncJob(
      { deviceId: 'vps-a', credentialVersion: 2 },
      {
        repository: repo,
        lookup: sourceLookup(),
        storage: { signUpload: async () => { throw new Error('signing unavailable') } } as never,
        now: () => NOW,
        storageLifecycleVerified: true,
      },
    )).rejects.toThrow('signing unavailable')
    expect(repo.tryLease).not.toHaveBeenCalled()
  })

  it('validates manifest integrity before persisting an inventory head', async () => {
    const request = readyRequest()
    const repo = repository(request)
    await expect(recordDeviceProjectSyncInventory({
      identity: { deviceId: 'vps-a', credentialVersion: 2 },
      jobId: 'syncjob-inventory',
      binding: binding(request.requestId, replicas[0]),
      manifest: { ...changed, revision: SHA_A },
      observedAt: NOW,
    }, { repository: repo, lookup: sourceLookup(request) })).rejects.toThrow(/integrity/i)
    expect(repo.putManifest).not.toHaveBeenCalled()
  })

  it('accepts pristine bootstrap attestation only from its exact empty-target inventory lease', async () => {
    const request = readyRequest()
    const repo = repository(request)
    const empty = buildProjectContentManifest({ projectId: 'project-a', entries: [] })
    repo.getLease.mockResolvedValue({
      jobId: 'syncjob-inventory', jobKind: 'inventory', binding: binding(request.requestId, replicas[0]),
      deviceId: 'vps-a', credentialVersion: 2, payloadHash: 'inventory-lease', status: 'leased',
      payload: { kind: 'inventory', recurring: false, baselineRevision: null, bootstrapMissingRoot: false },
    })

    await expect(recordDeviceProjectSyncInventory({
      identity: { deviceId: 'vps-a', credentialVersion: 2 },
      jobId: 'syncjob-inventory', binding: binding(request.requestId, replicas[0]),
      manifest: empty, pristineBootstrap: true, observedAt: NOW,
    }, { repository: repo, lookup: sourceLookup(request), storage: {} as never })).rejects.toThrow(/pristine bootstrap lease/i)
    expect(repo.putManifest).not.toHaveBeenCalled()

    repo.getLease.mockResolvedValue({
      jobId: 'syncjob-inventory', jobKind: 'inventory', binding: binding(request.requestId, replicas[0]),
      deviceId: 'vps-a', credentialVersion: 2, payloadHash: 'inventory-lease', status: 'leased',
      payload: { kind: 'inventory', recurring: false, baselineRevision: null, bootstrapMissingRoot: true },
    })
    await expect(recordDeviceProjectSyncInventory({
      identity: { deviceId: 'vps-a', credentialVersion: 2 },
      jobId: 'syncjob-inventory', binding: binding(request.requestId, replicas[0]),
      manifest: changed, pristineBootstrap: true, observedAt: NOW,
    }, { repository: repo, lookup: sourceLookup(request), storage: {} as never })).rejects.toThrow(/empty manifest/i)
    expect(repo.putManifest).not.toHaveBeenCalled()
  })

  it('releases a retryable exact lease instead of wedging the deterministic job id', async () => {
    const request = readyRequest()
    const repo = repository(request)
    await recordDeviceProjectSyncFailure({
      identity: { deviceId: 'vps-a', credentialVersion: 2 },
      jobId: 'syncjob-upload',
      jobKind: 'upload',
      binding: binding(request.requestId, replicas[0]),
      reason: 'retryable_transport',
      failedAt: NOW,
    }, { repository: repo, lookup: sourceLookup(request), storage: {} as never })
    expect(repo.releaseLease).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 'syncjob-upload',
      identity: { deviceId: 'vps-a', credentialVersion: 2 },
      jobKind: 'upload',
      payloadHash: 'lease-payload',
    }))
    expect(repo.completeLease).not.toHaveBeenCalled()
  })
})
