import { Timestamp } from 'firebase-admin/firestore'
import { createHash } from 'node:crypto'

const mockCollection = jest.fn()
const mockRunTransaction = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection, runTransaction: mockRunTransaction },
}))

import {
  claimOldestAgentHostJob,
  completeAgentHostJob,
} from '@/lib/linked-computers/agent-job-store'
import { linkedRunAgentLeaseDocumentId } from '@/lib/linked-computers/run-queue-store'

const now = Date.parse('2026-08-02T12:00:00.000Z')

type Ref = { id: string; path: string }

function ref(...segments: string[]): Ref {
  return { id: segments.at(-1)!, path: segments.join('/') }
}

function installTransaction(rows: Map<string, Record<string, unknown>>) {
  const updates: Array<{ ref: Ref; value: Record<string, unknown> }> = []
  const sets: Array<{ ref: Ref; value: Record<string, unknown>; options?: unknown }> = []
  mockCollection.mockImplementation((name: string) => ({ doc: (id: string) => ref(name, id) }))
  mockRunTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    get: async (document: Ref) => {
      const value = rows.get(document.path)
      return { id: document.id, exists: value !== undefined, data: () => value }
    },
    update: (document: Ref, value: Record<string, unknown>) => { updates.push({ ref: document, value }) },
    set: (document: Ref, value: Record<string, unknown>, options?: unknown) => { sets.push({ ref: document, value, options }) },
  }))
  return { sets, updates }
}

function agentJob(id: string, agentId: string, overrides: Record<string, unknown> = {}) {
  return {
    jobId: id,
    idempotencyKey: `key-${id}`,
    requestFingerprint: `fingerprint-${id}`,
    deviceId: 'device-a',
    orgId: 'org-a',
    actorUserId: 'owner-a',
    credentialVersion: 3,
    kind: 'sync-credential',
    status: 'queued',
    attempt: 0,
    payload: {
      agentId,
      policyVersion: null,
      keepInSync: false,
      runtimeSkills: [],
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: agentId === 'pip' ? 8755 : 8756,
      protocolVersion: 3,
    },
    createdAt: Timestamp.fromMillis(now - 1_000),
    updatedAt: Timestamp.fromMillis(now - 1_000),
    expiresAt: Timestamp.fromMillis(now + 60 * 60 * 1_000),
    ...overrides,
  }
}

function activeRun(id: string, agentId: string) {
  return {
    jobId: id,
    agentId,
    status: 'running',
    leaseExpiresAt: Timestamp.fromMillis(now + 30_000),
  }
}

