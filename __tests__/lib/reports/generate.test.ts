import { adminDb } from '@/lib/firebase/admin'
import { generateReport } from '@/lib/reports/generate'

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn() },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'server-time') },
}))

jest.mock('@/lib/reports/snapshot', () => ({
  priorPeriod: jest.fn(() => ({ start: '2026-04-01', end: '2026-04-30', tz: 'UTC' })),
  snapshotKpis: jest.fn().mockResolvedValue({
    kpis: {
      invoiced_revenue: 0,
      invoiced_revenue_paid: 0,
      outstanding: 0,
      mrr: 0,
      arr: 0,
      active_subs: 0,
      new_subs: 0,
      trials_started: 0,
      trials_converted: 0,
      churn: 0,
      subscription_revenue: 0,
      ad_revenue: 0,
      impressions: 0,
      clicks: 0,
      installs: 0,
      uninstalls: 0,
      iap_revenue: 0,
      sessions: 10,
      pageviews: 20,
      users: 5,
      conversions: 1,
      ad_spend: 0,
      roas: null,
      total_revenue: 0,
      deltas: {
        total_revenue: null,
        mrr: null,
        active_subs: null,
        sessions: null,
        ad_revenue: null,
        iap_revenue: null,
        installs: null,
      },
    },
    perProperty: [],
    series: [],
  }),
}))

jest.mock('@/lib/reports/summary', () => ({
  generateSummary: jest.fn().mockResolvedValue({
    exec_summary: 'Summary',
    highlights: ['Highlight'],
  }),
}))

describe('generateReport', () => {
  beforeEach(() => jest.clearAllMocks())

  it('stores property-scoped reports under a distinct id and records the property scope', async () => {
    const set = jest.fn().mockResolvedValue(undefined)
    const doc = jest.fn().mockReturnValue({ set })
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'organizations') {
        return {
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({
              data: () => ({ name: 'Client Org' }),
            }),
          }),
        }
      }
      return { doc }
    })

    const report = await generateReport({
      orgId: 'org-1',
      propertyId: 'prop-1',
      type: 'monthly',
      period: { start: '2026-05-01', end: '2026-05-31', tz: 'UTC' },
      generatedBy: 'admin',
      createdBy: 'admin-1',
    })

    expect(report.propertyId).toBe('prop-1')
    expect(doc).toHaveBeenCalledWith('org-1_prop-1_2026-05-01_2026-05-31_monthly')
  })
})
