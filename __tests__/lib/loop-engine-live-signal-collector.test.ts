const mockCollectionGroup = jest.fn()
const mockWhere = jest.fn()
const mockLimit = jest.fn()
const mockGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collectionGroup: mockCollectionGroup },
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
})
