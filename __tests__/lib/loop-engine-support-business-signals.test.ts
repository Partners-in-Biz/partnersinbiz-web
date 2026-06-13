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

describe('support business insight signals', () => {
  it('extracts urgent and stale support reply gaps', async () => {
    docsByCollection.support_tickets = [
      doc('ticket-1', {
        orgId: 'pib-platform-owner',
        subject: 'Checkout is broken',
        status: 'waiting_on_us',
        priority: 'urgent',
        requesterName: 'Client One',
        lastMessageAt: firestoreDate('2026-06-13T08:00:00.000Z'),
      }),
      doc('ticket-2', {
        orgId: 'pib-platform-owner',
        subject: 'Landing page typo',
        status: 'waiting_on_us',
        priority: 'normal',
        requesterName: 'Client Two',
        lastMessageAt: firestoreDate('2026-06-09T08:00:00.000Z'),
      }),
      doc('ticket-3', {
        orgId: 'pib-platform-owner',
        subject: 'Already done',
        status: 'resolved',
        priority: 'urgent',
      }),
    ]

    const { collectSupportBusinessInsightSignals } = await import('@/lib/loop-engine/support-business-signals')
    const result = await collectSupportBusinessInsightSignals({
      orgId: 'pib-platform-owner',
      now: new Date('2026-06-13T12:00:00.000Z'),
      existingSuppressionKeys: [],
      limit: 25,
    })

    expect(mockCollection).toHaveBeenCalledWith('support_tickets')
    expect(chainsByCollection.support_tickets.where).toHaveBeenCalledWith('orgId', '==', 'pib-platform-owner')
    expect(chainsByCollection.support_tickets.limit).toHaveBeenCalledWith(25)
    expect(result).toMatchObject({
      ticketsScanned: 3,
      metrics: expect.arrayContaining([
        expect.objectContaining({ metric: 'urgent_support_needs_reply', value: 1 }),
        expect.objectContaining({ metric: 'stale_support_needs_reply', value: 1 }),
      ]),
    })
    expect(result.signals).toEqual([
      expect.objectContaining({
        lane: 'support',
        insightKind: 'risk',
        summary: '1 urgent support ticket needs a reply',
        metric: 'urgent_support_needs_reply',
        suppressionKey: 'support:urgent-needs-reply:pib-platform-owner',
        hasNewSourceItem: true,
        ownerAgentId: 'support',
        sourceLinks: [expect.objectContaining({ type: 'support-ticket', id: 'ticket-1' })],
      }),
      expect.objectContaining({
        lane: 'support',
        insightKind: 'stale-work',
        summary: '1 support ticket has been waiting on us for 2+ days',
        metric: 'stale_support_needs_reply',
        suppressionKey: 'support:stale-needs-reply:pib-platform-owner',
        hasNewSourceItem: true,
        sourceLinks: [expect.objectContaining({ type: 'support-ticket', id: 'ticket-2' })],
      }),
    ])
  })

  it('refreshes supported support metrics for outcome measurement', async () => {
    docsByCollection.support_tickets = [
      doc('ticket-1', {
        orgId: 'pib-platform-owner',
        subject: 'Checkout is broken',
        status: 'waiting_on_us',
        priority: 'urgent',
      }),
    ]

    const { refreshSupportBusinessInsightMetric } = await import('@/lib/loop-engine/support-business-signals')
    const result = await refreshSupportBusinessInsightMetric({
      orgId: 'pib-platform-owner',
      metric: 'urgent_support_needs_reply',
      now: new Date('2026-06-13T12:00:00.000Z'),
    })

    expect(result).toEqual(expect.objectContaining({
      metric: 'urgent_support_needs_reply',
      value: 1,
      capturedAt: '2026-06-13T12:00:00.000Z',
      source: 'support-business-signals',
    }))
  })
})
