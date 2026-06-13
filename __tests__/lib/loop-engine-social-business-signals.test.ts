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

function firestoreDate(value: string) {
  return { toDate: () => new Date(value) }
}

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

describe('social business insight signals', () => {
  it('extracts failed publish and stale QA queue gaps', async () => {
    docsByCollection.social_posts = [
      doc('post-1', {
        orgId: 'pib-platform-owner',
        status: 'failed',
        platform: 'linkedin',
        campaign: 'June growth',
        title: 'Failed launch post',
        updatedAt: firestoreDate('2026-06-13T08:00:00.000Z'),
      }),
      doc('post-2', {
        orgId: 'pib-platform-owner',
        status: 'qa_review',
        platform: 'x',
        campaign: 'June growth',
        caption: 'Needs review',
        updatedAt: firestoreDate('2026-06-09T08:00:00.000Z'),
      }),
      doc('post-3', {
        orgId: 'pib-platform-owner',
        status: 'client_review',
        platform: 'linkedin',
      }),
    ]

    const { collectSocialBusinessInsightSignals } = await import('@/lib/loop-engine/social-business-signals')
    const result = await collectSocialBusinessInsightSignals({
      orgId: 'pib-platform-owner',
      now: new Date('2026-06-13T12:00:00.000Z'),
      existingSuppressionKeys: [],
      limit: 25,
    })

    expect(mockCollection).toHaveBeenCalledWith('social_posts')
    expect(chainsByCollection.social_posts.where).toHaveBeenCalledWith('orgId', '==', 'pib-platform-owner')
    expect(result).toMatchObject({
      postsScanned: 3,
      metrics: expect.arrayContaining([
        expect.objectContaining({ metric: 'failed_social_posts', value: 1 }),
        expect.objectContaining({ metric: 'social_posts_waiting_qa', value: 1 }),
      ]),
    })
    expect(result.signals).toEqual([
      expect.objectContaining({
        lane: 'social',
        insightKind: 'risk',
        summary: '1 social post failed publishing',
        metric: 'failed_social_posts',
        suppressionKey: 'social:failed-posts:pib-platform-owner',
        ownerAgentId: 'maya',
        sourceLinks: [expect.objectContaining({ type: 'social-post', id: 'post-1' })],
      }),
      expect.objectContaining({
        lane: 'social',
        insightKind: 'stale-work',
        summary: '1 social post is waiting for QA',
        metric: 'social_posts_waiting_qa',
        suppressionKey: 'social:waiting-qa:pib-platform-owner',
        ownerAgentId: 'maya',
        sourceLinks: [expect.objectContaining({ type: 'social-post', id: 'post-2' })],
      }),
    ])
  })

  it('refreshes supported social metrics for outcome measurement', async () => {
    docsByCollection.social_posts = [
      doc('post-1', {
        orgId: 'pib-platform-owner',
        status: 'failed',
        platform: 'linkedin',
      }),
    ]

    const { refreshSocialBusinessInsightMetric } = await import('@/lib/loop-engine/social-business-signals')
    const result = await refreshSocialBusinessInsightMetric({
      orgId: 'pib-platform-owner',
      metric: 'failed_social_posts',
      now: new Date('2026-06-13T12:00:00.000Z'),
    })

    expect(result).toEqual(expect.objectContaining({
      metric: 'failed_social_posts',
      value: 1,
      capturedAt: '2026-06-13T12:00:00.000Z',
      source: 'social-business-signals',
    }))
  })
})