describe('linked-computer credential maintenance lease', () => {
  beforeEach(() => jest.clearAllMocks())

  it('defers a busy profile but claims an idle profile without exposing a restart race', async () => {
    const theoJobId = 'credential-theo'
    const pipJobId = 'credential-pip'
    const rows = new Map<string, Record<string, unknown>>([
      ['linked_devices/device-a', { deviceId: 'device-a', status: 'active', credentialVersion: 3 }],
      ['linked_device_agent_queues/device-a', { pendingJobIds: [theoJobId, pipJobId] }],
      [`linked_device_agent_jobs/${theoJobId}`, agentJob(theoJobId, 'theo')],
      [`linked_device_agent_jobs/${pipJobId}`, agentJob(pipJobId, 'pip')],
      ['linked_device_run_queues/device-a', { pendingJobIds: ['run-theo'] }],
      ['linked_device_run_jobs/run-theo', activeRun('run-theo', 'theo')],
      [`linked_device_run_agent_leases/${linkedRunAgentLeaseDocumentId('device-a', 'theo')}`, {
        deviceId: 'device-a', agentId: 'theo', leases: { 'run-theo': now + 30_000 },
      }],
    ])
    const { sets } = installTransaction(rows)

    const claimed = await claimOldestAgentHostJob(
      { deviceId: 'device-a', ownerUserId: 'owner-a', credentialVersion: 3 },
      { nowMs: now },
    )

    expect(claimed).toEqual(expect.objectContaining({ jobId: pipJobId, agentId: 'pip' }))
    expect(sets.find((entry) => entry.ref.path === 'linked_device_agent_queues/device-a')?.value.pendingJobIds)
      .toEqual([pipJobId, theoJobId])
    const maintenance = sets.find((entry) => entry.ref.path === `linked_device_run_agent_leases/${linkedRunAgentLeaseDocumentId('device-a', 'pip')}`)?.value.maintenance as Record<string, unknown>
    expect(maintenance).toEqual(expect.objectContaining({ agentHostJobId: pipJobId, expiresAtMs: now + 5 * 60_000 }))
    expect(maintenance.leaseTokenHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('fails safe when a pre-ledger running job exists for the target profile', async () => {
    const jobId = 'credential-theo'
    const rows = new Map<string, Record<string, unknown>>([
      ['linked_devices/device-a', { deviceId: 'device-a', status: 'active', credentialVersion: 3 }],
      ['linked_device_agent_queues/device-a', { pendingJobIds: [jobId] }],
      [`linked_device_agent_jobs/${jobId}`, agentJob(jobId, 'theo')],
      ['linked_device_run_queues/device-a', { pendingJobIds: ['legacy-theo'] }],
      ['linked_device_run_jobs/legacy-theo', activeRun('legacy-theo', 'theo')],
    ])
    const { sets } = installTransaction(rows)

    await expect(claimOldestAgentHostJob(
      { deviceId: 'device-a', ownerUserId: 'owner-a', credentialVersion: 3 },
      { nowMs: now },
    )).resolves.toBeNull()

    expect(sets.some((entry) => entry.ref.path.startsWith('linked_device_run_agent_leases/'))).toBe(false)
  })

  it('finds a live pre-ledger run behind completed queue rows before permitting maintenance', async () => {
    const jobId = 'credential-theo'
    const completedIds = Array.from({ length: 64 }, (_, index) => `completed-${index + 1}`)
    const liveId = 'legacy-theo-after-completed'
    const rows = new Map<string, Record<string, unknown>>([
      ['linked_devices/device-a', { deviceId: 'device-a', status: 'active', credentialVersion: 3 }],
      ['linked_device_agent_queues/device-a', { pendingJobIds: [jobId] }],
      [`linked_device_agent_jobs/${jobId}`, agentJob(jobId, 'theo')],
      ['linked_device_run_queues/device-a', { pendingJobIds: [...completedIds, liveId] }],
      ...completedIds.map((id) => [`linked_device_run_jobs/${id}`, { jobId: id, agentId: 'pip', status: 'completed' }] as const),
      [`linked_device_run_jobs/${liveId}`, activeRun(liveId, 'theo')],
    ])
    const { sets } = installTransaction(rows)

    await expect(claimOldestAgentHostJob(
      { deviceId: 'device-a', ownerUserId: 'owner-a', credentialVersion: 3 },
      { nowMs: now },
    )).resolves.toBeNull()

    expect(sets.some((entry) => entry.ref.path.startsWith('linked_device_run_agent_leases/'))).toBe(false)
  })

  it('clears only the matching maintenance lease when that credential job completes', async () => {
    const jobId = 'credential-pip'
    const leaseToken = 'lease-token-current'
    const rows = new Map<string, Record<string, unknown>>([
      ['linked_device_agent_queues/device-a', { pendingJobIds: [jobId] }],
      [`linked_device_agent_jobs/${jobId}`, agentJob(jobId, 'pip', {
        status: 'claimed',
        attempt: 1,
        leaseToken,
        leaseExpiresAt: Timestamp.fromMillis(now + 60_000),
        claimedAt: Timestamp.fromMillis(now - 1_000),
      })],
      [`linked_device_run_agent_leases/${linkedRunAgentLeaseDocumentId('device-a', 'pip')}`, {
        deviceId: 'device-a',
        agentId: 'pip',
        leases: {},
        maintenance: {
          agentHostJobId: jobId,
          leaseTokenHash: createHash('sha256').update(`linked-run-maintenance:v1\n${leaseToken}`).digest('hex'),
          expiresAtMs: now + 60_000,
        },
      }],
    ])
    const { sets } = installTransaction(rows)

    await completeAgentHostJob({
      deviceId: 'device-a',
      jobId,
      leaseToken,
      credentialVersion: 3,
      ok: true,
    }, { nowMs: now })

    expect(sets.find((entry) => entry.ref.path === `linked_device_run_agent_leases/${linkedRunAgentLeaseDocumentId('device-a', 'pip')}`)?.value)
      .toEqual(expect.objectContaining({ maintenance: expect.anything() }))
  })

  it('cannot clear a newer maintenance lease when an older credential job completes', async () => {
    const jobId = 'credential-pip-old'
    const leaseToken = 'lease-token-old'
    const rows = new Map<string, Record<string, unknown>>([
      ['linked_device_agent_queues/device-a', { pendingJobIds: [jobId] }],
      [`linked_device_agent_jobs/${jobId}`, agentJob(jobId, 'pip', {
        status: 'claimed',
        attempt: 1,
        leaseToken,
        leaseExpiresAt: Timestamp.fromMillis(now + 60_000),
        claimedAt: Timestamp.fromMillis(now - 1_000),
      })],
      [`linked_device_run_agent_leases/${linkedRunAgentLeaseDocumentId('device-a', 'pip')}`, {
        deviceId: 'device-a',
        agentId: 'pip',
        leases: {},
        maintenance: {
          agentHostJobId: 'credential-pip-new',
          leaseTokenHash: createHash('sha256').update('linked-run-maintenance:v1\nlease-token-new').digest('hex'),
          expiresAtMs: now + 60_000,
        },
      }],
    ])
    const { sets } = installTransaction(rows)

    await completeAgentHostJob({
      deviceId: 'device-a',
      jobId,
      leaseToken,
      credentialVersion: 3,
      ok: true,
    }, { nowMs: now })

    expect(sets.some((entry) => entry.ref.path === `linked_device_run_agent_leases/${linkedRunAgentLeaseDocumentId('device-a', 'pip')}`)).toBe(false)
  })
})
