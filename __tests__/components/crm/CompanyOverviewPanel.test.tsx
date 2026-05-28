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

  it('does not render a blank overview for a sparse company', () => {
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
      />,
    )

    expect(screen.getByText('Business pulse')).toBeInTheDocument()
    expect(screen.getByText('Setup focus')).toBeInTheDocument()
    expect(screen.getByText('No business identity fields captured yet.')).toBeInTheDocument()
    expect(screen.getByText('No billing or contact fields captured yet.')).toBeInTheDocument()
  })
})
