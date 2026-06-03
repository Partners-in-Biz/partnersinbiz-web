import { render, screen } from '@testing-library/react'
import PortalCrmPage from '@/app/(portal)/portal/crm/page'

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

describe('Portal CRM hub', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/dashboard') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              openDealsCount: 0,
              openDealsValue: 0,
              weightedPipelineValue: 0,
              wonThisMonth: { count: 0, value: 0 },
              lostThisMonth: { count: 0 },
              recentActivities: [],
              topOpenDeals: [],
            },
          }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock
  })

  it('turns the empty top-open-deals panel into a create-deal action', async () => {
    render(<PortalCrmPage />)

    expect(await screen.findByRole('heading', { name: 'Build the first active pipeline.' })).toBeInTheDocument()
    expect(screen.getByText('Create a deal so leadership can see value, owner, and next-step accountability from this command center.')).toBeInTheDocument()

    const createDealLink = screen.getByRole('link', { name: 'Create first deal from CRM command center' })
    expect(createDealLink).toHaveAttribute('href', '/portal/deals?create=deal')
  })

  it('names CRM hub navigation by business destination without decorative icon text', async () => {
    render(<PortalCrmPage />)

    expect(await screen.findByRole('heading', { name: 'Build the first active pipeline.' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Contacts' })).toHaveAttribute('href', '/portal/contacts')
    expect(screen.getByRole('link', { name: 'Pipeline' })).toHaveAttribute('href', '/portal/deals')
    expect(screen.getByRole('link', { name: 'Open Contacts CRM workspace' })).toHaveAttribute('href', '/portal/contacts')
    expect(screen.getByRole('link', { name: 'Open Companies CRM workspace' })).toHaveAttribute('href', '/portal/companies')
    expect(screen.getByRole('link', { name: 'Open Deals CRM workspace' })).toHaveAttribute('href', '/portal/deals')
    expect(screen.getByRole('link', { name: 'Open CRM reports workspace' })).toHaveAttribute('href', '/portal/reports/crm')
    expect(screen.getByRole('link', { name: 'Open CRM setup workspace' })).toHaveAttribute('href', '/portal/settings/crm-setup')
    expect(screen.queryByRole('link', { name: /contacts People/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /arrow_forward/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /CRM reports CRM workspace/i })).not.toBeInTheDocument()
  })

  it('turns the empty activity panel into a stale-follow-up command', async () => {
    render(<PortalCrmPage />)

    expect(await screen.findByRole('heading', { name: 'Relationship activity missing' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'No relationship activity logged yet.' })).not.toBeInTheDocument()
    expect(screen.getByText('Open the stale follow-up lens so managers can assign calls, emails, meetings, and notes before accounts go quiet.')).toBeInTheDocument()

    const contactsLink = screen.getByRole('link', { name: 'Open stale contacts from CRM command center' })
    expect(contactsLink).toHaveAttribute('href', '/portal/contacts?followUp=stale')
  })

  it('names missing activity timestamps instead of showing a generic no-date label', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/dashboard') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              openDealsCount: 1,
              openDealsValue: 20000,
              weightedPipelineValue: 12000,
              wonThisMonth: { count: 0, value: 0 },
              lostThisMonth: { count: 0 },
              recentActivities: [
                {
                  id: 'activity-1',
                  summary: 'Discovery call logged',
                  contactName: 'Mandy CEO',
                  createdAt: null,
                },
              ],
              topOpenDeals: [
                {
                  id: 'deal-1',
                  title: 'Board reporting rollout',
                  value: 20000,
                  currency: 'ZAR',
                  probability: 60,
                  contactName: 'Mandy CEO',
                },
              ],
            },
          }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    render(<PortalCrmPage />)

    expect(await screen.findByText('Discovery call logged')).toBeInTheDocument()
    expect(screen.getByText('Mandy CEO · Timestamp not captured')).toBeInTheDocument()
    expect(screen.queryByText('Mandy CEO · No date')).not.toBeInTheDocument()
  })

  it('renders sparse recent activity rows as readable CRM follow-up context', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/dashboard') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              openDealsCount: 1,
              openDealsValue: 20000,
              weightedPipelineValue: 12000,
              wonThisMonth: { count: 0, value: 0 },
              lostThisMonth: { count: 0 },
              recentActivities: [
                {
                  id: 'activity-1',
                  type: 'meeting_follow_up',
                  summary: '',
                  contactName: '',
                  createdAt: { seconds: Number.NaN },
                },
              ],
              topOpenDeals: [
                {
                  id: 'deal-1',
                  title: 'Board reporting rollout',
                  value: 20000,
                  currency: 'ZAR',
                  probability: 60,
                  contactName: 'Mandy CEO',
                },
              ],
            },
          }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    render(<PortalCrmPage />)

    expect(await screen.findByText('Meeting follow up')).toBeInTheDocument()
    expect(screen.getByText('Contact not linked · Activity date needs review')).toBeInTheDocument()
    expect(screen.queryByText(/meeting_follow_up/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument()
  })

  it('warns leaders when recent activity is missing visible contact or deal attribution', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/dashboard') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              openDealsCount: 0,
              openDealsValue: 0,
              weightedPipelineValue: 0,
              wonThisMonth: { count: 0, value: 0 },
              lostThisMonth: { count: 0 },
              recentActivities: [
                {
                  id: 'activity-1',
                  summary: 'Rikus and AHS is current an active client',
                  contactName: '',
                  createdAt: '2026-06-02T10:00:00.000Z',
                },
                {
                  id: 'activity-2',
                  summary: 'Sequence step 2: Yes or no works, Coach',
                  contactName: '',
                  createdAt: '2026-05-29T10:00:00.000Z',
                },
              ],
              topOpenDeals: [],
            },
          }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    render(<PortalCrmPage />)

    expect(await screen.findByRole('heading', { name: 'Activity attribution needs review' })).toBeInTheDocument()
    expect(screen.getByText(/2 recent CRM activity items are missing visible contact or deal names/)).toBeInTheDocument()
    expect(screen.getByText(/Managers need those touches clearly attributed before activity can drive accountable follow-up/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review unlinked CRM activity from command center' }))
      .toHaveAttribute('href', '/portal/contacts?followUp=stale')
  })

  it('turns recent CRM activity rows into contact and deal drill-down links', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/dashboard') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              openDealsCount: 1,
              openDealsValue: 20000,
              weightedPipelineValue: 12000,
              wonThisMonth: { count: 0, value: 0 },
              lostThisMonth: { count: 0 },
              recentActivities: [
                {
                  id: 'activity-1',
                  type: 'call',
                  summary: 'CEO call logged',
                  contactName: 'Mandy CEO',
                  contactId: 'contact-1',
                  createdAt: null,
                },
                {
                  id: 'activity-2',
                  type: 'stage_change',
                  summary: 'Proposal moved to review',
                  contactName: 'Board Sponsor',
                  dealId: 'deal-1',
                  createdAt: null,
                },
              ],
              topOpenDeals: [
                {
                  id: 'deal-1',
                  title: 'Board reporting rollout',
                  value: 20000,
                  currency: 'ZAR',
                  probability: 60,
                  contactName: 'Mandy CEO',
                },
              ],
            },
          }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    render(<PortalCrmPage />)

    const contactActivity = await screen.findByRole('link', { name: /CEO call logged/ })
    expect(contactActivity).toHaveAttribute('href', '/portal/contacts/contact-1')

    const dealActivity = screen.getByRole('link', { name: /Proposal moved to review/ })
    expect(dealActivity).toHaveAttribute('href', '/portal/deals/deal-1')
  })

  it('surfaces a leadership risk brief when the CRM portfolio needs action', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/dashboard') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              openDealsCount: 3,
              openDealsValue: 90000,
              weightedPipelineValue: 0,
              wonThisMonth: { count: 0, value: 0 },
              lostThisMonth: { count: 2 },
              recentActivities: [],
              topOpenDeals: [
                {
                  id: 'deal-1',
                  title: 'Board reporting rollout',
                  value: 0,
                  currency: 'ZAR',
                  probability: 0,
                  contactName: '',
                },
              ],
            },
          }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    render(<PortalCrmPage />)

    expect(await screen.findByRole('heading', { name: 'CRM leadership risk brief' })).toBeInTheDocument()
    expect(screen.getByText('4 CRM risks need leadership attention before this workspace is board-ready.')).toBeInTheDocument()
    expect(screen.getByText('Forecast confidence missing')).toBeInTheDocument()
    expect(screen.getByText('Relationship activity quiet')).toBeInTheDocument()
    expect(screen.getByText('2 lost deals this month')).toBeInTheDocument()
    expect(screen.getByText('Top deal needs value')).toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'Open forecast view to fix CRM risk: Forecast confidence missing' }))
      .toHaveAttribute('href', '/portal/deals?view=forecast')
    expect(screen.getByRole('link', { name: 'Open stale follow-up view to fix CRM risk: Relationship activity quiet' }))
      .toHaveAttribute('href', '/portal/contacts?followUp=stale')
    expect(screen.getByRole('link', { name: 'Open lost deals view to fix CRM risk: 2 lost deals this month' }))
      .toHaveAttribute('href', '/portal/deals?view=list&stage=lost')
    expect(screen.getByRole('link', { name: 'Open top deal to fix CRM risk: Top deal needs value' }))
      .toHaveAttribute('href', '/portal/deals/deal-1')
  })
})
