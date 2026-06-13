const mockCollectionGroup = jest.fn()
const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockLimit = jest.fn()
const mockGet = jest.fn()
const mockSet = jest.fn()
const mockMetricWhere = jest.fn()
const mockMetricLimit = jest.fn()
const mockMetricGet = jest.fn()

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'server-timestamp') },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collectionGroup: mockCollectionGroup,
    collection: mockCollection,
  },
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
  const metricQuery = { where: mockMetricWhere, limit: mockMetricLimit, get: mockMetricGet }
  mockCollection.mockReturnValue(metricQuery)
  mockMetricWhere.mockReturnValue(metricQuery)
  mockMetricLimit.mockReturnValue(metricQuery)
  mockMetricGet.mockResolvedValue({ docs: [] })
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

  it('refreshes supported CRM metrics before measuring due actions that do not have a latest value yet', async () => {
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
            },
          },
        }),
      ],
    })
    mockCollection.mockImplementation((collectionName: string) => {
      const docs = collectionName === 'contacts'
        ? [
          {
            id: 'contact-1',
            data: () => ({
              orgId: 'pib-platform-owner',
              name: 'Warm Lead',
              type: 'lead',
              stage: 'new',
              leadScore: 91,
            }),
          },
        ]
        : []
      const metricQuery = { where: mockMetricWhere, limit: mockMetricLimit, get: jest.fn().mockResolvedValue({ docs }) }
      metricQuery.where.mockReturnValue(metricQuery)
      metricQuery.limit.mockReturnValue(metricQuery)
      return metricQuery
    })

    const { measureBusinessInsightOutcomes } = await import('@/lib/loop-engine/business-insight-outcomes')
    const result = await measureBusinessInsightOutcomes({
      orgId: 'pib-platform-owner',
      now: new Date('2026-06-21T09:00:00.000Z'),
    })

    expect(result.measured).toBe(1)
    expect(result.outcomes[0]).toEqual(expect.objectContaining({
      status: 'improved',
      baselineValue: 3,
      currentValue: 1,
      delta: -2,
    }))
    expect(mockCollection).toHaveBeenCalledWith('contacts')
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        businessInsightAction: expect.objectContaining({
          latest: expect.objectContaining({
            value: 1,
            capturedAt: '2026-06-21T09:00:00.000Z',
            source: 'crm-business-signals',
          }),
          measurementStatus: 'improved',
        }),
      }),
    }), { merge: true })
  })

  it('refreshes supported support metrics before measuring due actions that do not have a latest value yet', async () => {
    mockGet.mockResolvedValue({
      docs: [
        actionDoc('action-1', {
          orgId: 'pib-platform-owner',
          projectId: 'growth-project',
          title: 'Act on insight: urgent support',
          labels: ['business-insight-action'],
          metadata: {
            businessInsightAction: {
              sourceReviewTaskId: 'review-task-1',
              measurementStatus: 'pending',
              baseline: {
                metric: 'urgent_support_needs_reply',
                value: 2,
                capturedAt: '2026-06-13T12:00:00.000Z',
              },
              target: {
                expectedDirection: 'decrease',
                reviewAfterAt: '2026-06-20T12:00:00.000Z',
              },
            },
          },
        }),
      ],
    })
    mockCollection.mockImplementation((collectionName: string) => {
      const docs = collectionName === 'support_tickets'
        ? [
          {
            id: 'ticket-1',
            data: () => ({
              orgId: 'pib-platform-owner',
              subject: 'Checkout is broken',
              status: 'waiting_on_us',
              priority: 'urgent',
            }),
          },
        ]
        : []
      const metricQuery = { where: mockMetricWhere, limit: mockMetricLimit, get: jest.fn().mockResolvedValue({ docs }) }
      metricQuery.where.mockReturnValue(metricQuery)
      metricQuery.limit.mockReturnValue(metricQuery)
      return metricQuery
    })

    const { measureBusinessInsightOutcomes } = await import('@/lib/loop-engine/business-insight-outcomes')
    const result = await measureBusinessInsightOutcomes({
      orgId: 'pib-platform-owner',
      now: new Date('2026-06-21T09:00:00.000Z'),
    })

    expect(result.measured).toBe(1)
    expect(result.outcomes[0]).toEqual(expect.objectContaining({
      status: 'improved',
      baselineValue: 2,
      currentValue: 1,
      delta: -1,
    }))
    expect(mockCollection).toHaveBeenCalledWith('support_tickets')
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        businessInsightAction: expect.objectContaining({
          latest: expect.objectContaining({
            value: 1,
            capturedAt: '2026-06-21T09:00:00.000Z',
            source: 'support-business-signals',
          }),
          measurementStatus: 'improved',
        }),
      }),
    }), { merge: true })
  })

  it('refreshes supported social metrics before measuring due actions that do not have a latest value yet', async () => {
    mockGet.mockResolvedValue({
      docs: [
        actionDoc('action-1', {
          orgId: 'pib-platform-owner',
          projectId: 'growth-project',
          title: 'Act on insight: failed social posts',
          labels: ['business-insight-action'],
          metadata: {
            businessInsightAction: {
              sourceReviewTaskId: 'review-task-1',
              measurementStatus: 'pending',
              baseline: {
                metric: 'failed_social_posts',
                value: 2,
                capturedAt: '2026-06-13T12:00:00.000Z',
              },
              target: {
                expectedDirection: 'decrease',
                reviewAfterAt: '2026-06-20T12:00:00.000Z',
              },
            },
          },
        }),
      ],
    })
    mockCollection.mockImplementation((collectionName: string) => {
      const docs = collectionName === 'social_posts'
        ? [
          {
            id: 'post-1',
            data: () => ({
              orgId: 'pib-platform-owner',
              status: 'failed',
              platform: 'linkedin',
            }),
          },
        ]
        : []
      const metricQuery = { where: mockMetricWhere, limit: mockMetricLimit, get: jest.fn().mockResolvedValue({ docs }) }
      metricQuery.where.mockReturnValue(metricQuery)
      metricQuery.limit.mockReturnValue(metricQuery)
      return metricQuery
    })

    const { measureBusinessInsightOutcomes } = await import('@/lib/loop-engine/business-insight-outcomes')
    const result = await measureBusinessInsightOutcomes({
      orgId: 'pib-platform-owner',
      now: new Date('2026-06-21T09:00:00.000Z'),
    })

    expect(result.measured).toBe(1)
    expect(result.outcomes[0]).toEqual(expect.objectContaining({
      status: 'improved',
      baselineValue: 2,
      currentValue: 1,
      delta: -1,
    }))
    expect(mockCollection).toHaveBeenCalledWith('social_posts')
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        businessInsightAction: expect.objectContaining({
          latest: expect.objectContaining({
            value: 1,
            capturedAt: '2026-06-21T09:00:00.000Z',
            source: 'social-business-signals',
          }),
          measurementStatus: 'improved',
        }),
      }),
    }), { merge: true })
  })

  it('refreshes supported ads metrics before measuring due actions that do not have a latest value yet', async () => {
    mockGet.mockResolvedValue({
      docs: [
        actionDoc('action-1', {
          orgId: 'pib-platform-owner',
          projectId: 'growth-project',
          title: 'Act on insight: ad connections',
          labels: ['business-insight-action'],
          metadata: {
            businessInsightAction: {
              sourceReviewTaskId: 'review-task-1',
              measurementStatus: 'pending',
              baseline: {
                metric: 'ads_connections_unhealthy',
                value: 2,
                capturedAt: '2026-06-13T12:00:00.000Z',
              },
              target: {
                expectedDirection: 'decrease',
                reviewAfterAt: '2026-06-20T12:00:00.000Z',
              },
            },
          },
        }),
      ],
    })
    mockCollection.mockImplementation((collectionName: string) => {
      const docs = collectionName === 'ad_connections'
        ? [
          {
            id: 'conn-1',
            data: () => ({
              orgId: 'pib-platform-owner',
              platform: 'google',
              status: 'error',
            }),
          },
        ]
        : []
      const metricQuery = { where: mockMetricWhere, limit: mockMetricLimit, get: jest.fn().mockResolvedValue({ docs }) }
      metricQuery.where.mockReturnValue(metricQuery)
      metricQuery.limit.mockReturnValue(metricQuery)
      return metricQuery
    })

    const { measureBusinessInsightOutcomes } = await import('@/lib/loop-engine/business-insight-outcomes')
    const result = await measureBusinessInsightOutcomes({
      orgId: 'pib-platform-owner',
      now: new Date('2026-06-21T09:00:00.000Z'),
    })

    expect(result.measured).toBe(1)
    expect(result.outcomes[0]).toEqual(expect.objectContaining({
      status: 'improved',
      baselineValue: 2,
      currentValue: 1,
      delta: -1,
    }))
    expect(mockCollection).toHaveBeenCalledWith('ad_connections')
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        businessInsightAction: expect.objectContaining({
          latest: expect.objectContaining({
            value: 1,
            capturedAt: '2026-06-21T09:00:00.000Z',
            source: 'ads-business-signals',
          }),
          measurementStatus: 'improved',
        }),
      }),
    }), { merge: true })
  })

  it('refreshes supported SEO metrics before measuring due actions that do not have a latest value yet', async () => {
    mockGet.mockResolvedValue({
      docs: [
        actionDoc('action-1', {
          orgId: 'pib-platform-owner',
          projectId: 'growth-project',
          title: 'Act on insight: SEO blockers',
          labels: ['business-insight-action'],
          metadata: {
            businessInsightAction: {
              sourceReviewTaskId: 'review-task-1',
              measurementStatus: 'pending',
              baseline: {
                metric: 'seo_blocked_tasks',
                value: 2,
                capturedAt: '2026-06-13T12:00:00.000Z',
              },
              target: {
                expectedDirection: 'decrease',
                reviewAfterAt: '2026-06-20T12:00:00.000Z',
              },
            },
          },
        }),
      ],
    })
    mockCollection.mockImplementation((collectionName: string) => {
      const docs = collectionName === 'seo_tasks'
        ? [
          {
            id: 'task-1',
            data: () => ({
              orgId: 'pib-platform-owner',
              sprintId: 'sprint-1',
              title: 'Fix indexing blocker',
              status: 'blocked',
            }),
          },
        ]
        : []
      const metricQuery = { where: mockMetricWhere, limit: mockMetricLimit, get: jest.fn().mockResolvedValue({ docs }) }
      metricQuery.where.mockReturnValue(metricQuery)
      metricQuery.limit.mockReturnValue(metricQuery)
      return metricQuery
    })

    const { measureBusinessInsightOutcomes } = await import('@/lib/loop-engine/business-insight-outcomes')
    const result = await measureBusinessInsightOutcomes({
      orgId: 'pib-platform-owner',
      now: new Date('2026-06-21T09:00:00.000Z'),
    })

    expect(result.measured).toBe(1)
    expect(result.outcomes[0]).toEqual(expect.objectContaining({
      status: 'improved',
      baselineValue: 2,
      currentValue: 1,
      delta: -1,
    }))
    expect(mockCollection).toHaveBeenCalledWith('seo_tasks')
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        businessInsightAction: expect.objectContaining({
          latest: expect.objectContaining({
            value: 1,
            capturedAt: '2026-06-21T09:00:00.000Z',
            source: 'seo-business-signals',
          }),
          measurementStatus: 'improved',
        }),
      }),
    }), { merge: true })
  })

  it('refreshes supported invoice metrics before measuring due actions that do not have a latest value yet', async () => {
    mockGet.mockResolvedValue({
      docs: [
        actionDoc('action-1', {
          orgId: 'pib-platform-owner',
          projectId: 'growth-project',
          title: 'Act on insight: overdue invoices',
          labels: ['business-insight-action'],
          metadata: {
            businessInsightAction: {
              sourceReviewTaskId: 'review-task-1',
              measurementStatus: 'pending',
              baseline: {
                metric: 'invoices_overdue_value',
                value: 12_000,
                capturedAt: '2026-06-13T12:00:00.000Z',
              },
              target: {
                expectedDirection: 'decrease',
                reviewAfterAt: '2026-06-20T12:00:00.000Z',
              },
            },
          },
        }),
      ],
    })
    mockCollection.mockImplementation((collectionName: string) => {
      const docs = collectionName === 'invoices'
        ? [
          {
            id: 'invoice-1',
            data: () => ({
              orgId: 'pib-platform-owner',
              invoiceNumber: 'INV-001',
              status: 'overdue',
              total: 5_000,
              currency: 'ZAR',
            }),
          },
        ]
        : []
      const metricQuery = { where: mockMetricWhere, limit: mockMetricLimit, get: jest.fn().mockResolvedValue({ docs }) }
      metricQuery.where.mockReturnValue(metricQuery)
      metricQuery.limit.mockReturnValue(metricQuery)
      return metricQuery
    })

    const { measureBusinessInsightOutcomes } = await import('@/lib/loop-engine/business-insight-outcomes')
    const result = await measureBusinessInsightOutcomes({
      orgId: 'pib-platform-owner',
      now: new Date('2026-06-21T09:00:00.000Z'),
    })

    expect(result.measured).toBe(1)
    expect(result.outcomes[0]).toEqual(expect.objectContaining({
      status: 'improved',
      baselineValue: 12_000,
      currentValue: 5_000,
      delta: -7_000,
    }))
    expect(mockCollection).toHaveBeenCalledWith('invoices')
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        businessInsightAction: expect.objectContaining({
          latest: expect.objectContaining({
            value: 5_000,
            capturedAt: '2026-06-21T09:00:00.000Z',
            source: 'invoice-business-signals',
          }),
          measurementStatus: 'improved',
        }),
      }),
    }), { merge: true })
  })

  it('refreshes supported project-risk metrics before measuring due actions that do not have a latest value yet', async () => {
    mockGet
      .mockResolvedValueOnce({
        docs: [
          actionDoc('action-1', {
            orgId: 'pib-platform-owner',
            projectId: 'growth-project',
            title: 'Act on insight: blocked launch',
            labels: ['business-insight-action'],
            metadata: {
              businessInsightAction: {
                sourceReviewTaskId: 'review-task-1',
                suppressionKey: 'project-risk:pib-platform-owner:source-task-1',
                measurementStatus: 'pending',
                baseline: {
                  metric: 'high_risk_blocked_task',
                  value: 1,
                  capturedAt: '2026-06-13T12:00:00.000Z',
                },
                target: {
                  expectedDirection: 'decrease',
                  reviewAfterAt: '2026-06-20T12:00:00.000Z',
                },
                sourceLinks: [
                  { type: 'task', id: 'source-task-1', href: '/admin/projects/growth-project?task=source-task-1', label: 'Blocked launch' },
                ],
              },
            },
          }),
        ],
      })
      .mockResolvedValueOnce({
        docs: [
          actionDoc('source-task-1', {
            orgId: 'pib-platform-owner',
            projectId: 'growth-project',
            title: 'Blocked launch',
            agentStatus: 'done',
            priority: 'urgent',
            riskLevel: 'critical',
          }),
        ],
      })

    const { measureBusinessInsightOutcomes } = await import('@/lib/loop-engine/business-insight-outcomes')
    const result = await measureBusinessInsightOutcomes({
      orgId: 'pib-platform-owner',
      now: new Date('2026-06-21T09:00:00.000Z'),
    })

    expect(result.measured).toBe(1)
    expect(result.outcomes[0]).toEqual(expect.objectContaining({
      status: 'improved',
      baselineValue: 1,
      currentValue: 0,
      delta: -1,
    }))
    expect(mockCollectionGroup).toHaveBeenCalledWith('tasks')
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        businessInsightAction: expect.objectContaining({
          latest: expect.objectContaining({
            value: 0,
            capturedAt: '2026-06-21T09:00:00.000Z',
            source: 'project-business-signals',
          }),
          measurementStatus: 'improved',
        }),
      }),
    }), { merge: true })
  })
})
