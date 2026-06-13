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

describe('CRM business insight signals', () => {
  it('extracts aggregate CRM revenue gaps from high-intent leads and stale open deals', async () => {
    docsByCollection.contacts = [
      doc('contact-1', {
        orgId: 'pib-platform-owner',
        name: 'Warm Lead',
        type: 'lead',
        stage: 'new',
        leadScore: 91,
        assignedTo: '',
        companyName: 'Acme',
      }),
      doc('contact-2', {
        orgId: 'pib-platform-owner',
        email: 'fit@example.com',
        type: 'prospect',
        stage: 'demo',
        icpScore: 86,
      }),
      doc('contact-3', {
        orgId: 'pib-platform-owner',
        name: 'Owned Lead',
        type: 'lead',
        stage: 'proposal',
        leadScore: 94,
        assignedTo: 'uid-owner',
      }),
    ]
    docsByCollection.deals = [
      doc('deal-1', {
        orgId: 'pib-platform-owner',
        title: 'Proposal at risk',
        value: 50_000,
        currency: 'ZAR',
        probability: 70,
        stageLabel: 'Proposal',
        expectedCloseDate: firestoreDate('2026-06-08T00:00:00.000Z'),
        lastActivityAt: firestoreDate('2026-05-01T00:00:00.000Z'),
      }),
      doc('deal-2', {
        orgId: 'pib-platform-owner',
        title: 'Closed deal',
        value: 100_000,
        probability: 100,
        stageLabel: 'Won',
      }),
    ]

    const { collectCrmBusinessInsightSignals } = await import('@/lib/loop-engine/crm-business-signals')
    const result = await collectCrmBusinessInsightSignals({
      orgId: 'pib-platform-owner',
      existingSuppressionKeys: [],
      now: new Date('2026-06-13T12:00:00.000Z'),
      limit: 25,
    })

    expect(mockCollection).toHaveBeenCalledWith('contacts')
    expect(mockCollection).toHaveBeenCalledWith('deals')
    expect(chainsByCollection.contacts.where).toHaveBeenCalledWith('orgId', '==', 'pib-platform-owner')
    expect(chainsByCollection.deals.limit).toHaveBeenCalledWith(25)
    expect(result).toMatchObject({
      contactsScanned: 3,
      dealsScanned: 2,
      metrics: expect.arrayContaining([
        expect.objectContaining({ metric: 'unowned_high_intent_leads', value: 2 }),
        expect.objectContaining({ metric: 'stale_open_deals', value: 1 }),
      ]),
    })
    expect(result.signals).toEqual([
      expect.objectContaining({
        lane: 'crm',
        insightKind: 'follow-up-gap',
        summary: '2 high-intent CRM leads have no owner',
        metric: 'unowned_high_intent_leads',
        value: 2,
        suppressionKey: 'crm:unowned-high-intent-leads:pib-platform-owner',
        hasNewSourceItem: true,
        ownerAgentId: 'sales',
        sourceLinks: [
          expect.objectContaining({ type: 'contact', id: 'contact-1' }),
          expect.objectContaining({ type: 'contact', id: 'contact-2' }),
        ],
      }),
      expect.objectContaining({
        lane: 'crm',
        insightKind: 'stale-work',
        summary: '1 open CRM deal is stale or past close date',
        metric: 'stale_open_deals',
        value: 1,
        suppressionKey: 'crm:stale-open-deals:pib-platform-owner',
        hasNewSourceItem: true,
        sourceLinks: [expect.objectContaining({ type: 'deal', id: 'deal-1' })],
      }),
    ])
  })

  it('refreshes supported CRM metrics for outcome measurement', async () => {
    docsByCollection.contacts = [
      doc('contact-1', {
        orgId: 'pib-platform-owner',
        name: 'Warm Lead',
        type: 'lead',
        stage: 'new',
        leadScore: 91,
      }),
    ]
    docsByCollection.deals = []

    const { refreshCrmBusinessInsightMetric } = await import('@/lib/loop-engine/crm-business-signals')
    const result = await refreshCrmBusinessInsightMetric({
      orgId: 'pib-platform-owner',
      metric: 'unowned_high_intent_leads',
      now: new Date('2026-06-13T12:00:00.000Z'),
    })

    expect(result).toEqual(expect.objectContaining({
      metric: 'unowned_high_intent_leads',
      value: 1,
      capturedAt: '2026-06-13T12:00:00.000Z',
      source: 'crm-business-signals',
    }))
  })
})
