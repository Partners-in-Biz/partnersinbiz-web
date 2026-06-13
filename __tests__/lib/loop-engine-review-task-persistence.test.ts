import type { ConservativeReviewTaskDraft } from '@/lib/loop-engine/review-evaluator'

const mockCollection = jest.fn()
const mockProjectDoc = jest.fn()
const mockTaskCollection = jest.fn()
const mockTaskDoc = jest.fn()
const mockSet = jest.fn()

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'server-timestamp') },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

function baseDraft(overrides: Partial<ConservativeReviewTaskDraft> = {}): ConservativeReviewTaskDraft {
  return {
    loopId: 'business-insight-review',
    idempotencyKey: 'business-insight-review:pib-platform-owner:crm-gap:2026-06-13T00:00:00.000Z',
    orgId: 'pib-platform-owner',
    projectId: 'growth-project',
    title: 'Business Insight: Three high-intent leads need owners',
    description: 'Potential response-time revenue leakage. Assign the sales agent to triage.',
    columnId: 'review',
    status: 'todo',
    agentStatus: 'done',
    reviewStatus: 'pending',
    assigneeAgentId: 'pip',
    reviewerAgentId: 'nora',
    requiredCapability: 'business-insight-review',
    riskLevel: 'high',
    requiresApproval: true,
    approvalStatus: 'pending',
    sideEffectPolicy: 'internal-review-only',
    metadata: {
      businessInsightReview: {
        type: 'business-insight-review',
        summary: 'Three high-intent leads need owners',
        businessImpact: {
          estimateLabel: 'Potential response-time revenue leakage',
          metric: undefined,
        },
        recommendation: {
          nextAction: 'Assign the sales agent to triage.',
          ownerAgentId: undefined,
          approvalGate: 'human-review',
        },
        reviewStatus: 'pending',
      },
    },
    agentInput: {
      requiredCapability: 'business-insight-review',
      context: {
        sourceWindow: {
          from: '2026-06-06T00:00:00.000Z',
          to: '2026-06-13T00:00:00.000Z',
        },
        suppressionKey: 'crm:high-intent-leads:pib-platform-owner',
        guardrail: 'Produce internal review only. Do not send, publish, spend, change finance, mutate config/secrets, deploy, or destructively edit data.',
      },
    },
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSet.mockResolvedValue(undefined)
  mockTaskDoc.mockImplementation((taskId: string) => ({ id: taskId, set: mockSet }))
  mockTaskCollection.mockImplementation((collectionName: string) => {
    if (collectionName !== 'tasks') throw new Error(`Unexpected nested collection ${collectionName}`)
    return { doc: mockTaskDoc }
  })
  mockProjectDoc.mockImplementation((projectId: string) => ({ id: projectId, collection: mockTaskCollection }))
  mockCollection.mockImplementation((collectionName: string) => {
    if (collectionName !== 'projects') throw new Error(`Unexpected collection ${collectionName}`)
    return { doc: mockProjectDoc }
  })
})

describe('loop review task persistence', () => {
  it('persists internal review drafts as idempotent project review tasks', async () => {
    const { persistConservativeReviewTaskDrafts } = await import('@/lib/loop-engine/review-task-persistence')
    const draft = baseDraft()

    const result = await persistConservativeReviewTaskDrafts({
      drafts: [draft],
      actorId: 'pip',
      createdByType: 'agent',
    })

    expect(result.skipped).toEqual([])
    expect(result.created).toEqual([
      expect.objectContaining({
        draftId: draft.idempotencyKey,
        projectId: 'growth-project',
        orgId: 'pib-platform-owner',
        loopId: 'business-insight-review',
        taskId: expect.stringMatching(/^loop-review-[a-f0-9]{20}$/),
      }),
    ])
    expect(mockProjectDoc).toHaveBeenCalledWith('growth-project')
    expect(mockTaskDoc).toHaveBeenCalledWith(result.created[0].taskId)
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'pib-platform-owner',
      projectId: 'growth-project',
      title: draft.title,
      description: draft.description,
      columnId: 'review',
      status: 'todo',
      agentStatus: 'done',
      reviewStatus: 'pending',
      assigneeAgentId: 'pip',
      reviewerAgentId: 'nora',
      requiredCapability: 'business-insight-review',
      riskLevel: 'high',
      requiresApproval: true,
      approvalStatus: 'pending',
      internalOnly: true,
      sideEffectPolicy: 'internal-review-only',
      reporterId: 'pip',
      createdBy: 'pip',
      createdByType: 'agent',
      updatedBy: 'pip',
      updatedByType: 'agent',
      createdAt: 'server-timestamp',
      updatedAt: 'server-timestamp',
      labels: expect.arrayContaining(['loop-review', 'business-insight-review', 'internal-only']),
      metadata: expect.objectContaining({
        businessInsightReview: expect.objectContaining({ type: 'business-insight-review' }),
        loopReviewDraft: expect.objectContaining({
          idempotencyKey: draft.idempotencyKey,
          loopId: 'business-insight-review',
          sideEffectPolicy: 'internal-review-only',
          persistedBy: 'pip',
        }),
      }),
      agentInput: expect.objectContaining({
        spec: draft.description,
        context: expect.objectContaining({
          loopId: 'business-insight-review',
          idempotencyKey: draft.idempotencyKey,
          requiredCapability: 'business-insight-review',
          sideEffectPolicy: 'internal-review-only',
        }),
        constraints: expect.arrayContaining([
          'internal review only',
          'no automatic external send, public publish, paid spend, finance, secret/config, production deploy, destructive data change, skill rewrite, or wiki rewrite',
        ]),
      }),
    }), { merge: true })
    expect(JSON.stringify(mockSet.mock.calls[0][0])).not.toContain('undefined')
  })

  it('skips drafts that are missing a project or are not internal-review-only', async () => {
    const { persistConservativeReviewTaskDrafts } = await import('@/lib/loop-engine/review-task-persistence')
    const missingProject = baseDraft({ projectId: null })
    const unsafePolicy = baseDraft({
      idempotencyKey: 'business-insight-review:pib-platform-owner:unsafe',
      sideEffectPolicy: 'external-action' as ConservativeReviewTaskDraft['sideEffectPolicy'],
    })

    const result = await persistConservativeReviewTaskDrafts({ drafts: [missingProject, unsafePolicy] })

    expect(result.created).toEqual([])
    expect(result.skipped).toEqual([
      { draftId: missingProject.idempotencyKey, loopId: 'business-insight-review', reason: 'missing-project-id' },
      { draftId: unsafePolicy.idempotencyKey, loopId: 'business-insight-review', reason: 'non-internal-side-effect-policy' },
    ])
    expect(mockSet).not.toHaveBeenCalled()
  })
})
