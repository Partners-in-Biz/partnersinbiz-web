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

describe('ads business insight signals', () => {
  it('extracts unhealthy ad connection and campaign review gaps', async () => {
    docsByCollection.ad_connections = [
      doc('conn-1', {
        orgId: 'pib-platform-owner',
        platform: 'google',
        status: 'error',
        lastError: 'OAuth expired',
      }),
      doc('conn-2', {
        orgId: 'pib-platform-owner',
        platform: 'meta',
        status: 'active',
        defaultAdAccountId: 'act_123',
      }),
    ]
    docsByCollection.ad_campaigns = [
      doc('cmp-1', {
        orgId: 'pib-platform-owner',
        name: 'June lead gen',
        platform: 'meta',
        status: 'PENDING_REVIEW',
        reviewState: 'awaiting',
      }),
      doc('cmp-2', {
        orgId: 'pib-platform-owner',
        name: 'Approved campaign',
        platform: 'google',
        status: 'PENDING_REVIEW',
        reviewState: 'approved',
      }),
    ]

    const { collectAdsBusinessInsightSignals } = await import('@/lib/loop-engine/ads-business-signals')
    const result = await collectAdsBusinessInsightSignals({
      orgId: 'pib-platform-owner',
      existingSuppressionKeys: [],
      limit: 25,
      now: new Date('2026-06-13T12:00:00.000Z'),
    })

    expect(mockCollection).toHaveBeenCalledWith('ad_connections')
    expect(mockCollection).toHaveBeenCalledWith('ad_campaigns')
    expect(chainsByCollection.ad_connections.where).toHaveBeenCalledWith('orgId', '==', 'pib-platform-owner')
    expect(result).toMatchObject({
      connectionsScanned: 2,
      campaignsScanned: 2,
      metrics: expect.arrayContaining([
        expect.objectContaining({ metric: 'ads_connections_unhealthy', value: 1 }),
        expect.objectContaining({ metric: 'ads_campaigns_waiting_review', value: 1 }),
      ]),
    })
    expect(result.signals).toEqual([
      expect.objectContaining({
        lane: 'ads',
        insightKind: 'risk',
        summary: '1 ad connection needs attention',
        metric: 'ads_connections_unhealthy',
        suppressionKey: 'ads:connections-unhealthy:pib-platform-owner',
        ownerAgentId: 'ads',
        sourceLinks: [expect.objectContaining({ type: 'ad-connection', id: 'conn-1' })],
      }),
      expect.objectContaining({
        lane: 'ads',
        insightKind: 'stale-work',
        summary: '1 ad campaign is waiting for review',
        metric: 'ads_campaigns_waiting_review',
        suppressionKey: 'ads:campaigns-waiting-review:pib-platform-owner',
        ownerAgentId: 'ads',
        sourceLinks: [expect.objectContaining({ type: 'ad-campaign', id: 'cmp-1' })],
      }),
    ])
  })

  it('refreshes supported ads metrics for outcome measurement', async () => {
    docsByCollection.ad_connections = [
      doc('conn-1', {
        orgId: 'pib-platform-owner',
        platform: 'google',
        status: 'error',
      }),
    ]
    docsByCollection.ad_campaigns = []

    const { refreshAdsBusinessInsightMetric } = await import('@/lib/loop-engine/ads-business-signals')
    const result = await refreshAdsBusinessInsightMetric({
      orgId: 'pib-platform-owner',
      metric: 'ads_connections_unhealthy',
      now: new Date('2026-06-13T12:00:00.000Z'),
    })

    expect(result).toEqual(expect.objectContaining({
      metric: 'ads_connections_unhealthy',
      value: 1,
      capturedAt: '2026-06-13T12:00:00.000Z',
      source: 'ads-business-signals',
    }))
  })
})
