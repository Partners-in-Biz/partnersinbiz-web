import { NextRequest } from 'next/server'
import { handlePairingExchange } from '@/app/api/v1/linked-computers/pairing/exchange/route'
import { handleRotationAck } from '@/app/api/v1/linked-computers/[deviceId]/credentials/rotation/ack/route'
import { handleLinkedRunClaim } from '@/app/api/v1/linked-computers/[deviceId]/runs/claim/route'
import { handleLinkedRunProgress } from '@/app/api/v1/linked-computers/[deviceId]/runs/[jobId]/progress/route'
import { handleLinkedRunComplete } from '@/app/api/v1/linked-computers/[deviceId]/runs/[jobId]/complete/route'
import { authorizeLinkedComputerDispatch, discoverAuthorizedRuntimeTargets } from '@/lib/linked-computers/runtime-targets'
import { sanitizeLinkedResult } from '@/lib/linked-computers/run-queue'

type Row = Record<string, unknown>

function readDb(rows: Record<string, Row>) {
  const entries = Object.entries(rows)
  const snapshot = (path: string, row?: Row) => ({ exists: Boolean(row), id: path.split('/').at(-1), data: () => row })
  return {
    collection: (name: string) => ({
      doc: (id: string) => ({ get: async () => snapshot(`${name}/${id}`, rows[`${name}/${id}`]) }),
      get: async () => ({ docs: entries.filter(([path]) => path.startsWith(`${name}/`)).map(([path, row]) => snapshot(path, row)) }),
    }),
  }
}

const now = Date.parse('2026-07-13T12:00:00.000Z')

function fixture() {
  return {
    'orgMembers/org-a_user-a': { orgId: 'org-a', uid: 'user-a', status: 'active' },
    'orgMembers/org-a_user-b': { orgId: 'org-a', uid: 'user-b', status: 'active' },
    'orgMembers/org-b_user-b': { orgId: 'org-b', uid: 'user-b', status: 'active' },
    'linked_devices/device-a': {
      deviceId: 'device-a', ownerUserId: 'user-a', runtimeTargetId: 'linked-device:device-a', label: 'Office Mac',
      platform: 'macos', architecture: 'arm64', runtimeVersion: '2.0.0', hermesVersion: '0.20.6', capabilities: ['workspace.execute'],
      status: 'active', health: 'ok', credentialVersion: 2, lastSeenAt: new Date(now).toISOString(), publicKey: 'public-key',
    },
    'linked_device_credentials/device-a': { deviceId: 'device-a', credentialVersion: 2 },
    'linked_device_grants/org-a_device-a': {
      deviceId: 'device-a', orgId: 'org-a', status: 'active', capabilities: ['workspace.execute'], allowedUserIds: ['user-b'],
    },
    'linked_device_workspace_mappings/map-a': {
      mappingId: 'map-a', deviceId: 'device-a', orgId: 'org-a', workspaceId: 'workspace-a', status: 'active',
    },
  }
}

