import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { CompanyOverviewPanel } from '@/components/crm/CompanyOverviewPanel'
import type { Company } from '@/lib/companies/types'

jest.mock('recharts', () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  const svgPassthrough = ({ children }: { children?: React.ReactNode }) => <svg>{children}</svg>
  return {
    ResponsiveContainer: passthrough,
    BarChart: svgPassthrough,
    Bar: passthrough,
    AreaChart: svgPassthrough,
    Area: passthrough,
    PieChart: svgPassthrough,
    Pie: passthrough,
    Cell: passthrough,
    XAxis: passthrough,
    YAxis: passthrough,
    CartesianGrid: passthrough,
    Tooltip: passthrough,
    ReferenceLine: passthrough,
    defs: passthrough,
    linearGradient: passthrough,
    stop: passthrough,
  }
})

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: 'company-1',
    orgId: 'org-1',
    name: 'Acme Studio',
    website: 'https://acme.example',
    lifecycleStage: 'customer',
    tier: 'smb',
    industry: 'Creative services',
    billingEmail: 'accounts@acme.example',
    healthScore: 82,
    tags: [],
    notes: '',
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

describe('CompanyOverviewPanel', () => {
  it('renders a command dashboard from company command-center data', () => {
    const onSelectTab = jest.fn()

    render(
      <CompanyOverviewPanel
        company={company()}
        onSelectTab={onSelectTab}
        center={{
          summary: {
            contacts: 3,
            deals: 2,
            projects: 1,
            documents: 4,
            serviceWorkspaces: 1,
            relationships: 2,
            quotes: 1,
            invoices: 1,
            orders: 1,
            openOrders: 1,
            lowStockItems: 0,
            overdueInvoices: 1,
          },
          analytics: {
            accountValue: 9500,
            weightedPipelineValue: 4200,
            trackedOrderValue: 1800,
            openProjectCount: 1,
            activeServiceCount: 1,
            collaborationCount: 2,
            riskSignals: ['1 overdue invoice'],
          },
          deals: [{ id: 'deal-1', title: 'Retainer expansion', value: 7700, status: 'open', updatedAt: '2026-05-26T00:00:00.000Z' }],
          projects: [{ id: 'project-1', name: 'Website sprint', status: 'active', updatedAt: '2026-05-25T00:00:00.000Z' }],
          documents: [{ id: 'doc-1', title: 'Proposal', status: 'client_review', updatedAt: '2026-05-24T00:00:00.000Z' }],
          activities: [{ id: 'activity-1', summary: 'Discovery call completed', type: 'call', createdAt: '2026-05-27T00:00:00.000Z' }],
        }}
      />,
    )

    expect(screen.getByText('Business pulse')).toBeInTheDocument()
    expect(screen.getByText('Command widgets')).toBeInTheDocument()
    expect(screen.getByText('Revenue mix')).toBeInTheDocument()
    expect(screen.getByText('Business mix')).toBeInTheDocument()
    expect(screen.getByText('Risk map')).toBeInTheDocument()
    expect(screen.getByText('Latest movement')).toBeInTheDocument()
    expect(screen.getByText('Retainer expansion')).toBeInTheDocument()
    expect(screen.getAllByText('1 overdue invoice').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /Contacts/i }))
    expect(onSelectTab).toHaveBeenCalledWith('contacts')
  })

  it('names command widgets as account-scoped tab actions', () => {
    const onSelectTab = jest.fn()

    render(
      <CompanyOverviewPanel
        company={company()}
        onSelectTab={onSelectTab}
        center={{
          summary: {
            contacts: 3,
            deals: 0,
            relationships: 1,
          },
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open Contacts tab for Acme Studio with 3 records' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Deals tab for Acme Studio with 0 records' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Relationships tab for Acme Studio with 1 record' }))

    expect(onSelectTab).toHaveBeenCalledWith('contacts')
    expect(onSelectTab).toHaveBeenCalledWith('deals')
    expect(onSelectTab).toHaveBeenCalledWith('relationships')
    expect(screen.queryByRole('button', { name: /^Deals 0 No records yet$/ })).not.toBeInTheDocument()
  })

  it('renders latest movement statuses as readable CRM labels', () => {
    render(
      <CompanyOverviewPanel
        company={company()}
        center={{
          documents: [{ id: 'doc-1', title: 'Proposal', status: 'client_review', updatedAt: '2026-05-24T00:00:00.000Z' }],
          orders: [{ id: 'order-1', orderNumber: 'ORD-001', status: 'pending_approval', updatedAt: '2026-05-25T00:00:00.000Z' }],
          projects: [{ id: 'project-1', name: 'Website sprint', status: 'in_progress', updatedAt: '2026-05-26T00:00:00.000Z' }],
        }}
      />,
    )

    expect(screen.getByText('Client review')).toBeInTheDocument()
    expect(screen.getByText('Pending approval')).toBeInTheDocument()
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.queryByText('client_review')).not.toBeInTheDocument()
    expect(screen.queryByText('pending_approval')).not.toBeInTheDocument()
    expect(screen.queryByText('in_progress')).not.toBeInTheDocument()
  })

  it('names unreadable latest movement dates as metadata cleanup work', () => {
    render(
      <CompanyOverviewPanel
        company={company()}
        center={{
          deals: [
            {
              id: 'deal-invalid-date',
              title: 'Expansion timing',
              value: 12000,
              status: 'open',
              updatedAt: { _seconds: Number.NaN } as never,
            },
          ],
        }}
      />,
    )

    expect(screen.getByText('Expansion timing')).toBeInTheDocument()
    expect(screen.getByText(/deal · Movement date needs review/)).toBeInTheDocument()
    expect(screen.queryByText('Invalid Date')).not.toBeInTheDocument()
    expect(screen.queryByText(/deal · No date/)).not.toBeInTheDocument()
  })

  it('renders account lifecycle and tier context as readable labels', () => {
    render(
      <CompanyOverviewPanel
        company={company({
          lifecycleStage: 'customer',
          tier: 'mid-market',
        })}
      />,
    )

    expect(screen.getByText('Customer · Mid market · Creative services')).toBeInTheDocument()
    expect(screen.queryByText('customer · mid-market · Creative services')).not.toBeInTheDocument()
  })

  it('summarizes account risk on the overview with direct leadership actions', () => {
    const onSelectTab = jest.fn()
    const onEditCompany = jest.fn()

    render(
      <CompanyOverviewPanel
        company={company({
          accountManagerUid: undefined,
          accountManagerRef: undefined,
          website: undefined,
          healthScore: 42,
        })}
        center={{
          summary: {
            contacts: 0,
            deals: 0,
            openOrders: 2,
            lowStockItems: 1,
            overdueInvoices: 1,
          },
          analytics: {
            weightedPipelineValue: 0,
            riskSignals: ['1 overdue invoice', '1 low-stock item'],
          },
        }}
        onSelectTab={onSelectTab}
        onEditCompany={onEditCompany}
      />,
    )

    const brief = screen.getByRole('region', { name: 'Account risk brief' })
    expect(within(brief).getByRole('heading', { name: 'Account risk brief' })).toBeInTheDocument()
    expect(within(brief).getByText('7 account risks need leadership attention before Acme Studio is board-ready.')).toBeInTheDocument()
    expect(within(brief).getByText('No account owner')).toBeInTheDocument()
    expect(within(brief).getByText('Profile below 70%')).toBeInTheDocument()
    expect(within(brief).getByText('No stakeholders linked')).toBeInTheDocument()
    expect(within(brief).getByText('No active pipeline')).toBeInTheDocument()
    expect(within(brief).getByText('1 overdue invoice')).toBeInTheDocument()
    expect(within(brief).getByText('2 open orders')).toBeInTheDocument()
    expect(within(brief).getByText('1 low-stock item')).toBeInTheDocument()

    fireEvent.click(within(brief).getByRole('button', { name: 'Assign account owner for Acme Studio from account risk brief' }))
    fireEvent.click(within(brief).getByRole('button', { name: 'Improve profile completeness for Acme Studio from account risk brief' }))
    expect(onEditCompany).toHaveBeenCalledTimes(2)

    fireEvent.click(within(brief).getByRole('button', { name: 'Review stakeholders for Acme Studio from account risk brief' }))
    fireEvent.click(within(brief).getByRole('button', { name: 'Review pipeline for Acme Studio from account risk brief' }))
    fireEvent.click(within(brief).getByRole('button', { name: 'Review overdue invoices for Acme Studio from account risk brief' }))
    fireEvent.click(within(brief).getByRole('button', { name: 'Review fulfillment orders for Acme Studio from account risk brief' }))
    fireEvent.click(within(brief).getByRole('button', { name: 'Review inventory risk for Acme Studio from account risk brief' }))
    expect(onSelectTab).toHaveBeenNthCalledWith(1, 'contacts')
    expect(onSelectTab).toHaveBeenNthCalledWith(2, 'deals')
    expect(onSelectTab).toHaveBeenNthCalledWith(3, 'invoices')
    expect(onSelectTab).toHaveBeenNthCalledWith(4, 'orders')
    expect(onSelectTab).toHaveBeenNthCalledWith(5, 'inventory')
  })

  it('turns captured account contact fields into direct action links', () => {
    render(
      <CompanyOverviewPanel
        company={company({
          website: 'acme.example',
          phone: '+27821234567',
          billingEmail: 'accounts@acme.example',
          accountsContact: {
            name: 'Morgan Accounts',
            email: 'morgan.accounts@acme.example',
            phone: '+27827654321',
          },
        })}
      />,
    )

    const website = screen.getByRole('link', { name: 'acme.example' })
    expect(website).toHaveAttribute('href', 'https://acme.example')
    expect(website).toHaveAttribute('target', '_blank')
    expect(website).toHaveAttribute('rel', 'noopener noreferrer')

    expect(screen.getByRole('link', { name: '+27821234567' })).toHaveAttribute('href', 'tel:+27821234567')
    expect(screen.getByRole('link', { name: 'accounts@acme.example' })).toHaveAttribute('href', 'mailto:accounts@acme.example')
    expect(screen.getByRole('link', { name: 'morgan.accounts@acme.example' })).toHaveAttribute('href', 'mailto:morgan.accounts@acme.example')
    expect(screen.getByRole('link', { name: '+27827654321' })).toHaveAttribute('href', 'tel:+27827654321')
  })

  it('turns sparse identity and billing blocks into profile-capture actions', () => {
    const onEditCompany = jest.fn()

    render(
      <CompanyOverviewPanel
        company={company({
          website: undefined,
          lifecycleStage: undefined,
          tier: undefined,
          industry: undefined,
          billingEmail: undefined,
          healthScore: undefined,
        })}
        onEditCompany={onEditCompany}
      />,
    )

    expect(screen.getByText('Business pulse')).toBeInTheDocument()
    expect(screen.getByText('Setup focus')).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: 'Capture account identity.' })).toBeInTheDocument()
    expect(screen.getByText('Add legal name, trading name, lifecycle stage, industry, size, and website so the account is useful in reviews.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit account identity for Acme Studio' }))

    expect(screen.getByRole('heading', { name: 'Capture billing and contact detail.' })).toBeInTheDocument()
    expect(screen.getByText('Add phone, billing email, registration, VAT, accounts contact, signatory, and invoice notes before proposals become admin work.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit billing and contact details for Acme Studio' }))

    expect(onEditCompany).toHaveBeenCalledTimes(2)
  })

  it('turns setup focus gaps into a company profile editing action', () => {
    const onEditCompany = jest.fn()

    render(
      <CompanyOverviewPanel
        company={company({
          website: undefined,
          lifecycleStage: undefined,
          tier: undefined,
          industry: undefined,
          billingEmail: undefined,
          healthScore: undefined,
        })}
        onEditCompany={onEditCompany}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit company profile to capture Website' }))

    expect(onEditCompany).toHaveBeenCalledTimes(1)
  })

  it('turns an empty latest movement panel into an activity review action', () => {
    const onSelectTab = jest.fn()

    render(
      <CompanyOverviewPanel
        company={company()}
        center={{
          summary: {
            contacts: 0,
            deals: 0,
            projects: 0,
            documents: 0,
            serviceWorkspaces: 0,
            relationships: 0,
            quotes: 0,
            invoices: 0,
            orders: 0,
          },
          activities: [],
          deals: [],
          projects: [],
          documents: [],
          orders: [],
        }}
        onSelectTab={onSelectTab}
      />,
    )

    expect(screen.getByText('Account history quiet')).toBeInTheDocument()
    expect(screen.getByText('Start the next account signal')).toBeInTheDocument()
    expect(
      screen.getByText(
        'No recent activity, deal movement, document, project, or order is visible yet. Review activity so leadership can see the next account touchpoint.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Review activity for Acme Studio' }))

    expect(onSelectTab).toHaveBeenCalledWith('activity')
  })

  it('turns a clear operational pulse into a risk review action', () => {
    const onSelectTab = jest.fn()

    render(
      <CompanyOverviewPanel
        company={company()}
        center={{
          summary: {
            openOrders: 0,
            lowStockItems: 0,
            overdueInvoices: 0,
          },
          analytics: {
            riskSignals: [],
          },
        }}
        onSelectTab={onSelectTab}
      />,
    )

    expect(screen.getByText('Risk watch clear')).toBeInTheDocument()
    expect(screen.getByText('Keep pulse risk reviewable')).toBeInTheDocument()
    expect(
      screen.getByText(
        'No active risk signals are flagged in the account pulse. Review invoices so finance, delivery, and operations stay checked before leadership sees surprises.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Review operational risk for Acme Studio' }))

    expect(onSelectTab).toHaveBeenCalledWith('invoices')
  })

  it('turns an empty revenue mix chart into a commercial review action', () => {
    const onSelectTab = jest.fn()

    render(
      <CompanyOverviewPanel
        company={company()}
        center={{
          summary: {
            deals: 0,
            quotes: 0,
            invoices: 0,
            orders: 0,
          },
          deals: [],
          quotes: [],
          invoices: [],
          orders: [],
        }}
        onSelectTab={onSelectTab}
      />,
    )

    expect(screen.getByText('Revenue model missing')).toBeInTheDocument()
    expect(screen.getByText('Build the first commercial signal')).toBeInTheDocument()
    expect(
      screen.getByText(
        'No deals, quotes, invoices, or orders are linked to this account yet. Review deals so pipeline value, quote readiness, and revenue history become visible to leadership.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Review commercial records for Acme Studio' }))

    expect(onSelectTab).toHaveBeenCalledWith('deals')
  })

  it('turns an empty business mix chart into an account linking action', () => {
    const onSelectTab = jest.fn()

    render(
      <CompanyOverviewPanel
        company={company()}
        center={{
          summary: {
            contacts: 0,
            deals: 0,
            projects: 0,
            documents: 0,
            serviceWorkspaces: 0,
            relationships: 0,
            quotes: 0,
            invoices: 0,
            orders: 0,
            shipments: 0,
            inventoryItems: 0,
          },
        }}
        onSelectTab={onSelectTab}
      />,
    )

    expect(screen.getByText('Operating footprint missing')).toBeInTheDocument()
    expect(screen.getByText('Link the first account record')).toBeInTheDocument()
    expect(
      screen.getByText(
        'No contacts, deals, delivery work, documents, finance, or commerce records are linked yet. Start with contacts so every team can see who owns the relationship.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Review linked contacts for Acme Studio' }))

    expect(onSelectTab).toHaveBeenCalledWith('contacts')
  })

  it('turns an empty risk map into a finance risk review action', () => {
    const onSelectTab = jest.fn()

    render(
      <CompanyOverviewPanel
        company={company()}
        center={{
          summary: {
            openOrders: 0,
            lowStockItems: 0,
            overdueInvoices: 0,
            projects: 0,
            serviceWorkspaces: 0,
          },
          analytics: {
            openProjectCount: 0,
            activeServiceCount: 0,
            riskSignals: [],
          },
        }}
        onSelectTab={onSelectTab}
      />,
    )

    expect(screen.getByText('Risk coverage clear')).toBeInTheDocument()
    expect(screen.getByText('Keep account risk monitored')).toBeInTheDocument()
    expect(
      screen.getByText(
        'No overdue invoices, low stock, open orders, projects, or service risks are active right now. Review invoices so finance risk stays visible before it surprises leadership.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Review risk records for Acme Studio' }))

    expect(onSelectTab).toHaveBeenCalledWith('invoices')
  })

  it('labels parent-account navigation with the resolved parent company name', () => {
    const companyWithParent = company({
      parentCompanyId: 'co-parent',
      parentCompanyName: 'Parent Co',
    })

    render(<CompanyOverviewPanel company={companyWithParent} />)

    const link = screen.getByRole('link', { name: /open parent co/i })
    expect(link).toHaveAttribute('href', '/portal/companies/co-parent')
    expect(screen.queryByText('View parent company')).not.toBeInTheDocument()
  })
})
