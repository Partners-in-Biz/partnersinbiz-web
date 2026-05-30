import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
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
    expect(screen.getByText('1 overdue invoice')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Contacts/i }))
    expect(onSelectTab).toHaveBeenCalledWith('contacts')
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
