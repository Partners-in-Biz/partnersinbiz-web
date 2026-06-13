const mockCollection = jest.fn()
const mockProjectDoc = jest.fn()
const mockTaskCollection = jest.fn()
const mockTaskDoc = jest.fn()
const mockGet = jest.fn()
const mockSet = jest.fn()

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'server-timestamp') },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

const taskDataById: Record<string, Record<string, unknown> | null> = {}

beforeEach(() => {
  jest.clearAllMocks()
  for (const key of Object.keys(taskDataById)) delete taskDataById[key]

  mockSet.mockResolvedValue(undefined)
  mockGet.mockImplementation(async function get(this: { id: string }) {
    const data = taskDataById[this.id]
    return data ? { exists: true, id: this.id, data: () => data } : { exists: false, id: this.id, data: () => null }
  })
  mockTaskDoc.mockImplementation((taskId: string) => ({ id: taskId, get: mockGet, set: mockSet }))
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

describe('business insight conversion', () => {
  it('converts an approved business insight review into an internal follow-up task with outcome measurement metadata', async () => {
    taskDataById['review-task-1'] = {
      orgId: 'pib-platform-owner',
      projectId: 'growth-project',
      title: 'Business Insight: Three high-intent leads have no owner',
      reviewStatus: 'approved',
      assigneeAgentId: 'pip',
      metadata: {
        businessInsightReview: {
          type: 'business-insight-review',
          lane: 'crm',
          insightKind: 'follow-up-gap',
          summary: 'Three high-intent CRM leads have no owner or next action.',
          businessImpact: {
            estimateLabel: 'Potential response-time revenue leakage',
            metric: 'unowned_high_intent_leads',
            value: 3,
            confidence: 78,
          },
          recommendation: {
            nextAction: 'Assign sales to triage the leads and create a follow-up task.',
            ownerAgentId: 'sales',
            ownerRole: 'sales',
            approvalGate: 'human-review',
          },
          suppressionKey: 'crm:unowned-high-intent-leads:pib-platform-owner',
          score: { total: 77 },
          sourceLinks: [{ type: 'contact', id: 'contact-1', href: '/admin/crm/contacts/contact-1', label: 'Contact 1' }],
          evidence: [{ label: 'High-intent leads without owner', value: 3 }],
        },
      },
    }

    const { convertApprovedBusinessInsightReviewTask } = await import('@/lib/loop-engine/business-insight-conversion')
    const result = await convertApprovedBusinessInsightReviewTask({
      projectId: 'growth-project',
      reviewTaskId: 'review-task-1',
      actorId: 'admin-1',
      actorType: 'user',
      now: new Date('2026-06-13T12:00:00.000Z'),
    })

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      created: true,
      projectId: 'growth-project',
      reviewTaskId: 'review-task-1',
      actionTaskId: expect.stringMatching(/^business-insight-action-[a-f0-9]{20}$/),
    }))
    if (!result.ok) return

    expect(mockTaskDoc).toHaveBeenCalledWith(result.actionTaskId)
    expect(mockSet).toHaveBeenNthCalledWith(1, expect.objectContaining({
      orgId: 'pib-platform-owner',
      projectId: 'growth-project',
      title: 'Act on insight: Three high-intent CRM leads have no owner or next action.',
      description: expect.stringContaining('Assign sales to triage the leads'),
      columnId: 'todo',
      agentStatus: 'pending',
      assigneeAgentId: 'sales',
      internalOnly: true,
      dependsOn: ['review-task-1'],
      labels: expect.arrayContaining(['business-insight-action', 'business-insight-review', 'crm', 'internal-only']),
      metadata: expect.objectContaining({
        businessInsightAction: expect.objectContaining({
          sourceReviewTaskId: 'review-task-1',
          suppressionKey: 'crm:unowned-high-intent-leads:pib-platform-owner',
          lane: 'crm',
          measurementStatus: 'pending',
          baseline: {
            metric: 'unowned_high_intent_leads',
            value: 3,
            capturedAt: '2026-06-13T12:00:00.000Z',
          },
          target: expect.objectContaining({
            expectedDirection: 'decrease',
            reviewAfterAt: '2026-06-20T12:00:00.000Z',
          }),
        }),
      }),
      agentInput: expect.objectContaining({
        spec: expect.stringContaining('Assign sales to triage the leads'),
        context: expect.objectContaining({
          sourceReviewTaskId: 'review-task-1',
          businessInsightReview: expect.objectContaining({ lane: 'crm' }),
          outcomeMeasurement: expect.objectContaining({
            metric: 'unowned_high_intent_leads',
            baselineValue: 3,
            reviewAfterAt: '2026-06-20T12:00:00.000Z',
          }),
        }),
        constraints: expect.arrayContaining([
          'internal follow-up only',
          'no external send, public publish, paid spend, finance, secret/config, production deploy, or destructive data change without separate approval',
        ]),
      }),
    }), { merge: true })
    expect(mockSet).toHaveBeenNthCalledWith(2, expect.objectContaining({
      metadata: expect.objectContaining({
        businessInsightReview: expect.objectContaining({
          conversion: expect.objectContaining({
            status: 'converted',
            actionTaskId: result.actionTaskId,
            convertedBy: 'admin-1',
            convertedByType: 'user',
            convertedAt: 'server-timestamp',
          }),
        }),
      }),
      updatedAt: 'server-timestamp',
      updatedBy: 'admin-1',
      updatedByType: 'user',
    }), { merge: true })
  })

  it('does not convert pending review tasks', async () => {
    taskDataById['review-task-1'] = {
      orgId: 'pib-platform-owner',
      projectId: 'growth-project',
      reviewStatus: 'pending',
      metadata: {
        businessInsightReview: {
          type: 'business-insight-review',
          summary: 'Needs approval first.',
          recommendation: { nextAction: 'Wait for Peet.' },
        },
      },
    }

    const { convertApprovedBusinessInsightReviewTask } = await import('@/lib/loop-engine/business-insight-conversion')
    const result = await convertApprovedBusinessInsightReviewTask({
      projectId: 'growth-project',
      reviewTaskId: 'review-task-1',
      actorId: 'admin-1',
    })

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'Business insight review must be approved before conversion',
    })
    expect(mockSet).not.toHaveBeenCalled()
  })
})
