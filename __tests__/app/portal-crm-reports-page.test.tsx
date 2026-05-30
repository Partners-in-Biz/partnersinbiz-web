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

    const ownerGapLink = screen.getByRole('link', { name: 'Open unowned contacts from team execution report' })
    expect(ownerGapLink).toHaveAttribute('href', '/portal/contacts?owner=unowned')

    const closeDateLink = screen.getByRole('link', { name: 'Open forecast deals missing close dates' })
    expect(closeDateLink).toHaveAttribute('href', '/portal/deals?view=forecast&focus=no-close-date')

    const dominantStageLink = screen.getByRole('link', { name: 'Open contacts in dominant New stage' })
    expect(dominantStageLink).toHaveAttribute('href', '/portal/contacts?stage=new')

    const repDealsLink = screen.getByRole('link', { name: 'Open Mandy Manager deals from rep performance report' })
    expect(repDealsLink).toHaveAttribute('href', '/portal/deals?view=list&owner=u1')
  })

  it('turns unassigned deal ownership into a direct deal owner lens', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url: RequestInfo | URL) => {
      const path = String(url)
      if (path === '/api/v1/crm/reports/funnel') {
        return apiResponse({
          byType: { lead: 1, prospect: 1, client: 1, churned: 0, other: 0 },
          byStage: { qualified: 3 },
          total: 3,
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
            noDate: { dealCount: 0, totalValue: 0, weightedValue: 0 },
          },
          summary: { totalOpenDeals: 1, totalValue: 10000, weightedValue: 5000 },
        })
      }
      if (path === '/api/v1/crm/reports/pipeline-velocity') {
        return apiResponse({ stages: [], summary: { stageCount: 0, bottleneckCount: 0, slowestStage: null } })
      }
      if (path === '/api/v1/crm/reports/rep-performance') {
        return apiResponse({
          reps: [
            {
              uid: 'unassigned',
              displayName: 'Unassigned',
              openDeals: 2,
              wonDeals: 0,
              lostDeals: 0,
              openValue: 12000,
              wonValue: 0,
              activities: 0,
              winRate: null,
            },
            {
              uid: 'u1',
              displayName: 'Mandy Manager',
              openDeals: 1,
              wonDeals: 0,
              lostDeals: 0,
              openValue: 5000,
              wonValue: 0,
              activities: 3,
              winRate: null,
            },
          ],
          summary: {
            repCount: 2,
            totalWonValue: 0,
            totalOpenValue: 17000,
            totalActivities: 3,
            totalContacts: 3,
            unassignedContacts: 0,
            contactOwnerCoverage: 1,
          },
        })
      }
      if (path === '/api/v1/crm/reports/activity-summary?days=30') {
        return apiResponse({ byType: { call: 1 }, total: 1, perDay: [{ date: '2026-05-29', count: 1 }], since: '2026-04-29', days: 30 })
      }
      return Promise.reject(new Error(`Unexpected fetch: ${path}`))
    })

    render(<CrmReportsPage />)

    expect(await screen.findByText('2 deals need an owner')).toBeInTheDocument()

    const unassignedDealsLink = screen.getByRole('link', { name: 'Open unassigned deals from team execution report' })
    expect(unassignedDealsLink).toHaveAttribute('href', '/portal/deals?view=list&owner=unassigned')
  })

  it('turns a missing dominant funnel stage insight into a contact stage action', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url: RequestInfo | URL) => {
      const path = String(url)
      if (path === '/api/v1/crm/reports/funnel') {
        return apiResponse({
          byType: { lead: 2, prospect: 0, client: 0, churned: 0, other: 0 },
          byStage: {},
          total: 2,
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

    expect(await screen.findByText('No dominant stage yet')).toBeInTheDocument()

    const contactsLink = screen.getByRole('link', { name: 'Open contacts to classify funnel stages' })
    expect(contactsLink).toHaveAttribute('href', '/portal/contacts?create=contact')
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
    expect(pipelineLink).toHaveAttribute('href', '/portal/deals?create=deal')
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
    expect(contactsLink).toHaveAttribute('href', '/portal/contacts?create=contact')
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
    expect(dealsLink).toHaveAttribute('href', '/portal/deals?create=deal')
  })

  it('turns a missing slowest-stage insight into a pipeline review action', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url: RequestInfo | URL) => {
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
            noDate: { dealCount: 0, totalValue: 0, weightedValue: 0 },
          },
          summary: { totalOpenDeals: 1, totalValue: 10000, weightedValue: 5000 },
        })
      }
      if (path === '/api/v1/crm/reports/pipeline-velocity') {
        return apiResponse({
          stages: [{ pipelineId: 'default', stageId: 'discovery', dealCount: 2, avgDays: 0, maxDays: 0, bottleneck: false }],
          summary: { stageCount: 1, bottleneckCount: 0, slowestStage: null },
        })
      }
      if (path === '/api/v1/crm/reports/rep-performance') {
        return apiResponse({
          reps: [],
          summary: {
            repCount: 0,
            totalWonValue: 0,
            totalOpenValue: 0,
            totalActivities: 0,
            totalContacts: 6,
            unassignedContacts: 0,
            contactOwnerCoverage: 1,
          },
        })
      }
      if (path === '/api/v1/crm/reports/activity-summary?days=30') {
        return apiResponse({ byType: { email: 1 }, total: 1, perDay: [{ date: '2026-05-29', count: 1 }], since: '2026-04-29', days: 30 })
      }
      return Promise.reject(new Error(`Unexpected fetch: ${path}`))
    })

    render(<CrmReportsPage />)

    expect(await screen.findByText('No slowest stage yet')).toBeInTheDocument()

    const insightLink = screen.getByRole('link', { name: 'Open pipeline to build stage velocity insight' })
    expect(insightLink).toHaveAttribute('href', '/portal/deals?create=deal')
    const bottleneckLink = screen.getByRole('link', { name: 'Review pipeline movement from bottleneck summary' })
    expect(bottleneckLink).toHaveAttribute('href', '/portal/deals')
  })

  it('turns an identified slowest stage into a deal-stage working list', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url: RequestInfo | URL) => {
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
            noDate: { dealCount: 0, totalValue: 0, weightedValue: 0 },
          },
          summary: { totalOpenDeals: 1, totalValue: 10000, weightedValue: 5000 },
        })
      }
      if (path === '/api/v1/crm/reports/pipeline-velocity') {
        return apiResponse({
          stages: [{ pipelineId: 'pipeline-1', stageId: 'discovery', dealCount: 2, avgDays: 12, maxDays: 19, bottleneck: true }],
          summary: {
            stageCount: 1,
            bottleneckCount: 1,
            slowestStage: { pipelineId: 'pipeline-1', stageId: 'discovery', dealCount: 2, avgDays: 12, maxDays: 19, bottleneck: true },
          },
        })
      }
      if (path === '/api/v1/crm/reports/rep-performance') {
        return apiResponse({
          reps: [],
          summary: {
            repCount: 0,
            totalWonValue: 0,
            totalOpenValue: 0,
            totalActivities: 0,
            totalContacts: 6,
            unassignedContacts: 0,
            contactOwnerCoverage: 1,
          },
        })
      }
      if (path === '/api/v1/crm/reports/activity-summary?days=30') {
        return apiResponse({ byType: { email: 1 }, total: 1, perDay: [{ date: '2026-05-29', count: 1 }], since: '2026-04-29', days: 30 })
      }
      return Promise.reject(new Error(`Unexpected fetch: ${path}`))
    })

    render(<CrmReportsPage />)

    expect(await screen.findByText('Discovery is slowest')).toBeInTheDocument()

    const insightLink = screen.getByRole('link', { name: 'Open deals in slowest Discovery stage' })
    expect(insightLink).toHaveAttribute('href', '/portal/deals?view=list&pipelineId=pipeline-1&stage=discovery')
    const summaryLink = screen.getByRole('link', { name: 'Review deals in slowest Discovery stage from bottleneck summary' })
    expect(summaryLink).toHaveAttribute('href', '/portal/deals?view=list&pipelineId=pipeline-1&stage=discovery')
  })

  it('turns missing rep performance data into a team setup action', async () => {
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

    expect(await screen.findByText('No rep performance data yet')).toBeInTheDocument()

    const teamLink = screen.getByRole('link', { name: 'Open team settings to prepare CRM rep reporting' })
    expect(teamLink).toHaveAttribute('href', '/portal/settings/team')
  })

  it('turns missing activity data into a contact activity action', async () => {
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
        return apiResponse(null)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${path}`))
    })

    render(<CrmReportsPage />)

    expect(await screen.findByText('No activity data yet')).toBeInTheDocument()

    const contactsLink = screen.getByRole('link', { name: 'Open contacts to log CRM activity' })
    expect(contactsLink).toHaveAttribute('href', '/portal/contacts?followUp=stale')
  })

  it('turns quiet activity rhythm into a stale-contact follow-up action', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url: RequestInfo | URL) => {
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
            noDate: { dealCount: 0, totalValue: 0, weightedValue: 0 },
          },
          summary: { totalOpenDeals: 1, totalValue: 10000, weightedValue: 5000 },
        })
      }
      if (path === '/api/v1/crm/reports/pipeline-velocity') {
        return apiResponse({ stages: [], summary: { stageCount: 0, bottleneckCount: 0, slowestStage: null } })
      }
      if (path === '/api/v1/crm/reports/rep-performance') {
        return apiResponse({
          reps: [],
          summary: {
            repCount: 0,
            totalWonValue: 0,
            totalOpenValue: 0,
            totalActivities: 0,
            totalContacts: 6,
            unassignedContacts: 0,
            contactOwnerCoverage: 1,
          },
        })
      }
      if (path === '/api/v1/crm/reports/activity-summary?days=30') {
        return apiResponse({
          byType: { email: 2 },
          total: 2,
          perDay: [
            { date: '2026-05-28', count: 0 },
            { date: '2026-05-29', count: 2 },
          ],
          since: '2026-04-29',
          days: 30,
        })
      }
      return Promise.reject(new Error(`Unexpected fetch: ${path}`))
    })

    render(<CrmReportsPage />)

    expect(await screen.findByText('Quiet days')).toBeInTheDocument()

    const followUpLink = screen.getByRole('link', { name: 'Open contacts needing follow-up from activity rhythm' })
    expect(followUpLink).toHaveAttribute('href', '/portal/contacts?followUp=stale')
  })

  it('turns missing contact funnel data into a direct contact creation path', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url: RequestInfo | URL) => {
      const path = String(url)
      if (path === '/api/v1/crm/reports/funnel') {
        return apiResponse(null)
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
        return apiResponse({
          reps: [],
          summary: {
            repCount: 0,
            totalWonValue: 0,
            totalOpenValue: 0,
            totalActivities: 0,
            totalContacts: 0,
            unassignedContacts: 0,
            contactOwnerCoverage: 1,
          },
        })
      }
      if (path === '/api/v1/crm/reports/activity-summary?days=30') {
        return apiResponse({ byType: {}, total: 0, perDay: [], since: '2026-04-29', days: 30 })
      }
      return Promise.reject(new Error(`Unexpected fetch: ${path}`))
    })

    render(<CrmReportsPage />)

    expect(await screen.findByText('No contact data yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open contacts to create reportable CRM records' }))
      .toHaveAttribute('href', '/portal/contacts?create=contact')
  })
})
