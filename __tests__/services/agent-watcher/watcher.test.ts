jest.mock('../../../services/agent-watcher/src/config', () => ({
  AGENT_IDS: ['pip', 'theo', 'maya', 'sage', 'nora', 'ads', 'qa-release', 'support', 'data', 'docs', 'seo'],
  getAgentConfig: jest.fn(),
  loadEnabledAgentIds: jest.fn(async () => ['pip', 'theo', 'maya', 'sage', 'nora', 'ads', 'qa-release', 'support', 'data', 'docs', 'seo']),
}))

jest.mock('../../../services/agent-watcher/src/claim', () => ({
  claimTask: jest.fn(),
  claimReviewTask: jest.fn(),
  startHeartbeat: jest.fn(),
}))

jest.mock('../../../services/agent-watcher/src/hermes', () => ({
  runAndPoll: jest.fn(),
}))

jest.mock('../../../services/agent-watcher/src/firestore', () => ({
  db: {},
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIME'),
    delete: jest.fn(() => 'DELETE_FIELD'),
  },
}))

jest.mock('../../../services/agent-watcher/src/task-updates', () => ({
  agentStatusUpdate: (status: string) => ({
    agentStatus: status,
    columnId: status === 'pending'
      ? 'todo'
      : status === 'done'
        ? 'review'
        : status === 'blocked' || status === 'awaiting-input'
          ? 'blocked'
          : 'in_progress',
    ...(status === 'done' ? { reviewStatus: 'pending' } : {}),
  }),
}))

jest.mock('../../../services/agent-watcher/src/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

import { getAgentConfig } from '../../../services/agent-watcher/src/config'
import { claimTask, startHeartbeat } from '../../../services/agent-watcher/src/claim'
import { db } from '../../../services/agent-watcher/src/firestore'
import { runAndPoll } from '../../../services/agent-watcher/src/hermes'
import { dispatchTask, startWatcher, sweepReadyPendingTasks } from '../../../services/agent-watcher/src/watcher'

const getAgentConfigMock = getAgentConfig as jest.Mock
const claimTaskMock = claimTask as jest.Mock
const startHeartbeatMock = startHeartbeat as jest.Mock
const runAndPollMock = runAndPoll as jest.Mock
const dbMock = db as unknown as { collectionGroup?: jest.Mock }

type FilteringQueryDoc = { ref: Record<string, unknown>; data: () => Record<string, unknown> }
type FilteringQuery = {
  wheres: Array<[string, string, unknown]>
  where: jest.Mock
  limit: jest.Mock
  get: jest.Mock
}

function makeTaskRef(comments: Array<Record<string, unknown>> = []) {
  const update = jest.fn(async () => undefined)
  return {
    id: 'task-1',
    path: 'orgs/org-1/projects/project-1/tasks/task-1',
    parent: {
      doc: jest.fn(),
    },
    collection: jest.fn(() => ({
      orderBy: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: jest.fn(async () => ({
            docs: comments.map(comment => ({ data: () => comment })),
          })),
        })),
      })),
    })),
    update,
  }
}

function makeFilteringCollectionQuery(docs: FilteringQueryDoc[]): FilteringQuery {
  const query: FilteringQuery = {
    wheres: [],
    where: jest.fn(function (this: FilteringQuery, field: string, op: string, value: unknown) {
      this.wheres.push([field, op, value])
      return this
    }),
    limit: jest.fn(function (this: FilteringQuery) { return this }),
    get: jest.fn(async function (this: FilteringQuery) {
      const wheres = [...this.wheres]
      this.wheres = []
      return {
        docs: docs.filter(doc => wheres.every(([field, op, value]) => {
          const actual = doc.data()[field]
          if (op === '==') return actual === value
          if (op === 'in' && Array.isArray(value)) return value.includes(actual)
          return true
        })),
      }
    }),
  }
  return query
}

