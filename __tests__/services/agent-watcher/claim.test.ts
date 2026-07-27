jest.mock('../../../services/agent-watcher/src/firestore', () => ({
  db: {
    collection: jest.fn(),
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

const dbMock = db as unknown as { collection: jest.Mock; collectionGroup: jest.Mock; batch: jest.Mock; runTransaction: jest.Mock }

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

  it('does not claim nested queued work when its parent project discovery is incomplete, even in YOLO mode', async () => {
    const update = jest.fn()
    dbMock.runTransaction.mockImplementation(async (work) => work({
      get: jest.fn()
        .mockResolvedValueOnce({
          exists: true,
          data: () => ({
            assigneeAgentId: 'theo',
            agentStatus: 'pending',
            columnId: 'todo',
            projectId: 'wrong-project-id',
            yolo: true,
          }),
        })
        .mockResolvedValueOnce({ exists: true, data: () => ({ planningDiscovery: { enforced: true, status: 'interviewing' } }) }),
      update,
    }))

    await expect(claimTask(taskRef as never, 'theo')).resolves.toBe(false)
    expect(dbMock.collection).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('does not claim standalone root work when its project discovery is incomplete', async () => {
    const update = jest.fn()
    const standaloneProjectRef = { path: 'projects/project-standalone' }
    const rootTaskRef = { path: 'tasks/task-root', parent: { parent: null, doc: jest.fn() } }
    dbMock.collection.mockReturnValue({ doc: jest.fn(() => standaloneProjectRef) })
    dbMock.runTransaction.mockImplementation(async (work) => work({
      get: jest.fn()
        .mockResolvedValueOnce({ exists: true, data: () => ({ assigneeAgentId: 'theo', agentStatus: 'pending', columnId: 'todo', projectId: 'project-standalone' }) })
        .mockResolvedValueOnce({ exists: true, data: () => ({ planningDiscovery: { enforced: true, status: 'interviewing' } }) }),
      update,
    }))

    await expect(claimTask(rootTaskRef as never, 'theo')).resolves.toBe(false)
    expect(dbMock.collection).toHaveBeenCalledWith('projects')
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

describe('agent watcher transactional approval and dependency claim gates', () => {
  const projectRef = { path: 'projects/project-1' }
  const dependencyRef = { path: 'projects/project-1/tasks/gate-1' }
  const taskRef = {
    path: 'projects/project-1/tasks/task-1',
    parent: { parent: projectRef, doc: jest.fn(() => dependencyRef) },
  }

  beforeEach(() => jest.clearAllMocks())

  it('reads an approvalGateTaskId once when it is also listed in dependsOn and requires explicit approval', async () => {
    const update = jest.fn()
    const get = jest.fn()
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          assigneeAgentId: 'theo',
          agentStatus: 'pending',
          columnId: 'todo',
          dependsOn: ['gate-1'],
          approvalGateTaskId: 'gate-1',
        }),
      })
      .mockResolvedValueOnce({ exists: true, data: () => ({ planningDiscovery: { enforced: false } }) })
      .mockResolvedValueOnce({ exists: true, data: () => ({ columnId: 'done', agentStatus: 'done', approvalStatus: 'pending' }) })
    dbMock.runTransaction.mockImplementation(async (work) => work({ get, update }))

    await expect(claimTask(taskRef as never, 'theo')).resolves.toBe(false)
    expect(taskRef.parent.doc).toHaveBeenCalledTimes(1)
    expect(taskRef.parent.doc).toHaveBeenCalledWith('gate-1')
    expect(get).toHaveBeenCalledTimes(3)
    expect(update).not.toHaveBeenCalled()
  })

  it('does not claim work whose completed approval-gate dependency is unapproved', async () => {
    const update = jest.fn()
    dbMock.runTransaction.mockImplementation(async (work) => work({
      get: jest.fn()
        .mockResolvedValueOnce({
          exists: true,
          data: () => ({ assigneeAgentId: 'theo', agentStatus: 'pending', columnId: 'todo', dependsOn: ['gate-1'] }),
        })
        .mockResolvedValueOnce({ exists: true, data: () => ({ planningDiscovery: { enforced: false } }) })
        .mockResolvedValueOnce({
          exists: true,
          data: () => ({ columnId: 'done', agentStatus: 'done', approvalGate: 'production-deploy', approvalStatus: 'pending' }),
        }),
      update,
    }))

    await expect(claimTask(taskRef as never, 'theo')).resolves.toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  it('does not claim work until a reviewed dependency has reviewer approval', async () => {
    const update = jest.fn()
    dbMock.runTransaction.mockImplementation(async (work) => work({
      get: jest.fn()
        .mockResolvedValueOnce({
          exists: true,
          data: () => ({ assigneeAgentId: 'theo', agentStatus: 'pending', columnId: 'todo', dependsOn: ['gate-1'] }),
        })
        .mockResolvedValueOnce({ exists: true, data: () => ({ planningDiscovery: { enforced: false } }) })
        .mockResolvedValueOnce({
          exists: true,
          data: () => ({ columnId: 'review', agentStatus: 'done', reviewerAgentId: 'qa-release', reviewStatus: 'pending' }),
        }),
      update,
    }))

    await expect(claimTask(taskRef as never, 'theo')).resolves.toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  it('does not let YOLO mode bypass a pending string approval gate', async () => {
    const update = jest.fn()
    const get = jest.fn().mockResolvedValueOnce({
      exists: true,
      data: () => ({
        assigneeAgentId: 'theo',
        agentStatus: 'pending',
        columnId: 'todo',
        approvalGate: 'production-deploy',
        approvalStatus: 'pending',
        yolo: true,
      }),
    })
    dbMock.runTransaction.mockImplementation(async (work) => work({ get, update }))

    await expect(claimTask(taskRef as never, 'theo')).resolves.toBe(false)
    expect(get).toHaveBeenCalledTimes(1)
    expect(update).not.toHaveBeenCalled()
  })
})
