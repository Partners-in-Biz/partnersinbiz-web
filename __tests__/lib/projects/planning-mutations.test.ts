import {
  isProjectTaskContextMutation,
  isProjectTaskPlanningMutation,
  planningDiscoveryDigest,
  planningReadyProjectInTransaction,
  preparePlanningContextMutation,
  type PlanningDecisionBrief,
  type PlanningDiscoveryState,
} from '@/lib/projects/planningDiscovery'

const brief: PlanningDecisionBrief = {
  outcome: 'Ship the approved plan safely',
  user: 'Project managers',
  whyNow: 'Alternate writers must enforce discovery',
  successCriteria: ['Every planning writer fails closed'],
  constraints: ['Keep operational completion available'],
  outOfScope: ['Production deployment'],
  assumptions: ['Existing execution may finish'],
  risks: ['Stale project context'],
  approvalGates: ['production-deploy'],
}

function readyPlanning(): PlanningDiscoveryState {
  return {
    schemaVersion: 1,
    revision: 7,
    status: 'confirmed',
    mode: 'interview',
    enforced: true,
    confidence: 98,
    inspection: {
      brief: ['brief'], docs: ['docs'], files: ['files'], plan: ['plan'], tasks: ['tasks'],
      tools: ['tools'], agents: ['agents'], skills: ['skills'], inspectedBy: 'pip', inspectedAt: '2026-07-27T00:00:00.000Z',
    },
    turns: [{
      id: 'q-1', question: 'What must remain safe?', currentGuess: 'Planning', askedBy: 'pip', askedAt: '2026-07-27T00:01:00.000Z',
      answer: 'Planning and operational gates', answeredBy: 'peet', answeredAt: '2026-07-27T00:02:00.000Z',
    }],
    predictedNextAnswers: ['No deploy', 'No send', 'Keep approvals'],
    intentBlockingUnknowns: [],
    brief,
    digest: planningDiscoveryDigest(brief),
    confirmedBy: 'peet',
    confirmedAt: '2026-07-27T00:03:00.000Z',
  }
}

describe('planning mutation classification and transaction guard', () => {
  it('classifies planning fields explicitly while leaving completion telemetry operational', () => {
    expect(isProjectTaskPlanningMutation({ title: 'Changed intent' })).toBe(true)
    expect(isProjectTaskPlanningMutation({ assigneeAgentId: 'theo' })).toBe(true)
    expect(isProjectTaskPlanningMutation({ columnId: 'todo' })).toBe(true)
    expect(isProjectTaskPlanningMutation({ agentStatus: 'pending' })).toBe(true)

    expect(isProjectTaskPlanningMutation({ agentHeartbeatAt: true })).toBe(false)
    expect(isProjectTaskPlanningMutation({ agentOutput: { summary: 'Done' }, agentStatus: 'done' })).toBe(false)
    expect(isProjectTaskPlanningMutation({ columnId: 'review', reviewStatus: 'pending' })).toBe(false)
    expect(isProjectTaskPlanningMutation({ agentStatus: 'blocked' })).toBe(false)
  })

  it('limits context staleness to material task-intent fields', () => {
    expect(isProjectTaskContextMutation({ title: 'Changed intent' })).toBe(true)
    expect(isProjectTaskContextMutation({ description: 'Changed scope' })).toBe(true)
    expect(isProjectTaskContextMutation({ dueDate: '2026-08-01' })).toBe(true)
    expect(isProjectTaskContextMutation({ assigneeAgentId: 'theo' })).toBe(false)
    expect(isProjectTaskContextMutation({ agentStatus: 'done', agentOutput: { summary: 'Done' } })).toBe(false)
  })

  it('reopens and snapshots a ready discovery state for a material context mutation', () => {
    const current = readyPlanning()
    const result = preparePlanningContextMutation(
      { planningDiscovery: current },
      { uid: 'peet', now: '2026-07-27T01:00:00.000Z' },
      'Task description materially changed',
    )

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      state: expect.objectContaining({
        status: 'interviewing',
        revision: current.revision + 1,
        digest: undefined,
        snapshots: [expect.objectContaining({
          revision: current.revision,
          digest: current.digest,
          staleReason: 'Task description materially changed',
        })],
      }),
      event: expect.objectContaining({ type: 'reopened', previousRevision: current.revision }),
    }))
  })

  it('fails closed when transaction-time project readiness changed after a route precheck', async () => {
    const transaction = {
      get: jest.fn(async () => ({
        exists: true,
        data: () => ({ planningDiscovery: { enforced: true, revision: 8, status: 'interviewing' } }),
      })),
    }
    const result = await planningReadyProjectInTransaction(transaction, { path: 'projects/project-1' })

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      status: 409,
      code: 'planning_discovery_required',
      revision: 8,
    }))
  })
})
