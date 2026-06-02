import { adminDb } from '@/lib/firebase/admin'
import { snapshotKpis } from '@/lib/reports/snapshot'

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn() },
}))

jest.mock('@/lib/metrics/query', () => ({
  dailySeries: jest.fn().mockResolvedValue([]),
  listMetrics: jest.fn().mockResolvedValue([]),
  lastValue: jest.fn().mockResolvedValue(null),
  sumZar: jest.fn().mockResolvedValue(0),
  sumValue: jest.fn().mockResolvedValue(0),
}))

function queryWithDocs(docs: Array<Record<string, unknown>>) {
  return {
    where: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({
      docs: docs.map((doc, index) => ({ id: doc.id ?? `doc-${index}`, data: () => doc })),
    }),
  }
}

describe('snapshotKpis first-party analytics rollup', () => {
  beforeEach(() => jest.clearAllMocks())

  it('uses product sessions and events for web analytics KPIs when metric rows are empty', async () => {
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'product_sessions') {
        return queryWithDocs([
          { id: 's1', orgId: 'org-1', propertyId: 'prop-1', distinctId: 'u1', pageCount: 2 },
          { id: 's2', orgId: 'org-1', propertyId: 'prop-1', distinctId: 'u2', pageCount: 1 },
        ])
      }
      if (name === 'product_events') {
        return queryWithDocs([
          { id: 'e1', orgId: 'org-1', propertyId: 'prop-1', distinctId: 'u1', event: '$pageview' },
          { id: 'e2', orgId: 'org-1', propertyId: 'prop-1', distinctId: 'u1', event: '$pageview' },
          { id: 'e3', orgId: 'org-1', propertyId: 'prop-1', distinctId: 'u2', event: 'lead_submitted' },
        ])
      }
      return queryWithDocs([])
    })

    const snapshot = await snapshotKpis({
      orgId: 'org-1',
      propertyId: 'prop-1',
      period: { start: '2026-05-01', end: '2026-05-31', tz: 'UTC' },
      previousPeriod: { start: '2026-04-01', end: '2026-04-30', tz: 'UTC' },
    })

    expect(snapshot.kpis.sessions).toBe(2)
    expect(snapshot.kpis.pageviews).toBe(2)
    expect(snapshot.kpis.users).toBe(2)
    expect(snapshot.kpis.conversions).toBe(1)
  })
})