describe('agent watcher dispatchTask', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAgentConfigMock.mockResolvedValue({ enabled: true, baseUrl: 'https://hermes.local', apiKey: 'secret' })
    claimTaskMock.mockResolvedValue(true)
    startHeartbeatMock.mockReturnValue(jest.fn())
    runAndPollMock.mockImplementation(async (_cfg, _input, onRunCreated) => {
      await onRunCreated('run-live-1')
      return { runId: 'run-live-1', output: 'done summary', error: null }
    })
  })

  it('ignores pending tasks that are not eligible for dispatch', async () => {
    const taskRef = makeTaskRef()

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      requiresApproval: true,
      approvalStatus: 'pending',
    })

    expect(claimTaskMock).not.toHaveBeenCalled()
    expect(runAndPollMock).not.toHaveBeenCalled()
    expect(taskRef.update).not.toHaveBeenCalled()
  })

  it('writes the live run id, heartbeats while running, and marks successful tasks done with the run id', async () => {
    const taskRef = makeTaskRef()
    const stopHeartbeat = jest.fn()
    startHeartbeatMock.mockReturnValue(stopHeartbeat)

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      title: 'Ship watcher hardening',
    })

    expect(claimTaskMock).toHaveBeenCalledWith(taskRef, 'theo')
    expect(startHeartbeatMock).toHaveBeenCalledWith(taskRef)
    expect(stopHeartbeat).toHaveBeenCalledTimes(1)
    expect(taskRef.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      agentStatus: 'in-progress',
      agentHeartbeatAt: 'SERVER_TIME',
    }))
    expect(taskRef.update).toHaveBeenCalledWith(expect.objectContaining({
      agentConversationId: 'run-live-1',
    }))
    expect(taskRef.update).toHaveBeenLastCalledWith(expect.objectContaining({
      agentStatus: 'done',
      agentConversationId: 'run-live-1',
      agentOutput: expect.objectContaining({ summary: 'done summary' }),
    }))
  })

  it('includes recent task comments in the dispatched prompt', async () => {
    const taskRef = makeTaskRef([
      {
        text: 'Please fix the mobile spacing and keep the hero compact.',
        userName: 'Peet',
        createdAt: { _seconds: 1779421000 },
      },
    ])

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      agentInput: { spec: 'Original implementation task' },
    })

    expect(runAndPollMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        spec: expect.stringContaining('Recent task comments / revision notes:'),
      }),
      expect.any(Function),
    )
    expect(runAndPollMock.mock.calls[0][1].spec).toContain('Please fix the mobile spacing')
  })

  it('passes provenance, risk, capability, and reviewer context into Hermes dispatch', async () => {
    const taskRef = makeTaskRef()

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      projectId: 'project-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      reviewerAgentId: 'qa-release',
      agentInput: {
        spec: 'Implement approved spec',
        context: {
          sourceDocumentId: 'doc-1',
          sourceSpecVersion: 'v3',
          approvalGateTaskId: 'gate-1',
          sourceResearchItemId: 'research-1',
        },
      },
      riskLevel: 'critical',
      requiredCapability: 'deploy',
      requestedByAgentId: 'pip',
      expectedArtifacts: ['pull_request', 'preview_url', 'test_report'],
    })

    expect(runAndPollMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        context: expect.objectContaining({
          projectId: 'project-1',
          reviewerAgentId: 'qa-release',
          riskLevel: 'critical',
          requiredCapability: 'deploy',
          requestedByAgentId: 'pip',
          expectedArtifacts: ['pull_request', 'preview_url', 'test_report'],
          sourceDocumentId: 'doc-1',
          sourceSpecVersion: 'v3',
          approvalGateTaskId: 'gate-1',
          sourceResearchItemId: 'research-1',
        }),
      }),
      expect.any(Function),
    )
  })

  it('marks failed Hermes runs blocked while preserving the live run id and stopping the heartbeat', async () => {
    const taskRef = makeTaskRef()
    const stopHeartbeat = jest.fn()
    startHeartbeatMock.mockReturnValue(stopHeartbeat)
    runAndPollMock.mockImplementation(async (_cfg, _input, onRunCreated) => {
      await onRunCreated('run-failed-1')
      return { runId: 'run-failed-1', output: null, error: 'gateway failed' }
    })

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      title: 'Ship watcher hardening',
    })

    expect(stopHeartbeat).toHaveBeenCalledTimes(1)
    expect(taskRef.update).toHaveBeenLastCalledWith(expect.objectContaining({
      agentStatus: 'blocked',
      agentConversationId: 'run-failed-1',
      agentOutput: expect.objectContaining({ summary: 'Watcher error: gateway failed' }),
    }))
  })

  it('retries a pending task that arrives while the agent is at concurrency capacity', async () => {
    const running: Array<(value: { runId: string; output: string; error: null }) => void> = []
    runAndPollMock.mockImplementation(async (_cfg, _input, onRunCreated) => {
      const runId = `run-live-${running.length + 1}`
      await onRunCreated(runId)
      return new Promise(resolve => running.push(resolve))
    })

    const taskData = {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      title: 'Ship watcher hardening',
    }
    const activeRefs = Array.from({ length: 5 }, (_value, index) => ({
      ...makeTaskRef(),
      id: `active-${index}`,
      path: `projects/project-1/tasks/active-${index}`,
    }))
    const queuedRef = {
      ...makeTaskRef(),
      id: 'queued-1',
      path: 'projects/project-1/tasks/queued-1',
    }

    const flush = () => new Promise(resolve => setImmediate(resolve))
    const activeDispatches = activeRefs.map(ref => dispatchTask(ref as never, taskData))
    await flush()
    await flush()
    expect(runAndPollMock).toHaveBeenCalledTimes(5)

    await dispatchTask(queuedRef as never, taskData)
    expect(claimTaskMock).not.toHaveBeenCalledWith(queuedRef, 'theo')

    running[0]({ runId: 'run-live-1', output: 'done summary', error: null })
    await activeDispatches[0]
    await Promise.resolve()
    await Promise.resolve()

    expect(claimTaskMock).toHaveBeenCalledWith(queuedRef, 'theo')
    await flush()
    expect(runAndPollMock).toHaveBeenCalledTimes(6)

    running.slice(1).forEach((resolve, index) => resolve({ runId: `run-live-${index + 2}`, output: 'done summary', error: null }))
    running[5]({ runId: 'run-live-6', output: 'done summary', error: null })
    await Promise.all(activeDispatches.slice(1))
  })
  it('releases due scheduled backlog tasks into todo with an audit comment before pickup', async () => {
    const taskRef = {
      ...makeTaskRef(),
      id: 'scheduled-1',
      path: 'projects/project-1/tasks/scheduled-1',
      collection: jest.fn(() => ({
        add: jest.fn(async () => undefined),
      })),
    }
    const taskData = {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'backlog',
      title: 'Scheduled task',
      agentReleaseStatus: 'scheduled',
      agentReleaseAt: '2026-05-26T09:30:00.000Z',
    }
    const query = makeFilteringCollectionQuery([{ ref: taskRef, data: () => taskData }])
    dbMock.collectionGroup = jest.fn(() => query)

    await sweepReadyPendingTasks(Date.parse('2026-05-26T09:31:00.000Z'))
    await new Promise(resolve => setImmediate(resolve))

    expect(query.where).toHaveBeenCalledWith('agentReleaseStatus', '==', 'scheduled')
    expect(taskRef.update).toHaveBeenCalledWith(expect.objectContaining({
      columnId: 'todo',
      agentReleaseStatus: 'released',
      agentReleasedAt: 'SERVER_TIME',
    }))
    expect(taskRef.collection).toHaveBeenCalledWith('comments')
  })

  it('periodically sweeps pending todo tasks so missed dependency transitions are retried', async () => {
    const dependencySnap = { exists: true, data: () => ({ agentStatus: 'done', columnId: 'review' }) }
    const taskRef = {
      ...makeTaskRef(),
      id: 'follow-up-1',
      path: 'projects/project-1/tasks/follow-up-1',
      parent: {
        doc: jest.fn(() => ({ get: jest.fn(async () => dependencySnap) })),
      },
    }
    const taskData = {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      title: 'Follow-up task',
      dependsOn: ['dependency-1'],
    }
    const query = makeFilteringCollectionQuery([{ ref: taskRef, data: () => taskData }])
    dbMock.collectionGroup = jest.fn(() => query)

    await sweepReadyPendingTasks()
    await new Promise(resolve => setImmediate(resolve))

    expect(dbMock.collectionGroup).toHaveBeenCalledWith('tasks')
    expect(query.where).toHaveBeenCalledWith('assigneeAgentId', 'in', expect.arrayContaining(['theo']))
    expect(query.where).toHaveBeenCalledWith('agentStatus', '==', 'pending')
    expect(query.where).toHaveBeenCalledWith('columnId', '==', 'todo')
    expect(claimTaskMock).toHaveBeenCalledWith(taskRef, 'theo')
    expect(runAndPollMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ taskId: 'follow-up-1' }),
      expect.any(Function),
    )
  })

  it('releases blocked tasks when dependencies clear and immediately retries pickup', async () => {
    const dependencySnap = { exists: true, data: () => ({ agentStatus: 'done', columnId: 'review' }) }
    const commentCollection = {
      add: jest.fn(async () => undefined),
      orderBy: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: jest.fn(async () => ({ docs: [] })),
        })),
      })),
    }
    const taskRef = {
      ...makeTaskRef(),
      id: 'blocked-follow-up-1',
      path: 'projects/project-1/tasks/blocked-follow-up-1',
      parent: {
        doc: jest.fn(() => ({ get: jest.fn(async () => dependencySnap) })),
      },
      collection: jest.fn(() => commentCollection),
    }
    const taskData = {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'awaiting-input',
      columnId: 'blocked',
      title: 'Blocked follow-up task',
      dependsOn: ['dependency-1'],
    }
    const query = makeFilteringCollectionQuery([{ ref: taskRef, data: () => taskData }])
    dbMock.collectionGroup = jest.fn(() => query)

    await sweepReadyPendingTasks()
    await new Promise(resolve => setImmediate(resolve))

    expect(query.where).toHaveBeenCalledWith('agentStatus', '==', 'awaiting-input')
    expect(taskRef.update).toHaveBeenCalledWith(expect.objectContaining({
      agentStatus: 'pending',
      columnId: 'todo',
      agentHeartbeatAt: 'DELETE_FIELD',
    }))
    expect(commentCollection.add).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'system:agent-watcher',
      text: expect.stringContaining('Dependency gate cleared'),
    }))
    expect(claimTaskMock).toHaveBeenCalledWith(taskRef, 'theo')
    expect(runAndPollMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ taskId: 'blocked-follow-up-1' }),
      expect.any(Function),
    )
  })

  it('does not auto-release blocked error cards just because their dependencies are done', async () => {
    const dependencySnap = { exists: true, data: () => ({ agentStatus: 'done', columnId: 'review' }) }
    const taskRef = {
      ...makeTaskRef(),
      id: 'error-blocked-1',
      path: 'projects/project-1/tasks/error-blocked-1',
      parent: {
        doc: jest.fn(() => ({ get: jest.fn(async () => dependencySnap) })),
      },
    }
    const taskData = {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'blocked',
      columnId: 'blocked',
      title: 'Errored task',
      dependsOn: ['dependency-1'],
      agentOutput: { summary: 'Watcher error: gateway failed' },
    }
    const query = makeFilteringCollectionQuery([{ ref: taskRef, data: () => taskData }])
    dbMock.collectionGroup = jest.fn(() => query)

    await sweepReadyPendingTasks()
    await new Promise(resolve => setImmediate(resolve))

    expect(taskRef.update).not.toHaveBeenCalledWith(expect.objectContaining({
      agentStatus: 'pending',
      columnId: 'todo',
    }))
    expect(claimTaskMock).not.toHaveBeenCalledWith(taskRef, 'theo')
  })
})

