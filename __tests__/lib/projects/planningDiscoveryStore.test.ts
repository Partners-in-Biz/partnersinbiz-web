import { planningDiscoveryDigest, type PlanningDecisionBrief, type PlanningDiscoveryState } from '@/lib/projects/planningDiscovery'
import { planningContextMutationTransition } from '@/lib/projects/planningDiscoveryStore'

const actor = { uid: 'peet', now: '2026-07-27T08:00:00.000Z', reason: 'client_document.updated' }
const brief: PlanningDecisionBrief = {
  outcome: 'Ship the approved plan safely',
  user: 'Project managers',
  whyNow: 'Linked document context changed',
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
      tools: ['tools'], agents: ['agents'], skills: ['skills'], inspectedBy: 'pip', inspectedAt: actor.now,
    },
    turns: [{
      id: 'q-1', question: 'What must remain safe?', currentGuess: 'Planning', askedBy: 'pip', askedAt: actor.now,
      answer: 'Planning and operational gates', answeredBy: 'peet', answeredAt: actor.now,
    }],
    predictedNextAnswers: ['No deploy', 'No send', 'Keep approvals'],
    intentBlockingUnknowns: [],
    brief,
    digest: planningDiscoveryDigest(brief),
    confirmedBy: 'peet',
    confirmedAt: actor.now,
  }
}

describe('planningContextMutationTransition', () => {
  it('initializes legacy discovery and keeps the first context mutation blocked', () => {
    const result = planningContextMutationTransition({ orgId: 'org-1' }, actor)

    expect(result).toEqual(expect.objectContaining({
      allowed: false,
      blocker: expect.objectContaining({ code: 'planning_discovery_required', revision: 0 }),
      state: expect.objectContaining({ schemaVersion: 1, revision: 1, status: 'interviewing', enforced: true }),
      event: expect.objectContaining({ type: 'started' }),
    }))
  })

  it('preserves a ready brief when the caller only needs a live readiness check', () => {
    const planningDiscovery = readyPlanning()
    const result = planningContextMutationTransition(
      { planningDiscovery },
      { ...actor, reason: 'project_task.created', reopenWhenReady: false },
    )

    expect(result).toEqual({ allowed: true })
    expect(planningDiscovery).toEqual(readyPlanning())
  })

  it('does not reopen a ready brief for ordinary project_task.updated', () => {
    const planningDiscovery = readyPlanning()
    const result = planningContextMutationTransition(
      { planningDiscovery },
      { ...actor, reason: 'project_task.updated', reopenWhenReady: false },
    )

    expect(result).toEqual({ allowed: true })
    expect(planningDiscovery.status).toBe('confirmed')
    expect(planningDiscovery.revision).toBe(7)
  })

  it('reopens a ready brief after linked document context changes', () => {
    const result = planningContextMutationTransition({ planningDiscovery: readyPlanning() }, actor)

    expect(result).toEqual(expect.objectContaining({
      allowed: true,
      state: expect.objectContaining({
        revision: 8,
        status: 'interviewing',
        snapshots: expect.arrayContaining([expect.objectContaining({ staleReason: 'client_document.updated' })]),
      }),
      event: expect.objectContaining({ type: 'reopened', reason: 'client_document.updated' }),
    }))
  })
})
