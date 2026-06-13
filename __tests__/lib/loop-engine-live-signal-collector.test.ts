const mockCollectionGroup = jest.fn()
const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockLimit = jest.fn()
const mockGet = jest.fn()
const mockCrmWhere = jest.fn()
const mockCrmLimit = jest.fn()
const mockCrmGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collectionGroup: mockCollectionGroup,
    collection: mockCollection,
  },
}))

function taskDoc(id: string, data: Record<string, unknown>, projectId = 'growth-project') {
  return {
    id,
    data: () => data,
    ref: { path: `projects/${projectId}/tasks/${id}` },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  const query = { where: mockWhere, limit: mockLimit, get: mockGet }
  mockCollectionGroup.mockReturnValue(query)
  mockWhere.mockReturnValue(query)
  mockLimit.mockReturnValue(query)
  const crmQuery = { where: mockCrmWhere, limit: mockCrmLimit, get: mockCrmGet }
  mockCollection.mockReturnValue(crmQuery)
  mockCrmWhere.mockReturnValue(crmQuery)
  mockCrmLimit.mockReturnValue(crmQuery)
  mockCrmGet.mockResolvedValue({ docs: [] })
})

describe('live loop review signal collector', () => {
  it('mines repeated agent blockers, high-risk business task gaps, and existing suppression keys', async () => {
    mockGet.mockResolvedValue({
      docs: [
        taskDoc('task-1', {
          orgId: 'pib-platform-owner',
          projectId: 'growth-project',
          title: 'Theo blocked on missing source document',
          description: 'Missing source document context before implementation.',
          assigneeAgentId: 'theo',
          agentStatus: 'awaiting-input',
          priority: 'high',
          riskLevel: 'medium',
          updatedAt: '2026-06-12T08:00:00.000Z',
        }),
        taskDoc('task-2', {
          orgId: 'pib-platform-owner',
          projectId: 'growth-project',
          title: 'Maya blocked on missing source links',
          description: 'Need source links and project context.',
          assigneeAgentId: 'maya',
          agentStatus: 'awaiting-input',
          priority: 'high',
          riskLevel: 'medium',
          updatedAt: '2026-06-12T09:00:00.000Z',
        }),
        taskDoc('task-3', {
          orgId: 'pib-platform-owner',
          projectId: 'growth-project',
          title: 'High-value onboarding delivery is blocked',
          description: 'Revenue-sensitive client onboarding cannot move.',
          assigneeAgentId: 'pip',
          agentStatus: 'blocked',
          priority: 'urgent',
          riskLevel: 'critical',
          labels: ['revenue', 'client-risk'],
          updatedAt: '2026-06-12T10:00:00.000Z',
        }),
        taskDoc('review-task-1', {
          orgId: 'pib-platform-owner',
          projectId: 'growth-project',
          title: 'Existing business insight review',
          metadata: {
            businessInsightReview: {
              suppressionKey: 'project-risk:pib-platform-owner:review-task-1',
            },
          },
        }),
      ],
    })

    const { collectLoopReviewSignals } = await import('@/lib/loop-engine/live-signal-collector')
    const result = await collectLoopReviewSignals({
      orgId: 'pib-platform-owner',
      projectId: 'growth-project',
      limit: 25,
      now: new Date('2026-06-13T00:00:00.000Z'),
    })

    expect(mockCollectionGroup).toHaveBeenCalledWith('tasks')
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'pib-platform-owner')
    expect(mockLimit).toHaveBeenCalledWith(25)
    expect(result.scanned).toBe(4)
    expect(result.sourceWindow).toEqual({
      from: '2026-06-06T00:00:00.000Z',
      to: '2026-06-13T00:00:00.000Z',
    })
    expect(result.agentSignals.filter(signal => signal.category === 'missing-context')).toHaveLength(2)
    expect(result.businessSignals).toEqual([
      expect.objectContaining({
        id: 'task-risk-task-3',
        lane: 'project',
        insightKind: 'risk',
        summary: 'High-risk work is blocked: High-value onboarding delivery is blocked',
        suppressionKey: 'project-risk:pib-platform-owner:task-3',
        hasNewSourceItem: true,
        sourceLinks: [expect.objectContaining({ id: 'task-3' })],
      }),
    ])
    expect(result.existingSuppressionKeys).toEqual(['project-risk:pib-platform-owner:review-task-1'])
  })

  it('merges CRM business insight signals into the live review collection', async () => {
    mockGet.mockResolvedValue({ docs: [] })
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
      const crmQuery = { where: mockCrmWhere, limit: mockCrmLimit, get: jest.fn().mockResolvedValue({ docs }) }
      crmQuery.where.mockReturnValue(crmQuery)
      crmQuery.limit.mockReturnValue(crmQuery)
      return crmQuery
    })

    const { collectLoopReviewSignals } = await import('@/lib/loop-engine/live-signal-collector')
    const result = await collectLoopReviewSignals({
      orgId: 'pib-platform-owner',
      limit: 25,
      now: new Date('2026-06-13T00:00:00.000Z'),
    })

    expect(mockCollection).toHaveBeenCalledWith('contacts')
    expect(mockCollection).toHaveBeenCalledWith('deals')
    expect(result.businessSignals).toEqual([
      expect.objectContaining({
        lane: 'crm',
        metric: 'unowned_high_intent_leads',
        value: 1,
        suppressionKey: 'crm:unowned-high-intent-leads:pib-platform-owner',
      }),
    ])
  })

  it('merges support business insight signals into the live review collection', async () => {
    mockGet.mockResolvedValue({ docs: [] })
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
      const sourceQuery = { where: mockCrmWhere, limit: mockCrmLimit, get: jest.fn().mockResolvedValue({ docs }) }
      sourceQuery.where.mockReturnValue(sourceQuery)
      sourceQuery.limit.mockReturnValue(sourceQuery)
      return sourceQuery
    })

    const { collectLoopReviewSignals } = await import('@/lib/loop-engine/live-signal-collector')
    const result = await collectLoopReviewSignals({
      orgId: 'pib-platform-owner',
      limit: 25,
      now: new Date('2026-06-13T00:00:00.000Z'),
    })

    expect(mockCollection).toHaveBeenCalledWith('support_tickets')
    expect(result.businessSignals).toEqual([
      expect.objectContaining({
        lane: 'support',
        metric: 'urgent_support_needs_reply',
        value: 1,
        suppressionKey: 'support:urgent-needs-reply:pib-platform-owner',
      }),
    ])
  })

  it('merges social business insight signals into the live review collection', async () => {
    mockGet.mockResolvedValue({ docs: [] })
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
      const sourceQuery = { where: mockCrmWhere, limit: mockCrmLimit, get: jest.fn().mockResolvedValue({ docs }) }
      sourceQuery.where.mockReturnValue(sourceQuery)
      sourceQuery.limit.mockReturnValue(sourceQuery)
      return sourceQuery
    })

    const { collectLoopReviewSignals } = await import('@/lib/loop-engine/live-signal-collector')
    const result = await collectLoopReviewSignals({
      orgId: 'pib-platform-owner',
      limit: 25,
      now: new Date('2026-06-13T00:00:00.000Z'),
    })

    expect(mockCollection).toHaveBeenCalledWith('social_posts')
    expect(result.businessSignals).toEqual([
      expect.objectContaining({
        lane: 'social',
        metric: 'failed_social_posts',
        value: 1,
        suppressionKey: 'social:failed-posts:pib-platform-owner',
      }),
    ])
  })

  it('merges ads business insight signals into the live review collection', async () => {
    mockGet.mockResolvedValue({ docs: [] })
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
      const sourceQuery = { where: mockCrmWhere, limit: mockCrmLimit, get: jest.fn().mockResolvedValue({ docs }) }
      sourceQuery.where.mockReturnValue(sourceQuery)
      sourceQuery.limit.mockReturnValue(sourceQuery)
      return sourceQuery
    })

    const { collectLoopReviewSignals } = await import('@/lib/loop-engine/live-signal-collector')
    const result = await collectLoopReviewSignals({
      orgId: 'pib-platform-owner',
      limit: 25,
      now: new Date('2026-06-13T00:00:00.000Z'),
    })

    expect(mockCollection).toHaveBeenCalledWith('ad_connections')
    expect(mockCollection).toHaveBeenCalledWith('ad_campaigns')
    expect(result.businessSignals).toEqual([
      expect.objectContaining({
        lane: 'ads',
        metric: 'ads_connections_unhealthy',
        value: 1,
        suppressionKey: 'ads:connections-unhealthy:pib-platform-owner',
      }),
    ])
  })
})
