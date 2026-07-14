import { NextRequest } from 'next/server'
import { handleProjectSyncClaim } from '@/app/api/v1/linked-computers/[deviceId]/sync/claim/route'
import { handleProjectSyncInventory } from '@/app/api/v1/linked-computers/[deviceId]/sync/inventory/route'
import { handleProjectSyncUploadReceipt } from '@/app/api/v1/linked-computers/[deviceId]/sync/upload-receipt/route'
import { handleProjectSyncTransferReceipt } from '@/app/api/v1/linked-computers/[deviceId]/sync/receipt/route'
import { handleProjectSyncFailure } from '@/app/api/v1/linked-computers/[deviceId]/sync/failure/route'

const identity = { deviceId: 'device-a', ownerUserId: 'owner-a', credentialVersion: 3 }
const binding = {
  capability: 'workspace.sync' as const,
  requestId: 'request-a', orgId: 'org-a', projectId: 'project-a', replicaId: 'replica-a',
  locationId: 'linked-device:device-a', mappingId: 'mapping-a',
}

function request(path: string, body: unknown) {
  return new NextRequest(`https://partnersinbiz.online${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('device-authenticated project sync runtime endpoints', () => {
  it('claims persistent sync work only after authenticating the exact raw device request', async () => {
    const auth = jest.fn(async () => identity)
    const claim = jest.fn(async () => ({ jobId: 'job-a', kind: 'inventory', binding, relativePath: 'projects/project-a' }))
    const req = request('/api/v1/linked-computers/device-a/sync/claim', { runtimeVersion: '2.0.0', syncProtocolVersion: 1 })
    const response = await handleProjectSyncClaim(req, 'device-a', auth, claim)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(auth).toHaveBeenCalledWith(req, 'device-a', JSON.stringify({ runtimeVersion: '2.0.0', syncProtocolVersion: 1 }))
    expect(claim).toHaveBeenCalledWith({ deviceId: 'device-a', credentialVersion: 3 })
    expect((await response.json()).data).toEqual(expect.objectContaining({ kind: 'inventory', binding }))
  })

  it('records inventory through the exact authenticated device identity and binding', async () => {
    const auth = jest.fn(async () => identity)
    const record = jest.fn(async () => ({ status: 'pending_inventory', stateVersion: 2 }))
    const body = {
      jobId: 'job-inventory', binding,
      observedAt: '2026-07-14T08:00:00.000Z',
      pristineBootstrap: true,
      manifest: { version: 1, projectId: 'project-a', entries: [], entryCount: 0, totalBytes: 0, revision: 'a'.repeat(64) },
    }
    const response = await handleProjectSyncInventory(
      request('/api/v1/linked-computers/device-a/sync/inventory', body),
      'device-a', auth, record,
    )
    expect(response.status).toBe(200)
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      identity: { deviceId: 'device-a', credentialVersion: 3 }, binding, pristineBootstrap: true,
    }))
  })

  it('keeps upload verification and transfer completion on separate device-authenticated receipts', async () => {
    const auth = jest.fn(async () => identity)
    const upload = jest.fn(async () => undefined)
    const complete = jest.fn(async () => ({ status: 'synced', stateVersion: 4 }))
    const uploadResponse = await handleProjectSyncUploadReceipt(request(
      '/api/v1/linked-computers/device-a/sync/upload-receipt',
      { jobId: 'job-upload', binding, objects: [{ path: 'README.md', sha256: 'b'.repeat(64), size: 4 }] },
    ), 'device-a', auth, upload)
    const receiptResponse = await handleProjectSyncTransferReceipt(request(
      '/api/v1/linked-computers/device-a/sync/receipt',
      { jobId: 'job-apply', binding, transferId: 'transfer-a', beforeRevision: 'a'.repeat(64), appliedRevision: 'b'.repeat(64), verifiedManifestRevision: 'b'.repeat(64), verifiedAt: '2026-07-14T08:01:00.000Z' },
    ), 'device-a', auth, complete)

    expect(uploadResponse.status).toBe(200)
    expect(receiptResponse.status).toBe(200)
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ identity: { deviceId: 'device-a', credentialVersion: 3 }, binding }))
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ transferId: 'transfer-a', binding }))
  })

  it('denies cross-device authenticated identities before touching sync state', async () => {
    const claim = jest.fn()
    const response = await handleProjectSyncClaim(
      request('/api/v1/linked-computers/device-a/sync/claim', {}),
      'device-a',
      async () => ({ ...identity, deviceId: 'device-b' }),
      claim,
    )
    expect(response.status).toBe(403)
    expect(claim).not.toHaveBeenCalled()
  })

  it('records classified runtime failures through the same exact device identity and binding', async () => {
    const auth = jest.fn(async () => identity)
    const record = jest.fn(async () => ({ status: 'conflict', stateVersion: 5 }))
    const response = await handleProjectSyncFailure(request(
      '/api/v1/linked-computers/device-a/sync/failure',
      {
        jobId: 'job-apply', jobKind: 'apply', binding, transferId: 'transfer-a',
        reason: 'target_drift', observedRevision: 'c'.repeat(64), failedAt: '2026-07-14T08:02:00.000Z',
      },
    ), 'device-a', auth, record)

    expect(response.status).toBe(200)
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      identity: { deviceId: 'device-a', credentialVersion: 3 },
      jobKind: 'apply', reason: 'target_drift', binding,
    }))
    expect((await response.json()).data).toEqual({ status: 'conflict', stateVersion: 5 })
  })

  it.each([
    ['inventory', (auth: typeof failingAuth, fail: typeof failingRecord) => handleProjectSyncInventory(request(
      '/api/v1/linked-computers/device-a/sync/inventory',
      { jobId: 'job-inventory', binding, observedAt: '2026-07-14T08:00:00.000Z', manifest: { version: 1, projectId: 'project-a', entries: [], entryCount: 0, totalBytes: 0, revision: 'a'.repeat(64) } },
    ), 'device-a', auth, fail)],
    ['upload receipt', (auth: typeof failingAuth, fail: typeof failingRecord) => handleProjectSyncUploadReceipt(request(
      '/api/v1/linked-computers/device-a/sync/upload-receipt',
      { jobId: 'job-upload', binding, objects: [] },
    ), 'device-a', auth, fail)],
    ['transfer receipt', (auth: typeof failingAuth, fail: typeof failingRecord) => handleProjectSyncTransferReceipt(request(
      '/api/v1/linked-computers/device-a/sync/receipt',
      { jobId: 'job-apply', binding, transferId: 'transfer-a', beforeRevision: null, appliedRevision: 'a'.repeat(64), verifiedManifestRevision: 'a'.repeat(64), verifiedAt: '2026-07-14T08:00:00.000Z' },
    ), 'device-a', auth, fail)],
    ['failure receipt', (auth: typeof failingAuth, fail: typeof failingRecord) => handleProjectSyncFailure(request(
      '/api/v1/linked-computers/device-a/sync/failure',
      { jobId: 'job-upload', jobKind: 'upload', binding, reason: 'source_drift', failedAt: '2026-07-14T08:00:00.000Z' },
    ), 'device-a', auth, fail)],
  ])('returns a retryable generic service response for unexpected %s persistence failures', async (_label, invoke) => {
    const response = await invoke(failingAuth, failingRecord)
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body).toEqual({ success: false, error: 'Project sync service temporarily unavailable' })
    expect(JSON.stringify(body)).not.toContain('Firestore')
    expect(JSON.stringify(body)).not.toContain('secret/internal/path')
  })
})

const failingAuth = async () => identity
const failingRecord = async (): Promise<never> => {
  throw new Error('Firestore unavailable at secret/internal/path')
}
