import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CompanyPanel } from '@/components/crm/CompanyPanel'

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props}>{children}</a>,
}))

describe('CompanyPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('turns a missing linked company into a supplied CRM action', () => {
    const onLinkCompany = jest.fn()

    render(
      <CompanyPanel
        emptyAction={{
          label: 'Link company',
          ariaLabel: 'Link company from company card for Jane Client',
          icon: 'add_business',
          onClick: onLinkCompany,
        }}
      />,
    )

    expect(screen.getByText('No company linked')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Link company from company card for Jane Client' }))

    expect(onLinkCompany).toHaveBeenCalledTimes(1)
  })

  it('renders linked company context with readable action and business signals', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: async () => ({
        data: {
          id: 'company-1',
          orgId: 'org-1',
          name: 'Acme Growth',
          lifecycleStage: 'customer',
          tier: 'mid-market',
          healthScore: 82,
          accountManagerRef: { uid: 'owner-1', displayName: 'Maya Sales' },
          tags: [],
          notes: '',
          createdAt: null,
          updatedAt: null,
        },
      }),
    } as Response))

    render(<CompanyPanel companyId="company-1" companyName="Acme Growth" />)

    await waitFor(() => expect(screen.getByRole('link', { name: 'Open Acme Growth' })).toBeInTheDocument())

    expect(screen.getByRole('link', { name: 'Open Acme Growth' })).toHaveAttribute('href', '/portal/companies/company-1')
    expect(screen.getByText('Customer')).toBeInTheDocument()
    expect(screen.getByText('Mid-market')).toBeInTheDocument()
    expect(screen.getByText('Health 82%')).toBeInTheDocument()
    expect(screen.getByText('Maya Sales')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'View' })).not.toBeInTheDocument()
  })
})
