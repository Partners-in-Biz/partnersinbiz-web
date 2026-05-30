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

  it('turns the empty activity panel into a contact activity action', async () => {
    render(<PortalCrmPage />)

    expect(await screen.findByRole('heading', { name: 'No relationship activity logged yet.' })).toBeInTheDocument()
    expect(screen.getByText('Open the stale follow-up lens to give the team a working list for calls, emails, meetings, and notes.')).toBeInTheDocument()

    const contactsLink = screen.getByRole('link', { name: 'Open contacts to log CRM activity from the command center' })
    expect(contactsLink).toHaveAttribute('href', '/portal/contacts?followUp=stale')
  })
})
