jest.mock('../../../services/agent-watcher/src/firestore', () => ({
  db: {
    collectionGroup: jest.fn(),
    batch: jest.fn(),
    runTransaction: jest.fn(),
  },
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIME'),
    delete: jest.fn(() => 'DELETE_FIELD'),
  },
  Timestamp: {
    fromMillis: jest.fn((millis: number) => ({ millis })),
  },
}))

jest.mock('../../../services/agent-watcher/src/task-updates', () => ({
  agentStatusUpdate: (status: string) => ({ agentStatus: status }),
}))

jest.mock('../../../services/agent-watcher/src/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

import { db } from '../../../services/agent-watcher/src/firestore'
import { claimTask, sweepStaleTasks } from '../../../services/agent-watcher/src/claim'

const dbMock = db as unknown as { collectionGroup: jest.Mock; batch: jest.Mock; runTransaction: jest.Mock }

describe('agent watcher stale task sweeper', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('reclaims working cards that have no heartbeat so unblocked cards can be picked up again', async () => {
    const updates: Array<{ ref: unknown; value: Record<string, unknown> }> = []
    const commit = jest.fn(async () => undefined)
    dbMock.batch.mockReturnValue({
      update: jest.fn((ref, value) => updates.push({ ref, value })),
      commit,
    })

    const missingHeartbeatRef = { path: 'projects/project-1/tasks/task-missing-heartbeat' }
    const nullHeartbeatRef = { path: 'projects/project-1/tasks/task-null-heartbeat' }
    const healthyRef = { path: 'projects/project-1/tasks/task-healthy' }
    const healthyHeartbeat = { toMillis: () => Date.now() }

    const query = {
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn(async () => ({
        empty: false,
        docs: [
          { ref: missingHeartbeatRef, data: () => ({ agentStatus: 'in-progress' }) },
          { ref: nullHeartbeatRef, data: () => ({ agentStatus: 'picked-up', agentHeartbeatAt: null }) },
          { ref: healthyRef, data: () => ({ agentStatus: 'in-progress', agentHeartbeatAt: healthyHeartbeat }) },
        ],
      })),
    }
    dbMock.collectionGroup.mockReturnValue(query)

    const reclaimed = await sweepStaleTasks()

    expect(query.where).toHaveBeenCalledWith('agentStatus', 'in', ['picked-up', 'in-progress'])
    expect(reclaimed).toBe(2)
    expect(updates).toEqual([
      {
        ref: missingHeartbeatRef,
        value: expect.objectContaining({
          agentStatus: 'pending',
          agentHeartbeatAt: 'DELETE_FIELD',
          updatedAt: 'SERVER_TIME',
        }),
      },
      {
        ref: nullHeartbeatRef,
        value: expect.objectContaining({
          agentStatus: 'pending',
          agentHeartbeatAt: 'DELETE_FIELD',
          updatedAt: 'SERVER_TIME',
        }),
      },
    ])
    expect(commit).toHaveBeenCalledTimes(1)
  })
})

describe('agent watcher planning gate claim', () => {
  const projectRef = { path: 'projects/project-1' }
  const taskRef = { path: 'projects/project-1/tasks/task-1', parent: { parent: projectRef, doc: jest.fn() } }

  beforeEach(() => jest.clearAllMocks())

  it('does not claim queued work when project discovery is incomplete', async () => {
    const update = jest.fn()
    dbMock.runTransaction.mockImplementation(async (work) => work({
      get: jest.fn()
        .mockResolvedValueOnce({ exists: true, data: () => ({ assigneeAgentId: 'theo', agentStatus: 'pending', columnId: 'todo' }) })
        .mockResolvedValueOnce({ exists: true, data: () => ({ planningDiscovery: { enforced: true, status: 'interviewing' } }) }),
      update,
    }))

    await expect(claimTask(taskRef as never, 'theo')).resolves.toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  it('claims queued work after the exact brief is confirmed', async () => {
    const update = jest.fn()
    dbMock.runTransaction.mockImplementation(async (work) => work({
      get: jest.fn()
        .mockResolvedValueOnce({ exists: true, data: () => ({ assigneeAgentId: 'theo', agentStatus: 'pending', columnId: 'todo' }) })
        .mockResolvedValueOnce({ exists: true, data: () => ({ planningDiscovery: { enforced: true, status: 'confirmed', digest: 'digest', brief: { outcome: 'Ship' } } }) }),
      update,
    }))

    await expect(claimTask(taskRef as never, 'theo')).resolves.toBe(true)
    expect(update).toHaveBeenCalledWith(taskRef, expect.objectContaining({ agentStatus: 'picked-up' }))
  })
})
