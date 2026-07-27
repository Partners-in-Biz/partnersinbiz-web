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
import {
  planningDiscoveryDigest,
  type PlanningDecisionBrief,
  type PlanningDiscoveryState,
} from '../../../lib/projects/planningDiscovery'

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

  const brief: PlanningDecisionBrief = {
    outcome: 'Ship a safe planning gate',
    user: 'Project delivery agents',
    whyNow: 'Queued work must not bypass planning discovery',
    successCriteria: ['Only canonically ready work can be claimed'],
    constraints: ['Keep the watcher package self-contained'],
    outOfScope: ['Production deployment'],
    assumptions: ['Existing execution remains operable'],
    risks: ['Incomplete state could dispatch work'],
    approvalGates: ['production-deploy'],
  }
  const digest = planningDiscoveryDigest(brief)
  const inspection = {
    brief: ['brief'], docs: ['docs'], files: ['files'], plan: ['plan'],
    tasks: ['tasks'], tools: ['tools'], agents: ['agents'], skills: ['skills'],
    inspectedBy: 'pip', inspectedAt: '2026-07-27T00:00:00.000Z',
  }
  const confirmedState: PlanningDiscoveryState = {
    schemaVersion: 1,
    revision: 7,
    enforced: true,
    status: 'confirmed',
    mode: 'interview',
    inspection,
    turns: [{
      id: 'q-1', question: 'What matters?', currentGuess: 'Safe dispatch',
      askedBy: 'pip', askedAt: '2026-07-27T00:01:00.000Z',
      answer: 'Canonical readiness', answeredBy: 'peet', answeredAt: '2026-07-27T00:02:00.000Z',
    }],
    confidence: 96,
    predictedNextAnswers: ['Development only', 'No deployment', 'Preserve approvals'],
    intentBlockingUnknowns: [],
    brief,
    digest,
    confirmedBy: 'peet',
    confirmedAt: '2026-07-27T00:03:00.000Z',
  }
  const assumptionsState: PlanningDiscoveryState = {
    schemaVersion: 1,
    revision: 5,
    enforced: true,
    status: 'assumptions_attested',
    mode: 'assumptions',
    inspection,
    brief,
    digest,
    attestation: 'PLAN WITH ASSUMPTIONS',
    attestationReason: 'Proceed with explicit assumptions while preserving every approval gate',
    acknowledgesPreservedOperationalGates: true,
    confirmedBy: 'peet',
    confirmedAt: '2026-07-27T00:03:00.000Z',
  }

  async function claimWithPlanningState(planningDiscovery: unknown) {
    const update = jest.fn()
    dbMock.runTransaction.mockImplementation(async (work) => work({
      get: jest.fn()
        .mockResolvedValueOnce({ exists: true, data: () => ({ assigneeAgentId: 'theo', agentStatus: 'pending', columnId: 'todo' }) })
        .mockResolvedValueOnce({ exists: true, data: () => ({ planningDiscovery }) }),
      update,
    }))
    const claimed = await claimTask(taskRef as never, 'theo')
    return { claimed, update }
  }

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

  it('fails closed and does not claim queued work when planning discovery is missing', async () => {
    const { claimed, update } = await claimWithPlanningState(undefined)

    expect(claimed).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  it.each([
    ['confirmed interview', confirmedState],
    ['attested assumption', assumptionsState],
  ])('claims queued work after a canonically ready %s state', async (_label, state) => {
    const { claimed, update } = await claimWithPlanningState(state)

    expect(claimed).toBe(true)
    expect(update).toHaveBeenCalledWith(taskRef, expect.objectContaining({ agentStatus: 'picked-up' }))
  })

  it.each([
    ['confirmed state without complete inspection', { ...confirmedState, inspection: undefined }],
    ['confirmed state without answered interview evidence', { ...confirmedState, turns: [] }],
    ['confirmed state with a stale digest', { ...confirmedState, digest: 'stale-digest' }],
    ['assumption state without exact attestation', { ...assumptionsState, attestation: undefined }],
    ['assumption state without preserved-gate acknowledgement', { ...assumptionsState, acknowledgesPreservedOperationalGates: undefined }],
  ])('rejects an incomplete %s', async (_label, state) => {
    const { claimed, update } = await claimWithPlanningState(state)

    expect(claimed).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })
})

describe('agent watcher transactional approval and dependency claim gates', () => {
  const projectRef = { path: 'projects/project-1' }
  const dependencyRef = { path: 'projects/project-1/tasks/gate-1' }
  const readyBrief: PlanningDecisionBrief = {
    outcome: 'Dispatch only planned work',
    user: 'Delivery agents',
    whyNow: 'Dependency gates must be tested after planning readiness',
    successCriteria: ['Planning and approval gates are both enforced'],
    constraints: ['Development only'],
    outOfScope: ['Production promotion'],
    assumptions: ['Approval evidence is authoritative'],
    risks: ['A dependency could be claimed early'],
    approvalGates: ['production-deploy'],
  }
  const readyPlanningState: PlanningDiscoveryState = {
    schemaVersion: 1,
    revision: 4,
    enforced: true,
    status: 'assumptions_attested',
    mode: 'assumptions',
    inspection: {
      brief: ['brief'], docs: ['docs'], files: ['files'], plan: ['plan'],
      tasks: ['tasks'], tools: ['tools'], agents: ['agents'], skills: ['skills'],
      inspectedBy: 'agent:pip', inspectedAt: '2026-07-27T00:00:00.000Z',
    },
    brief: readyBrief,
    digest: planningDiscoveryDigest(readyBrief),
    attestation: 'PLAN WITH ASSUMPTIONS',
    attestationReason: 'Proceed while retaining every protected operational approval gate',
    acknowledgesPreservedOperationalGates: true,
    confirmedBy: 'peet',
    confirmedAt: '2026-07-27T00:01:00.000Z',
  }
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
      .mockResolvedValueOnce({ exists: true, data: () => ({ planningDiscovery: readyPlanningState }) })
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
        .mockResolvedValueOnce({ exists: true, data: () => ({ planningDiscovery: readyPlanningState }) })
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
        .mockResolvedValueOnce({ exists: true, data: () => ({ planningDiscovery: readyPlanningState }) })
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
