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
})