describe('linked computers two-user/two-organisation acceptance', () => {
  it('denies cross-tenant access, membership loss, revoked devices and offline fallback', async () => {
    const rows = fixture()
    const db = readDb(rows)
    await expect(authorizeLinkedComputerDispatch({
      userId: 'user-b', orgId: 'org-b', workspaceId: 'workspace-b', runtimeTargetId: 'linked-device:device-a',
    }, { db: db as never, nowMs: () => now })).rejects.toMatchObject({ code: 'linked_device_not_authorized' })

    expect(await discoverAuthorizedRuntimeTargets({ userId: 'user-b', orgId: 'org-a', workspaceId: 'workspace-a' }, {
      db: db as never, nowMs: () => now,
    })).toEqual([expect.objectContaining({ deviceId: 'device-a', mappingId: 'map-a' })])

    rows['orgMembers/org-a_user-a'].status = 'revoked'
    await expect(authorizeLinkedComputerDispatch({
      userId: 'user-b', orgId: 'org-a', workspaceId: 'workspace-a', runtimeTargetId: 'linked-device:device-a',
    }, { db: readDb(rows) as never, nowMs: () => now })).rejects.toMatchObject({ code: 'linked_device_membership_required' })

    rows['orgMembers/org-a_user-a'].status = 'active'
    rows['linked_devices/device-a'].status = 'revoked'
    await expect(authorizeLinkedComputerDispatch({
      userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a', runtimeTargetId: 'linked-device:device-a',
    }, { db: readDb(rows) as never, nowMs: () => now, compatibilityTargets: [{ id: 'vps', label: 'VPS', kind: 'platform-vps' }] }))
      .rejects.toMatchObject({ code: 'linked_device_not_authorized' })

    rows['linked_devices/device-a'].status = 'active'
    rows['linked_devices/device-a'].lastSeenAt = new Date(now - 10 * 60_000).toISOString()
    await expect(authorizeLinkedComputerDispatch({
      userId: 'user-a', orgId: 'org-a', workspaceId: 'workspace-a', runtimeTargetId: 'linked-device:device-a',
    }, { db: readDb(rows) as never, nowMs: () => now, compatibilityTargets: [{ id: 'vps', label: 'VPS', kind: 'platform-vps' }] }))
      .rejects.toMatchObject({ code: 'linked_device_stale' })
  })

  it('rejects pairing replay and safely acknowledges credential rotation', async () => {
    let consumed = false
    const exchange = jest.fn(async () => {
      if (consumed) throw new Error('linked computers: pairing challenge consumed')
      consumed = true
      return { deviceId: 'device-a', credential: 'one-time-credential', credentialVersion: 1 }
    })
    const request = () => new NextRequest('https://app.test/api/v1/linked-computers/pairing/exchange', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challengeId: 'challenge-a', secret: 'private-code' }),
    })
    const first = await handlePairingExchange(request(), exchange as never)
    expect(first.status).toBe(200)
    expect(first.headers.get('cache-control')).toBe('no-store')
    expect(await first.text()).not.toContain('private-code')
    const replay = await handlePairingExchange(request(), exchange as never)
    expect(replay.status).toBe(410)
    expect(await replay.text()).not.toMatch(/private-code|one-time-credential/)

    const ack = jest.fn(async () => ({ acknowledged: true as const, credentialVersion: 2 }))
    const ackRequest = new NextRequest('https://app.test/api/v1/linked-computers/device-a/credentials/rotation/ack', {
      method: 'POST', body: JSON.stringify({ rotationDeliveryId: 'delivery-123456' }),
    })
    const response = await handleRotationAck(ackRequest, 'device-a', async () => ({
      deviceId: 'device-a', ownerUserId: 'user-a', credentialVersion: 2,
    }), ack)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(ack).toHaveBeenCalledWith({ deviceId: 'device-a', authenticatedCredentialVersion: 2, rotationDeliveryId: 'delivery-123456' })
  })

  it('claims and callbacks through the outbound queue with path and secret redaction', async () => {
    const identity = { deviceId: 'device-a', ownerUserId: 'user-a', credentialVersion: 2 }
    const claim = {
      jobId: 'job-a', requestId: 'request-1234567890', prompt: 'work', workspaceId: 'workspace-a', projectId: 'project-a',
      mappingId: 'map-a', relativeFolder: 'Projects/project-a', attempt: 1, leaseToken: 'lease-token-123456',
    }
    const claimResponse = await handleLinkedRunClaim(new NextRequest('https://app.test/api/v1/linked-computers/device-a/runs/claim', {
      method: 'POST', body: '{}',
    }), 'device-a', async () => identity, async () => claim)
    expect(claimResponse.status).toBe(200)
    const publicClaim = JSON.stringify(await claimResponse.json())
    expect(publicClaim).not.toMatch(/credential|privateKey|endpoint/i)
    expect(publicClaim).not.toContain('/Users/')
    expect(publicClaim).not.toContain('C:\\')

    const progress = jest.fn(async () => ({}))
    const progressResponse = await handleLinkedRunProgress(new NextRequest('https://app.test/api/v1/linked-computers/device-a/runs/job-a/progress', {
      method: 'POST', body: JSON.stringify({ receipt: { jobId: 'job-a', attempt: 1, leaseToken: 'lease-token-123456' } }),
    }), 'device-a', 'job-a', async () => identity, progress)
    expect(progressResponse.status).toBe(200)
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'device-a', jobId: 'job-a', event: 'progress' }))

    const complete = jest.fn(async () => ({}))
    const completeResponse = await handleLinkedRunComplete(new NextRequest('https://app.test/api/v1/linked-computers/device-a/runs/job-a/complete', {
      method: 'POST', body: JSON.stringify({ receipt: { jobId: 'job-a', attempt: 1, leaseToken: 'lease-token-123456' }, outcome: 'completed', output: 'done' }),
    }), 'device-a', 'job-a', async () => identity, complete)
    expect(completeResponse.status).toBe(200)
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'device-a', jobId: 'job-a', event: 'complete' }))

    // Secrets scrubbed inline; filesystem paths stay readable for operators.
    const scrubbed = sanitizeLinkedResult('Authorization: Bearer abc /Users/peet/private C:\\secret token=xyz')
    expect(scrubbed).toContain('/Users/peet/private')
    expect(scrubbed).toContain('C:\\secret')
    expect(scrubbed).not.toMatch(/\babc\b|token=xyz/)
    expect(scrubbed).not.toBe('[redacted output]')
  })
})
