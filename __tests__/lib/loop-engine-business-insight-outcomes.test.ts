const mockCollectionGroup = jest.fn()
const mockWhere = jest.fn()
const mockLimit = jest.fn()
const mockGet = jest.fn()
const mockSet = jest.fn()

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'server-timestamp') },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collectionGroup: mockCollectionGroup },
}))

function actionDoc(id: string, data: Record<string, unknown>, projectId = 'growth-project') {
  return {
    id,
    data: () => data,
    ref: {
      path: `projects/${projectId}/tasks/${id}`,
      set: mockSet,
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSet.mockResolvedValue(undefined)
  const query = { where: mockWhere, limit: mockLimit, get: mockGet }
  mockCollectionGroup.mockReturnValue(query)
  mockWhere.mockReturnValue(query)
  mockLimit.mockReturnValue(query)
})

describe('business insight outcome measurement', () => {
  it('marks due converted insight actions as improved when the current metric moves in the expected direction', async () => {
    mockGet.mockResolvedValue({
      docs: [
        actionDoc('action-1', {
          orgId: 'pib-platform-owner',
          projectId: 'growth-project',
          title: 'Act on insight: high-intent leads',
          labels: ['business-insight-action'],
          metadata: {
            businessInsightAction: {
              sourceReviewTaskId: 'review-task-1',
              measurementStatus: 'pending',
              baseline: {
                metric: 'unowned_high_intent_leads',
                value: 3,
                capturedAt: '2026-06-13T12:00:00.000Z',
              },
              target: {
                expectedDirection: 'decrease',
                reviewAfterAt: '2026-06-20T12:00:00.000Z',
              },
              latest: {
                value: 1,
                capturedAt: '2026-06-21T08:00:00.000Z',
                source: 'crm-snapshot',
              },
            },
          },
        }),
      ],
    })

    const { measureBusinessInsightOutcomes } = await import('@/lib/loop-engine/business-insight-outcomes')
    const result = await measureBusinessInsightOutcomes({
      orgId: 'pib-platform-owner',
      now: new Date('2026-06-21T09:00:00.000Z'),
      limit: 25,
    })

    expect(mockCollectionGroup).toHaveBeenCalledWith('tasks')
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'pib-platform-owner')
    expect(mockLimit).toHaveBeenCalledWith(25)
    expect(result).toEqual({
      scanned: 1,
      measured: 1,
      skipped: [],
      outcomes: [
        expect.objectContaining({
          taskId: 'action-1',
          projectId: 'growth-project',
          status: 'improved',
          baselineValue: 3,
          currentValue: 1,
          delta: -2,
        }),
      ],
    })
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        businessInsightAction: expect.objectContaining({
          measurementStatus: 'improved',
          outcome: expect.objectContaining({
            status: 'improved',
            baselineValue: 3,
            currentValue: 1,
            delta: -2,
            measuredAt: 'server-timestamp',
            measuredBy: 'loop-review-outcome-cron',
          }),
        }),
      }),
      updatedAt: 'server-timestamp',
      updatedBy: 'loop-review-outcome-cron',
      updatedByType: 'system',
    }), { merge: true })
  })

  it('skips action tasks before their review window or without a current metric value', async () => {
    mockGet.mockResolvedValue({
      docs: [
        actionDoc('not-due', {
          orgId: 'pib-platform-owner',
          labels: ['business-insight-action'],
          metadata: {
            businessInsightAction: {
              measurementStatus: 'pending',
              baseline: { metric: 'blocked_tasks', value: 2 },
              target: { expectedDirection: 'decrease', reviewAfterAt: '2026-06-22T00:00:00.000Z' },
              latest: { value: 1 },
            },
          },
        }),
        actionDoc('missing-current', {
          orgId: 'pib-platform-owner',
          labels: ['business-insight-action'],
          metadata: {
            businessInsightAction: {
              measurementStatus: 'pending',
              baseline: { metric: 'blocked_tasks', value: 2 },
              target: { expectedDirection: 'decrease', reviewAfterAt: '2026-06-20T00:00:00.000Z' },
            },
          },
        }),
      ],
    })

    const { measureBusinessInsightOutcomes } = await import('@/lib/loop-engine/business-insight-outcomes')
    const result = await measureBusinessInsightOutcomes({
      orgId: 'pib-platform-owner',
      now: new Date('2026-06-21T09:00:00.000Z'),
    })

    expect(result.measured).toBe(0)
    expect(result.skipped).toEqual([
      { taskId: 'not-due', reason: 'not-due' },
      { taskId: 'missing-current', reason: 'missing-current-value' },
    ])
    expect(mockSet).not.toHaveBeenCalled()
  })
})
