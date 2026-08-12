import { planningDiscoveryDigest, type PlanningDecisionBrief, type PlanningDiscoveryState } from '@/lib/projects/planningDiscovery'
import {
  canMutateLinkedProjectPlanning,
  planningContextMutationTransition,
} from '@/lib/projects/planningDiscoveryStore'

const mockResolveProjectAccessForUser = jest.fn()

jest.mock('@/lib/projects/collaboration', () => {
  const actual = jest.requireActual('@/lib/projects/collaboration')
  return {
    ...actual,
    resolveProjectAccessForUser: (...args: unknown[]) => mockResolveProjectAccessForUser(...args),
  }
})

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

describe('canMutateLinkedProjectPlanning', () => {
  const externalUser = {
    uid: 'external-1',
    role: 'admin' as const,
    orgId: 'external-org',
    authKind: 'session' as const,
  }
  const foreignProject = {
    orgId: 'owner-org',
    clientOrgId: 'external-org',
  }

  beforeEach(() => {
    mockResolveProjectAccessForUser.mockReset()
  })

  it('denies a read-only external collaborator from creating a project-linked client document', async () => {
    mockResolveProjectAccessForUser.mockResolvedValue({
      role: 'viewer',
      source: 'project_organization',
      canViewInternal: false,
      crossOrgGrant: { grantId: 'grant-1', actions: ['project.read'], items: [] },
    })

    await expect(canMutateLinkedProjectPlanning('project-1', foreignProject, externalUser, {
      documentOrgId: 'external-org',
    })).resolves.toBe(false)

    expect(mockResolveProjectAccessForUser).toHaveBeenCalledWith(
      'project-1',
      externalUser,
      foreignProject,
      'external-org',
      { action: 'project.write' },
    )
  })

  it('denies item-scoped grants from creating unscoped project-linked client documents', async () => {
    mockResolveProjectAccessForUser.mockResolvedValue({
      role: 'contributor',
      source: 'project_organization',
      canViewInternal: false,
      crossOrgGrant: { grantId: 'grant-1', actions: ['project.write'], items: ['doc-existing'] },
    })

    await expect(canMutateLinkedProjectPlanning('project-1', foreignProject, externalUser, {
      documentOrgId: 'external-org',
    })).resolves.toBe(false)
  })

  it('allows an exact-item write grant to mutate an existing linked client document', async () => {
    mockResolveProjectAccessForUser.mockResolvedValue({
      role: 'contributor',
      source: 'project_organization',
      canViewInternal: false,
      crossOrgGrant: { grantId: 'grant-1', actions: ['project.write'], items: ['doc-1'] },
    })

    await expect(canMutateLinkedProjectPlanning('project-1', foreignProject, externalUser, {
      documentOrgId: 'external-org',
      item: 'doc-1',
    })).resolves.toBe(true)

    expect(mockResolveProjectAccessForUser).toHaveBeenCalledWith(
      'project-1',
      externalUser,
      foreignProject,
      'external-org',
      { action: 'project.write', item: 'doc-1' },
    )
  })
})
