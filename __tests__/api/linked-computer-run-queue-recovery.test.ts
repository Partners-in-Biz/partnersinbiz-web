import { Timestamp } from 'firebase-admin/firestore'

const mockCollection = jest.fn()
const mockRunTransaction = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection, runTransaction: mockRunTransaction },
}))

import { claimOldestLinkedRun } from '@/lib/linked-computers/run-queue-store'
import { encryptLinkedRunPayload } from '@/lib/linked-computers/run-queue'

const now = Date.parse('2026-08-01T19:00:00.000Z')

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
})
