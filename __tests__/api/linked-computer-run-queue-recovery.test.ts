import { Timestamp } from 'firebase-admin/firestore'
import { createHash } from 'node:crypto'

const mockCollection = jest.fn()
const mockRunTransaction = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection, runTransaction: mockRunTransaction },
}))

import { claimOldestLinkedRun } from '@/lib/linked-computers/run-queue-store'
import { encryptLinkedRunPayload } from '@/lib/linked-computers/run-queue'

const now = Date.parse('2026-08-01T19:00:00.000Z')

function agentLeasePath(deviceId: string, agentId: string): string {
  const id = createHash('sha256').update(`linked-run-agent-lease:v1\n${deviceId}\n${agentId}`).digest('base64url')
  return `linked_device_run_agent_leases/${id}`
}

type Ref = {
  id: string
  path: string
  collection: (name: string) => { doc: (id: string) => Ref }
}

function ref(...segments: string[]): Ref {
  return {
    id: segments.at(-1)!,
    path: segments.join('/'),
    collection: (name) => ({ doc: (id) => ref(...segments, name, id) }),
  }
}

function storedJob(id: string, agentId: string, overrides: Record<string, unknown> = {}) {
  return {
    jobId: id,
    requestId: `request-${id}`,
    deviceId: 'device-a',
    runtimeTargetId: 'target-a',
    orgId: 'org-a',
    actorUserId: 'actor-a',
    workspaceId: 'workspace-a',
    mappingId: 'map-a',
    relativeFolder: '.',
    credentialVersion: 3,
    status: 'queued',
    attempt: 0,
    encryptedPayload: encryptLinkedRunPayload({ prompt: `prompt ${id}` }, 'device-a', id),
    createdAt: Timestamp.fromMillis(now - 1_000),
    updatedAt: Timestamp.fromMillis(now - 1_000),
    expiresAt: Timestamp.fromMillis(now + 60 * 60 * 1_000),
    queueExpiresAt: Timestamp.fromMillis(now + 45 * 60 * 1_000),
    conversationId: `conversation-${id}`,
    assistantMessageId: `assistant-${id}`,
    agentId,
    ...overrides,
  }
}

function installTransaction(rows: Map<string, Record<string, unknown>>) {
  const updates: Array<{ ref: Ref; value: Record<string, unknown> }> = []
  const sets: Array<{ ref: Ref; value: Record<string, unknown> }> = []
  mockCollection.mockImplementation((name: string) => ({ doc: (id: string) => ref(name, id) }))
  mockRunTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    get: async (document: Ref) => {
      const value = rows.get(document.path)
      return { exists: value !== undefined, data: () => value }
    },
    update: (document: Ref, value: Record<string, unknown>) => { updates.push({ ref: document, value }) },
    set: (document: Ref, value: Record<string, unknown>) => { sets.push({ ref: document, value }) },
  }))
  return { updates, sets }
}

function authorizedRows(jobIds: string[], availableAgentIds: string[]) {
  return new Map<string, Record<string, unknown>>([
    ['linked_device_run_queues/device-a', { pendingJobIds: jobIds }],
    ['linked_devices/device-a', {
      deviceId: 'device-a', ownerUserId: 'owner-a', status: 'active', credentialVersion: 3,
      capabilities: ['workspace.execute'], availableAgentIds,
    }],
    ['linked_device_credentials/device-a', { credentialVersion: 3, revokedAt: null }],
    ['linked_device_grants/org-a_device-a', {
      deviceId: 'device-a', orgId: 'org-a', status: 'active', accessMode: 'selected_users',
      allowedUserIds: ['actor-a'], capabilities: ['workspace.execute'],
    }],
    ['linked_device_workspace_mappings/map-a', {
      mappingId: 'map-a', deviceId: 'device-a', orgId: 'org-a', workspaceId: 'workspace-a', status: 'active',
    }],
    ['orgMembers/org-a_owner-a', { orgId: 'org-a', uid: 'owner-a', status: 'active' }],
    ['orgMembers/org-a_actor-a', { orgId: 'org-a', uid: 'actor-a', status: 'active' }],
  ])
}

