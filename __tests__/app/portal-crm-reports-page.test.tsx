import { render, screen, waitFor } from '@testing-library/react'
import CrmReportsPage from '@/app/(portal)/portal/reports/crm/page'

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

function apiResponse(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: async () => ({ success: true, data }),
  } as Response)
}

describe('Portal CRM reports page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn((url: RequestInfo | URL) => {
      const path = String(url)
      if (path === '/api/v1/crm/reports/funnel') {
        return apiResponse({
          byType: { lead: 3, prospect: 2, client: 1, churned: 0, other: 0 },
          byStage: { new: 3, contacted: 2, qualified: 1 },
          total: 6,
        })
      }
      if (path === '/api/v1/crm/reports/forecast') {
        return apiResponse({
          periods: {
            thisMonth: { dealCount: 1, totalValue: 10000, weightedValue: 5000 },
            nextMonth: { dealCount: 0, totalValue: 0, weightedValue: 0 },
            thisQuarter: { dealCount: 1, totalValue: 10000, weightedValue: 5000 },
            nextQuarter: { dealCount: 0, totalValue: 0, weightedValue: 0 },
            beyond: { dealCount: 0, totalValue: 0, weightedValue: 0 },
            noDate: { dealCount: 1, totalValue: 2500, weightedValue: 1250 },
          },
          summary: { totalOpenDeals: 2, totalValue: 12500, weightedValue: 6250 },
        })
      }
      if (path === '/api/v1/crm/reports/pipeline-velocity') {
        return apiResponse({
          stages: [],
          summary: { stageCount: 0, bottleneckCount: 0, slowestStage: null },
        })
      }
      if (path === '/api/v1/crm/reports/rep-performance') {
        return apiResponse({
          reps: [
            {
              uid: 'u1',
              displayName: 'Mandy Manager',
              openDeals: 1,
              wonDeals: 1,
              lostDeals: 0,
              openValue: 5000,
              wonValue: 10000,
              activities: 7,
              winRate: 1,
            },
          ],
          summary: {
            repCount: 1,
            totalWonValue: 10000,
            totalOpenValue: 5000,
            totalActivities: 7,
            totalContacts: 6,
            unassignedContacts: 2,
            contactOwnerCoverage: 4 / 6,
          },
        })
      }
      if (path === '/api/v1/crm/reports/activity-summary?days=30') {
        return apiResponse({
          byType: { call: 3, email: 4 },
          total: 7,
          perDay: [{ date: '2026-05-29', count: 7 }],
          since: '2026-04-29',
          days: 30,
        })
      }
      return Promise.reject(new Error(`Unexpected fetch: ${path}`))
    })
  })

  it('renders contact owner coverage as an executive accountability signal', async () => {
    render(<CrmReportsPage />)

    await waitFor(() => {
      expect(screen.getAllByText('Contact owners').length).toBeGreaterThan(0)
    })

    expect(screen.getByText('2 unowned contacts')).toBeInTheDocument()
    expect(screen.getAllByText('67%').length).toBeGreaterThan(0)
    expect(screen.getByText('2 contacts need an owner')).toBeInTheDocument()
    expect(screen.getByText('Assigned contact coverage')).toBeInTheDocument()
  })

  it('turns missing forecast data into a pipeline action', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url: RequestInfo | URL) => {
      const path = String(url)
      if (path === '/api/v1/crm/reports/forecast') return apiResponse(null)
      if (path === '/api/v1/crm/reports/funnel') {
        return apiResponse({
          byType: { lead: 0, prospect: 0, client: 0, churned: 0, other: 0 },
          byStage: {},
          total: 0,
        })
      }
      if (path === '/api/v1/crm/reports/pipeline-velocity') {
        return apiResponse({ stages: [], summary: { stageCount: 0, bottleneckCount: 0, slowestStage: null } })
      }
      if (path === '/api/v1/crm/reports/rep-performance') {
        return apiResponse({ reps: [], summary: { repCount: 0, totalWonValue: 0, totalOpenValue: 0, totalActivities: 0 } })
      }
      if (path === '/api/v1/crm/reports/activity-summary?days=30') {
        return apiResponse({ byType: {}, total: 0, perDay: [], since: '2026-04-29', days: 30 })
      }
      return Promise.reject(new Error(`Unexpected fetch: ${path}`))
    })

    render(<CrmReportsPage />)

    expect(await screen.findByText('No forecast data yet')).toBeInTheDocument()

    const pipelineLink = screen.getByRole('link', { name: 'Open pipeline to create forecast deals' })
    expect(pipelineLink).toHaveAttribute('href', '/portal/deals')
  })

  it('turns missing contact data into a contact creation action', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url: RequestInfo | URL) => {
      const path = String(url)
      if (path === '/api/v1/crm/reports/funnel') return apiResponse(null)
      if (path === '/api/v1/crm/reports/forecast') {
        return apiResponse({
          periods: {
            thisMonth: { dealCount: 0, totalValue: 0, weightedValue: 0 },
            nextMonth: { dealCount: 0, totalValue: 0, weightedValue: 0 },
            thisQuarter: { dealCount: 0, totalValue: 0, weightedValue: 0 },
            nextQuarter: { dealCount: 0, totalValue: 0, weightedValue: 0 },
            beyond: { dealCount: 0, totalValue: 0, weightedValue: 0 },
            noDate: { dealCount: 0, totalValue: 0, weightedValue: 0 },
          },
          summary: { totalOpenDeals: 0, totalValue: 0, weightedValue: 0 },
        })
      }
      if (path === '/api/v1/crm/reports/pipeline-velocity') {
        return apiResponse({ stages: [], summary: { stageCount: 0, bottleneckCount: 0, slowestStage: null } })
      }
      if (path === '/api/v1/crm/reports/rep-performance') {
        return apiResponse({ reps: [], summary: { repCount: 0, totalWonValue: 0, totalOpenValue: 0, totalActivities: 0 } })
      }
      if (path === '/api/v1/crm/reports/activity-summary?days=30') {
        return apiResponse({ byType: {}, total: 0, perDay: [], since: '2026-04-29', days: 30 })
      }
      return Promise.reject(new Error(`Unexpected fetch: ${path}`))
    })

    render(<CrmReportsPage />)

    expect(await screen.findByText('No contact data yet')).toBeInTheDocument()

    const contactsLink = screen.getByRole('link', { name: 'Open contacts to create reportable CRM records' })
    expect(contactsLink).toHaveAttribute('href', '/portal/contacts')
  })

  it('turns missing velocity data into a deal movement action', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url: RequestInfo | URL) => {
      const path = String(url)
      if (path === '/api/v1/crm/reports/funnel') {
        return apiResponse({
          byType: { lead: 0, prospect: 0, client: 0, churned: 0, other: 0 },
          byStage: {},
          total: 0,
        })
      }
      if (path === '/api/v1/crm/reports/forecast') {
        return apiResponse({
          periods: {
            thisMonth: { dealCount: 0, totalValue: 0, weightedValue: 0 },
            nextMonth: { dealCount: 0, totalValue: 0, weightedValue: 0 },
            thisQuarter: { dealCount: 0, totalValue: 0, weightedValue: 0 },
            nextQuarter: { dealCount: 0, totalValue: 0, weightedValue: 0 },
            beyond: { dealCount: 0, totalValue: 0, weightedValue: 0 },
            noDate: { dealCount: 0, totalValue: 0, weightedValue: 0 },
          },
          summary: { totalOpenDeals: 0, totalValue: 0, weightedValue: 0 },
        })
      }
      if (path === '/api/v1/crm/reports/pipeline-velocity') {
        return apiResponse({ stages: [], summary: { stageCount: 0, bottleneckCount: 0, slowestStage: null } })
      }
      if (path === '/api/v1/crm/reports/rep-performance') {
        return apiResponse({ reps: [], summary: { repCount: 0, totalWonValue: 0, totalOpenValue: 0, totalActivities: 0 } })
      }
      if (path === '/api/v1/crm/reports/activity-summary?days=30') {
        return apiResponse({ byType: {}, total: 0, perDay: [], since: '2026-04-29', days: 30 })
      }
      return Promise.reject(new Error(`Unexpected fetch: ${path}`))
    })

    render(<CrmReportsPage />)

    expect(await screen.findByText('No time-in-stage data yet')).toBeInTheDocument()

    const dealsLink = screen.getByRole('link', { name: 'Open pipeline to move deals through tracked stages' })
    expect(dealsLink).toHaveAttribute('href', '/portal/deals')
  })
})