describe('agent watcher dependency retry strategy', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('does not subscribe to broad done-task queries because periodic sweeps retry dependents', async () => {
    const queries: Array<{ wheres: Array<[string, string, unknown]>; unsubscribe: jest.Mock }> = []
    dbMock.collectionGroup = jest.fn(() => {
      type SnapshotQuery = {
        wheres: Array<[string, string, unknown]>
        unsubscribe: jest.Mock
        where: (field: string, op: string, value: unknown) => SnapshotQuery
        onSnapshot: jest.Mock
      }
      const query: SnapshotQuery = {
        wheres: [],
        unsubscribe: jest.fn(),
        where(field: string, op: string, value: unknown) {
          this.wheres.push([field, op, value])
          return this
        },
        onSnapshot: jest.fn(() => {
          queries.push({ wheres: [...query.wheres], unsubscribe: query.unsubscribe })
          return query.unsubscribe
        }),
      }
      return query
    })

    const stop = await startWatcher(['theo'])

    expect(queries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ wheres: [['columnId', '==', 'done']] }),
    ]))
    expect(queries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ wheres: [['agentStatus', '==', 'done']] }),
    ]))
    expect(queries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        wheres: expect.arrayContaining([
          ['assigneeAgentId', 'in', ['theo']],
          ['agentStatus', '==', 'pending'],
          ['columnId', '==', 'todo'],
        ]),
      }),
      expect.objectContaining({
        wheres: expect.arrayContaining([
          ['reviewerAgentId', 'in', ['theo']],
          ['columnId', '==', 'review'],
          ['reviewStatus', '==', 'pending'],
        ]),
      }),
    ]))

    stop()
    expect(queries.every((query) => query.unsubscribe.mock.calls.length === 1)).toBe(true)
  })
})