describe('linked-computer queue recovery transactions', () => {
  beforeEach(() => {
    process.env.SOCIAL_TOKEN_MASTER_KEY = 'linked-queue-recovery-test-master-key'
    jest.clearAllMocks()
  })

  it('rotates temporarily unavailable agents behind a healthy same-device job without losing their payloads', async () => {
    const blockedIds = Array.from({ length: 12 }, (_, index) => `theo-${index + 1}`)
    const runnableId = 'pip-13'
    const rows = authorizedRows([...blockedIds, runnableId], ['pip'])
    for (const id of blockedIds) rows.set(`linked_device_run_jobs/${id}`, storedJob(id, 'theo'))
    rows.set(`linked_device_run_jobs/${runnableId}`, storedJob(runnableId, 'pip'))
    const { updates, sets } = installTransaction(rows)

    const claimed = await claimOldestLinkedRun({ deviceId: 'device-a', ownerUserId: 'owner-a', credentialVersion: 3 }, { nowMs: now })

    expect(claimed).toEqual(expect.objectContaining({ jobId: runnableId, agentId: 'pip', prompt: `prompt ${runnableId}` }))
    expect(updates.find((entry) => entry.ref.path === `linked_device_run_jobs/${blockedIds[0]}`)).toBeUndefined()
    expect(sets.find((entry) => entry.ref.path === 'linked_device_run_queues/device-a')?.value.pendingJobIds)
      .toEqual([runnableId, ...blockedIds])
  })

  it('skips a saturated profile so another healthy profile can keep working', async () => {
    const pipIds = Array.from({ length: 11 }, (_, index) => `pip-${index + 1}`)
    const theoId = 'theo-1'
    const rows = authorizedRows([...pipIds, theoId], ['pip', 'theo'])
    for (const id of pipIds) rows.set(`linked_device_run_jobs/${id}`, storedJob(id, 'pip'))
    rows.set(`linked_device_run_jobs/${theoId}`, storedJob(theoId, 'theo'))
    const { sets } = installTransaction(rows)

    const claimed = await claimOldestLinkedRun(
      { deviceId: 'device-a', ownerUserId: 'owner-a', credentialVersion: 3 },
      { nowMs: now, saturatedAgentIds: ['pip'] },
    )

    expect(claimed).toEqual(expect.objectContaining({ jobId: theoId, agentId: 'theo' }))
    expect(sets.find((entry) => entry.ref.path === 'linked_device_run_queues/device-a')?.value.pendingJobIds)
      .toEqual([theoId, ...pipIds])
  })

  it('server-enforces ten active Pip leases while allowing Theo to claim the next turn', async () => {
    const activePipIds = Array.from({ length: 10 }, (_, index) => `pip-active-${index + 1}`)
    const blockedPipId = 'pip-11'
    const theoId = 'theo-1'
    const rows = authorizedRows([...activePipIds, blockedPipId, theoId], ['pip', 'theo'])
    for (const id of activePipIds) {
      rows.set(`linked_device_run_jobs/${id}`, storedJob(id, 'pip', {
        status: 'running',
        attempt: 1,
        leaseToken: `lease-${id}`,
        leaseExpiresAt: Timestamp.fromMillis(now + 30_000),
      }))
    }
    rows.set(`linked_device_run_jobs/${blockedPipId}`, storedJob(blockedPipId, 'pip'))
    rows.set(`linked_device_run_jobs/${theoId}`, storedJob(theoId, 'theo'))
    const { sets } = installTransaction(rows)

    const claimed = await claimOldestLinkedRun(
      { deviceId: 'device-a', ownerUserId: 'owner-a', credentialVersion: 3 },
      { nowMs: now },
    )

    expect(claimed).toEqual(expect.objectContaining({ jobId: theoId, agentId: 'theo' }))
    expect(sets.find((entry) => entry.ref.path === 'linked_device_run_queues/device-a')?.value.pendingJobIds)
      .toEqual([theoId, ...activePipIds, blockedPipId])
    const pipLedger = sets.find((entry) => entry.value.agentId === 'pip')?.value
    expect(Object.keys(pipLedger?.leases as Record<string, unknown>)).toEqual(activePipIds)
    expect(pipLedger?.leases).not.toHaveProperty(blockedPipId)
  })

  it('holds only the credential-maintained profile while another profile continues to claim', async () => {
    const theoId = 'theo-maintained'
    const pipId = 'pip-runnable'
    const rows = authorizedRows([theoId, pipId], ['pip', 'theo'])
    rows.set(`linked_device_run_jobs/${theoId}`, storedJob(theoId, 'theo'))
    rows.set(`linked_device_run_jobs/${pipId}`, storedJob(pipId, 'pip'))
    rows.set(agentLeasePath('device-a', 'theo'), {
      deviceId: 'device-a',
      agentId: 'theo',
      leases: {},
      maintenance: {
        agentHostJobId: 'credential-theo',
        leaseTokenHash: 'a'.repeat(64),
        expiresAtMs: now + 30_000,
      },
    })
    const { sets } = installTransaction(rows)

    const claimed = await claimOldestLinkedRun(
      { deviceId: 'device-a', ownerUserId: 'owner-a', credentialVersion: 3 },
      { nowMs: now },
    )

    expect(claimed).toEqual(expect.objectContaining({ jobId: pipId, agentId: 'pip' }))
    expect(sets.find((entry) => entry.ref.path === 'linked_device_run_queues/device-a')?.value.pendingJobIds)
      .toEqual([pipId, theoId])
  })

  it('releases a live Pip ledger slot immediately when the claim transaction expires that run', async () => {
    const id = 'pip-expired-while-leased'
    const rows = authorizedRows([id], ['pip'])
    rows.set(`linked_device_run_jobs/${id}`, storedJob(id, 'pip', {
      status: 'running',
      attempt: 1,
      leaseToken: `lease-${id}`,
      leaseExpiresAt: Timestamp.fromMillis(now + 30_000),
      expiresAt: Timestamp.fromMillis(now - 1),
    }))
    const ledgerPath = agentLeasePath('device-a', 'pip')
    rows.set(ledgerPath, {
      deviceId: 'device-a',
      agentId: 'pip',
      leases: { [id]: now + 30_000 },
    })
    const { sets, updates } = installTransaction(rows)

    await expect(claimOldestLinkedRun(
      { deviceId: 'device-a', ownerUserId: 'owner-a', credentialVersion: 3 },
      { nowMs: now },
    )).resolves.toBeNull()

    expect(updates.find((entry) => entry.ref.path === `linked_device_run_jobs/${id}`)?.value)
      .toEqual(expect.objectContaining({ status: 'expired' }))
    expect(updates.find((entry) => entry.ref.path === ledgerPath)?.value.leases).toEqual({})
  })

  it('replaces the whole lease map when one of several active entries is released', async () => {
    const expiredId = 'pip-expired-entry'
    const liveId = 'pip-live-entry'
    const rows = authorizedRows([expiredId, liveId], ['pip'])
    rows.set(`linked_device_run_jobs/${expiredId}`, storedJob(expiredId, 'pip', {
      status: 'running',
      attempt: 1,
      leaseToken: `lease-${expiredId}`,
      leaseExpiresAt: Timestamp.fromMillis(now + 30_000),
      expiresAt: Timestamp.fromMillis(now - 1),
    }))
    rows.set(`linked_device_run_jobs/${liveId}`, storedJob(liveId, 'pip', {
      status: 'running',
      attempt: 1,
      leaseToken: `lease-${liveId}`,
      leaseExpiresAt: Timestamp.fromMillis(now + 30_000),
    }))
    const ledgerPath = agentLeasePath('device-a', 'pip')
    rows.set(ledgerPath, {
      deviceId: 'device-a',
      agentId: 'pip',
      leases: {
        [expiredId]: now + 30_000,
        [liveId]: now + 30_000,
      },
    })
    const { sets, updates } = installTransaction(rows)

    await expect(claimOldestLinkedRun(
      { deviceId: 'device-a', ownerUserId: 'owner-a', credentialVersion: 3 },
      { nowMs: now },
    )).resolves.toBeNull()

    expect(updates.find((entry) => entry.ref.path === ledgerPath)?.value.leases).toEqual({ [liveId]: now + 30_000 })
    expect(sets.some((entry) => entry.ref.path === ledgerPath)).toBe(false)
  })

  it('requeues an expired running job on the same device when its agent is temporarily unavailable', async () => {
    const id = 'theo-running'
    const rows = authorizedRows([id], ['pip'])
    const running = storedJob(id, 'theo', {
      status: 'running', attempt: 1, leaseToken: 'lease-a', leaseExpiresAt: Timestamp.fromMillis(now - 1),
      localHermesRunId: 'local-hermes-a',
    })
    rows.set(`linked_device_run_jobs/${id}`, running)
    const { updates, sets } = installTransaction(rows)

    await expect(claimOldestLinkedRun({ deviceId: 'device-a', ownerUserId: 'owner-a', credentialVersion: 3 }, { nowMs: now })).resolves.toBeNull()

    const recovery = updates.find((entry) => entry.ref.path === `linked_device_run_jobs/${id}`)?.value
    expect(recovery).toEqual(expect.objectContaining({
      status: 'queued', encryptedPayload: running.encryptedPayload, localHermesRunId: 'local-hermes-a',
    }))
    expect(sets.find((entry) => entry.ref.path === `conversations/conversation-${id}/messages/assistant-${id}`)?.value)
      .toEqual(expect.objectContaining({ status: 'queued', queuedReason: 'runtime_restarting', runId: id }))
  })

  it('reclaims a started job after a current authorized credential has rotated beyond one retained predecessor', async () => {
    const id = 'pip-credential-rebind'
    const rows = authorizedRows([id], ['pip'])
    rows.set('linked_devices/device-a', {
      ...rows.get('linked_devices/device-a')!,
      credentialVersion: 5,
    })
    rows.set('linked_device_credentials/device-a', {
      credentialVersion: 5,
      // The current server record retains only version 4. A legitimate
      // restart during another controlled rotation must not strand a v3 run
      // when the same signed device, grant, mapping, and memberships persist.
      previousCredentialVersion: 4,
      revokedAt: null,
    })
    rows.set(`linked_device_run_jobs/${id}`, storedJob(id, 'pip', {
      credentialVersion: 3,
      status: 'running',
      attempt: 1,
      leaseToken: 'lease-credential-rebind',
      leaseExpiresAt: Timestamp.fromMillis(now - 1),
      localHermesRunId: 'local-hermes-resume-id',
    }))
    const { updates, sets } = installTransaction(rows)

    const claimed = await claimOldestLinkedRun(
      { deviceId: 'device-a', ownerUserId: 'owner-a', credentialVersion: 5 },
      { nowMs: now },
    )

    expect(claimed).toEqual(expect.objectContaining({
      jobId: id,
      localHermesRunId: 'local-hermes-resume-id',
    }))
    expect(updates.find((entry) => entry.ref.path === `linked_device_run_jobs/${id}`)?.value)
      .toEqual(expect.objectContaining({ credentialVersion: 5, status: 'claimed' }))
    expect(sets.find((entry) => entry.ref.path === `conversations/conversation-${id}/messages/assistant-${id}`)?.value)
      .toEqual(expect.objectContaining({ linkedDeviceCredentialVersion: 5 }))
  })
})
