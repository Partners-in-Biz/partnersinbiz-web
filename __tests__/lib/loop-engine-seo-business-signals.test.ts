const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

type MockDoc = { id: string; data: () => Record<string, unknown> }

const docsByCollection: Record<string, MockDoc[]> = {}
const chainsByCollection: Record<string, {
  where: jest.Mock
  limit: jest.Mock
  get: jest.Mock
}> = {}

function doc(id: string, data: Record<string, unknown>): MockDoc {
  return { id, data: () => data }
}

function chainFor(collectionName: string) {
  if (!chainsByCollection[collectionName]) {
    const chain = {
      where: jest.fn(),
      limit: jest.fn(),
      get: jest.fn(),
    }
    chain.where.mockReturnValue(chain)
    chain.limit.mockReturnValue(chain)
    chain.get.mockImplementation(async () => ({ docs: docsByCollection[collectionName] ?? [] }))
    chainsByCollection[collectionName] = chain
  }
  return chainsByCollection[collectionName]
}

beforeEach(() => {
  jest.clearAllMocks()
  for (const key of Object.keys(docsByCollection)) delete docsByCollection[key]
  for (const key of Object.keys(chainsByCollection)) delete chainsByCollection[key]
  mockCollection.mockImplementation((collectionName: string) => chainFor(collectionName))
})

describe('SEO business insight signals', () => {
  it('extracts blocked SEO task and high-severity health gaps', async () => {
    docsByCollection.seo_tasks = [
      doc('task-1', {
        orgId: 'pib-platform-owner',
        sprintId: 'sprint-1',
        title: 'Fix indexing blocker',
        status: 'blocked',
        blockerReason: 'GSC property missing',
      }),
      doc('task-2', {
        orgId: 'pib-platform-owner',
        sprintId: 'sprint-1',
        title: 'Done task',
        status: 'done',
      }),
    ]
    docsByCollection.seo_sprints = [
      doc('sprint-1', {
        orgId: 'pib-platform-owner',
        siteName: 'Client Site',
        status: 'active',
        health: {
          score: 42,
          signals: [
            { type: 'lost_keyword', severity: 'high', evidence: { keyword: 'crm automation' } },
            { type: 'cwv_regression', severity: 'medium', evidence: { page: '/pricing' } },
          ],
        },
      }),
    ]

    const { collectSeoBusinessInsightSignals } = await import('@/lib/loop-engine/seo-business-signals')
    const result = await collectSeoBusinessInsightSignals({
      orgId: 'pib-platform-owner',
      existingSuppressionKeys: [],
      limit: 25,
      now: new Date('2026-06-13T12:00:00.000Z'),
    })

    expect(mockCollection).toHaveBeenCalledWith('seo_tasks')
    expect(mockCollection).toHaveBeenCalledWith('seo_sprints')
    expect(chainsByCollection.seo_tasks.where).toHaveBeenCalledWith('orgId', '==', 'pib-platform-owner')
    expect(result).toMatchObject({
      tasksScanned: 2,
      sprintsScanned: 1,
      metrics: expect.arrayContaining([
        expect.objectContaining({ metric: 'seo_blocked_tasks', value: 1 }),
        expect.objectContaining({ metric: 'seo_high_severity_signals', value: 1 }),
      ]),
    })
    expect(result.signals).toEqual([
      expect.objectContaining({
        lane: 'seo',
        insightKind: 'risk',
        summary: '1 SEO task is blocked',
        metric: 'seo_blocked_tasks',
        suppressionKey: 'seo:blocked-tasks:pib-platform-owner',
        ownerAgentId: 'seo',
        sourceLinks: [expect.objectContaining({ type: 'seo-task', id: 'task-1' })],
      }),
      expect.objectContaining({
        lane: 'seo',
        insightKind: 'performance-drop',
        summary: '1 high-severity SEO health signal needs review',
        metric: 'seo_high_severity_signals',
        suppressionKey: 'seo:high-severity-signals:pib-platform-owner',
        ownerAgentId: 'seo',
        sourceLinks: [expect.objectContaining({ type: 'seo-sprint', id: 'sprint-1' })],
      }),
    ])
  })

  it('refreshes supported SEO metrics for outcome measurement', async () => {
    docsByCollection.seo_tasks = [
      doc('task-1', {
        orgId: 'pib-platform-owner',
        sprintId: 'sprint-1',
        title: 'Fix indexing blocker',
        status: 'blocked',
      }),
    ]
    docsByCollection.seo_sprints = []

    const { refreshSeoBusinessInsightMetric } = await import('@/lib/loop-engine/seo-business-signals')
    const result = await refreshSeoBusinessInsightMetric({
      orgId: 'pib-platform-owner',
      metric: 'seo_blocked_tasks',
      now: new Date('2026-06-13T12:00:00.000Z'),
    })

    expect(result).toEqual(expect.objectContaining({
      metric: 'seo_blocked_tasks',
      value: 1,
      capturedAt: '2026-06-13T12:00:00.000Z',
      source: 'seo-business-signals',
    }))
  })
})
