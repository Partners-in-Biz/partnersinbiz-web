import { render, screen } from '@testing-library/react'
import PortalDashboard from '@/app/(portal)/portal/dashboard/page'

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

jest.mock('@/components/settings/ProfileCompleteBanner', () => ({
  ProfileCompleteBanner: () => null,
}))

jest.mock('@/components/dashboard/TopCompaniesByPipelineTile', () => ({
  TopCompaniesByPipelineTile: () => null,
}))

jest.mock('@/components/admin/ScheduledContentPreviewCards', () => ({
  ScheduledContentPreviewCards: () => null,
}))

jest.mock('@/components/ui/Charts', () => ({
  DonutChart: () => null,
  HorizontalBarChart: () => null,
  StatCardWithChart: ({ label, value }: { label: string; value: React.ReactNode }) => (
    <section aria-label={label}>{value}</section>
  ),
  TrendAreaChart: () => null,
}))

describe('Portal dashboard CRM widget', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useRealTimers()
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)

      if (url === '/api/v1/portal/org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ org: { id: 'org-1', name: 'Acme Board', slug: 'acme-board' } }),
        } as Response)
      }

      if (url === '/api/v1/portal/dashboard') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            kpis: {
              total_revenue: 0,
              mrr: 0,
              arr: 0,
              active_subs: 0,
              ad_revenue: 0,
              iap_revenue: 0,
              installs: 0,
              sessions: 0,
              outstanding: 0,
              invoiced_revenue_paid: 0,
              deltas: {},
            },
            period: { start: '2026-05-01', end: '2026-05-31' },
            properties: [],
            connections: [{ id: 'conn-1', provider: 'crm', propertyId: 'prop-1', status: 'connected' }],
            reports: [],
          }),
        } as Response)
      }

      if (url === '/api/v1/crm/dashboard') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              openDealsCount: 1,
              openDealsValue: 120000,
              weightedPipelineValue: 72000,
              wonThisMonth: { count: 0, value: 0 },
              lostThisMonth: { count: 0 },
              recentActivities: [
                {
                  id: 'activity-contact-1',
                  type: 'call',
                  summary: 'CEO call logged',
                  contactId: 'contact-1',
                  createdAt: null,
                },
                {
                  id: 'activity-deal-1',
                  type: 'stage_change',
                  summary: 'Proposal moved to review',
                  dealId: 'deal-1',
                  createdAt: null,
                },
              ],
              topOpenDeals: [
                {
                  id: 'deal-1',
                  title: 'Board reporting rollout',
                  value: 120000,
                  currency: 'ZAR',
                  probability: 60,
                },
              ],
            },
          }),
        } as Response)
      }

      if (url.startsWith('/api/v1/projects')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
      }

      if (url.startsWith('/api/v1/social/stats')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              total: 0,
              byStatus: { draft: 0, pending_approval: 0, approved: 0, scheduled: 0, published: 0, failed: 0, cancelled: 0 },
              byPlatform: {},
              approvalRate: 0,
              last30Days: 0,
              last30DaysSeries: [],
            },
          }),
        } as Response)
      }

      if (url.startsWith('/api/v1/social/posts')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
      }

      if (url === '/api/v1/crm/contacts?limit=1') {
        return Promise.resolve({ ok: true, json: async () => ({ meta: { total: 1 }, data: [] }) } as Response)
      }

      if (url.startsWith('/api/v1/campaigns')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
      }

      if (url === '/api/v1/crm/capture-sources') {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
      }

      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock
  })

  it('turns CRM dashboard activity and top deals into drill-down links', async () => {
    render(<PortalDashboard />)

    const topDeal = await screen.findByRole('link', { name: /Board reporting rollout/ })
    expect(topDeal).toHaveAttribute('href', '/portal/deals/deal-1')

    const contactActivity = screen.getByRole('link', { name: /CEO call logged/ })
    expect(contactActivity).toHaveAttribute('href', '/portal/contacts/contact-1')

    const dealActivity = screen.getByRole('link', { name: /Proposal moved to review/ })
    expect(dealActivity).toHaveAttribute('href', '/portal/deals/deal-1')
  })
})
