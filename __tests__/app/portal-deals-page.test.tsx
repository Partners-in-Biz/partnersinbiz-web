import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import DealsPage from '@/app/(portal)/portal/deals/page'

let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

jest.mock('@/components/crm/DealKanban', () => ({
  DealKanban: () => <div data-testid="deal-kanban" />,
}))

jest.mock('@/components/crm/DealDrawer', () => ({
  DealDrawer: () => <div data-testid="deal-drawer" />,
}))

jest.mock('@/components/crm/DealDetailDrawer', () => ({
  DealDetailDrawer: () => <div data-testid="deal-detail-drawer" />,
}))

function apiResponse(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: async () => ({ success: true, data }),
  } as Response)
}

let mockDealRows: unknown[] = []
let mockPipelineRows: unknown[] = []

describe('Portal deals page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSearchParams = new URLSearchParams()
    mockDealRows = [
      {
        id: 'deal-1',
        orgId: 'org-1',
        contactId: 'contact-1',
        title: 'Growth retainer',
        value: 50000,
        currency: 'ZAR',
        pipelineId: 'pipeline-1',
        stageId: 'qualified',
        ownerUid: 'owner-1',
        ownerRef: { uid: 'owner-1', displayName: 'Maya Sales' },
        expectedCloseDate: null,
        notes: '',
        createdAt: null,
        updatedAt: null,
      },
      {
        id: 'deal-2',
        orgId: 'org-1',
        contactId: '',
        title: 'Unowned expansion',
        value: 25000,
        currency: 'ZAR',
        pipelineId: 'pipeline-1',
        stageId: 'qualified',
        expectedCloseDate: null,
        notes: '',
        createdAt: null,
        updatedAt: null,
      },
    ]
    mockPipelineRows = [
      {
        id: 'pipeline-1',
        name: 'Sales pipeline',
        isDefault: true,
        stages: [
          { id: 'qualified', label: 'Qualified', kind: 'open', order: 1, probability: 40 },
          { id: 'proposal', label: 'Proposal', kind: 'open', order: 2, probability: 70 },
        ],
      },
    ]
    global.fetch = jest.fn((url: RequestInfo | URL) => {
      const path = String(url)
      if (path === '/api/v1/crm/pipelines') {
        return apiResponse(mockPipelineRows)
      }
      if (path === '/api/v1/crm/contacts?limit=200') {
        return apiResponse([
          {
            id: 'contact-1',
            orgId: 'org-1',
            name: 'Ava Owner',
            email: 'ava@example.com',
            company: 'Acme',
            source: 'manual',
            type: 'lead',
            stage: 'contacted',
            tags: [],
            notes: '',
            assignedTo: '',
            capturedFromId: '',
            website: '',
            phone: '',
            createdAt: null,
            updatedAt: null,
            lastContactedAt: null,
          },
        ])
      }
      if (path === '/api/v1/portal/settings/team') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            members: [
              {
                uid: 'sales-lead-2',
                firstName: 'Mandy',
                lastName: 'Manager',
                jobTitle: 'Sales lead',
                role: 'admin',
              },
            ],
          }),
        } as Response)
      }
      if (path === '/api/v1/crm/deals?pipelineId=pipeline-1&limit=200') {
        return apiResponse(mockDealRows)
      }
      if (path === '/api/v1/crm/deals/deal-2') {
        return apiResponse({ id: 'deal-2' })
      }
      return Promise.reject(new Error(`Unexpected fetch: ${path}`))
    })
  })

  it('shows resolved contact names in the deal list and search', async () => {
    render(<DealsPage />)

    fireEvent.click(await screen.findByRole('tab', { name: /List/i }))
    await screen.findByText('Growth retainer')

    const contactLink = screen.getByRole('link', { name: 'Ava Owner' })
    expect(contactLink).toHaveAttribute('href', '/portal/contacts/contact-1')

    const unlinkedRow = screen.getByText('Unowned expansion').closest('[data-deal-row]')
    expect(unlinkedRow).not.toBeNull()
    expect(within(unlinkedRow as HTMLElement).getByText('No contact linked')).toBeInTheDocument()
    expect(within(unlinkedRow as HTMLElement).queryByText('—')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search deals'), {
      target: { value: 'Ava' },
    })

    await waitFor(() => expect(screen.getByText('Growth retainer')).toBeInTheDocument())
  })

  it('names missing deal values and renders zero values as explicit commercial data', async () => {
    mockSearchParams = new URLSearchParams('view=list')
    mockDealRows = [
      {
        id: 'deal-zero',
        orgId: 'org-1',
        contactId: 'contact-1',
        title: 'Zero value discovery',
        value: 0,
        currency: 'ZAR',
        pipelineId: 'pipeline-1',
        stageId: 'qualified',
        expectedCloseDate: '2026-06-15',
        notes: '',
        createdAt: null,
        updatedAt: null,
      },
      {
        id: 'deal-missing-value',
        orgId: 'org-1',
        contactId: 'contact-1',
        title: 'Unpriced implementation',
        currency: 'ZAR',
        pipelineId: 'pipeline-1',
        stageId: 'qualified',
        expectedCloseDate: '2026-07-15',
        notes: '',
        createdAt: null,
        updatedAt: null,
      },
    ]

    render(<DealsPage />)

    const zeroRow = (await screen.findByText('Zero value discovery')).closest('[data-deal-row]')
    const missingValueRow = screen.getByText('Unpriced implementation').closest('[data-deal-row]')
    expect(zeroRow).not.toBeNull()
    expect(missingValueRow).not.toBeNull()

    expect(within(zeroRow as HTMLElement).getAllByText('R 0').length).toBeGreaterThanOrEqual(2)
    expect(within(missingValueRow as HTMLElement).getByText('No value captured')).toBeInTheDocument()
    expect(within(missingValueRow as HTMLElement).getByText('R 0')).toBeInTheDocument()
    expect(screen.queryByText('ZAR undefined')).not.toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  it('names unpriced pipeline summaries instead of presenting missing values as zero', async () => {
    mockSearchParams = new URLSearchParams('view=list')
    mockDealRows = [
      {
        id: 'deal-missing-value',
        orgId: 'org-1',
        contactId: 'contact-1',
        title: 'Unpriced implementation',
        currency: 'ZAR',
        pipelineId: 'pipeline-1',
        stageId: 'qualified',
        expectedCloseDate: '2026-07-15',
        notes: '',
        createdAt: null,
        updatedAt: null,
      },
    ]

    render(<DealsPage />)

    expect(await screen.findByText('Unpriced implementation')).toBeInTheDocument()
    expect(screen.getByText('No priced pipeline')).toBeInTheDocument()
    expect(screen.getAllByText('Forecast value needed').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('1 open deal needs value').length).toBeGreaterThanOrEqual(2)
  })

  it('names empty pipeline summaries separately from unpriced forecast work', async () => {
    mockSearchParams = new URLSearchParams('view=list')
    mockDealRows = []

    render(<DealsPage />)

    expect(await screen.findByRole('heading', { name: 'No deals found.' })).toBeInTheDocument()
    expect(screen.getByText('No open pipeline')).toBeInTheDocument()
    expect(screen.getByText('No forecastable deals')).toBeInTheDocument()
    expect(screen.queryByText('Forecast value needed')).not.toBeInTheDocument()
  })

  it('surfaces unassigned deals as a pipeline accountability lens', async () => {
    render(<DealsPage />)

    fireEvent.click(await screen.findByRole('tab', { name: /List/i }))
    await screen.findByText('Growth retainer')
    expect(screen.getByText('Unowned expansion')).toBeInTheDocument()

    expect(screen.getByText('Deal owner coverage')).toBeInTheDocument()
    expect(screen.getByText('1 unassigned')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show unassigned deals needing an owner' }))

    expect(screen.queryByText('Growth retainer')).not.toBeInTheDocument()
    expect(screen.getByText('Unowned expansion')).toBeInTheDocument()
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
  })

  it('opens directly to unassigned deals from CRM reports', async () => {
    mockSearchParams = new URLSearchParams('view=list&owner=unassigned')

    render(<DealsPage />)

    expect(await screen.findByRole('tab', { name: /List/i })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('Unowned expansion')).toBeInTheDocument()
    expect(screen.queryByText('Growth retainer')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show all deals' })).toBeInTheDocument()
  })

  it('treats an empty unassigned deal lens as clean pipeline accountability', async () => {
    mockSearchParams = new URLSearchParams('view=list&owner=unassigned')
    mockDealRows = [
      {
        id: 'deal-owned',
        orgId: 'org-1',
        contactId: 'contact-1',
        title: 'Owned expansion',
        value: 45000,
        currency: 'ZAR',
        pipelineId: 'pipeline-1',
        stageId: 'qualified',
        ownerUid: 'owner-1',
        ownerRef: { uid: 'owner-1', displayName: 'Maya Sales' },
        expectedCloseDate: null,
        notes: '',
        createdAt: null,
        updatedAt: null,
      },
    ]

    render(<DealsPage />)

    expect(await screen.findByRole('heading', { name: 'No unassigned deals.' })).toBeInTheDocument()
    expect(screen.getByText('Every open deal in this lens has an owner.')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Show all deals' }).length).toBeGreaterThan(0)
  })

  it('opens directly to a rep-owned deal lens from CRM reports', async () => {
    mockSearchParams = new URLSearchParams('view=list&owner=owner-1')

    render(<DealsPage />)

    expect(await screen.findByRole('tab', { name: /List/i })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('Growth retainer')).toBeInTheDocument()
    expect(screen.queryByText('Unowned expansion')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show all deals' })).toBeInTheDocument()
  })

  it('opens the create drawer directly from CRM command-center create links', async () => {
    mockSearchParams = new URLSearchParams('create=deal')

    render(<DealsPage />)

    expect(await screen.findByTestId('deal-drawer')).toBeInTheDocument()
  })

  it('assigns selected unassigned deals to a team member', async () => {
    render(<DealsPage />)

    fireEvent.click(await screen.findByRole('tab', { name: /List/i }))
    await screen.findByText('Growth retainer')
    fireEvent.click(screen.getByRole('button', { name: 'Show unassigned deals needing an owner' }))

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Unowned expansion for deal owner assignment' }))
    fireEvent.change(screen.getByLabelText('Assign selected deals to owner'), {
      target: { value: 'sales-lead-2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Assign owner to 1 selected deal' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/deals/deal-2', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerUid: 'sales-lead-2' }),
      })
    })

    expect(screen.getByText('0 unassigned')).toBeInTheDocument()
    const row = screen.getByText('Unowned expansion').closest('[data-deal-row]')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('Mandy Manager')).toBeInTheDocument()
  })

  it('turns an empty forecast into a create-deal action', async () => {
    mockDealRows = []

    render(<DealsPage />)

    fireEvent.click(await screen.findByRole('tab', { name: /Forecast/i }))

    expect(await screen.findByText('No forecastable deals yet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /create forecastable deal/i }))

    expect(screen.getByTestId('deal-drawer')).toBeInTheDocument()
  })

  it('does not leave the forecast stuck on skeletons when no pipeline exists yet', async () => {
    mockSearchParams = new URLSearchParams('view=forecast')
    mockPipelineRows = []
    mockDealRows = []

    render(<DealsPage />)

    expect(await screen.findByText('No forecastable deals yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create forecastable deal/i })).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/crm/deals?pipelineId=pipeline-1&limit=200')
  })

  it('opens directly to forecast deals missing close dates from CRM reports', async () => {
    mockSearchParams = new URLSearchParams('view=forecast&focus=no-close-date')
    mockDealRows = [
      {
        id: 'deal-with-date',
        orgId: 'org-1',
        contactId: 'contact-1',
        title: 'Dated expansion',
        value: 50000,
        currency: 'ZAR',
        pipelineId: 'pipeline-1',
        stageId: 'qualified',
        ownerUid: 'owner-1',
        ownerRef: { uid: 'owner-1', displayName: 'Maya Sales' },
        expectedCloseDate: '2026-06-15',
        notes: '',
        createdAt: null,
        updatedAt: null,
      },
      {
        id: 'deal-no-date',
        orgId: 'org-1',
        contactId: 'contact-1',
        title: 'No close date opportunity',
        value: 25000,
        currency: 'ZAR',
        pipelineId: 'pipeline-1',
        stageId: 'qualified',
        ownerUid: 'owner-1',
        ownerRef: { uid: 'owner-1', displayName: 'Maya Sales' },
        expectedCloseDate: null,
        notes: '',
        createdAt: null,
        updatedAt: null,
      },
    ]

    render(<DealsPage />)

    expect(await screen.findByRole('tab', { name: /Forecast/i })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('No close date opportunity')).toBeInTheDocument()
    expect(screen.queryByText('Dated expansion')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Focus deals missing close dates' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('No close date captured')).toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  it('treats an empty missing-close-date forecast lens as clean forecast hygiene', async () => {
    mockSearchParams = new URLSearchParams('view=forecast&focus=no-close-date')
    mockDealRows = [
      {
        id: 'deal-with-date',
        orgId: 'org-1',
        contactId: 'contact-1',
        title: 'Dated expansion',
        value: 50000,
        currency: 'ZAR',
        pipelineId: 'pipeline-1',
        stageId: 'qualified',
        ownerUid: 'owner-1',
        ownerRef: { uid: 'owner-1', displayName: 'Maya Sales' },
        expectedCloseDate: '2026-06-15',
        notes: '',
        createdAt: null,
        updatedAt: null,
      },
    ]

    render(<DealsPage />)

    expect(await screen.findByRole('heading', { name: 'No deals missing close dates.' })).toBeInTheDocument()
    expect(screen.getByText('Every open opportunity in this forecast lens has an expected close date.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show full forecast' }))

    expect(await screen.findByText('Dated expansion')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Focus all deals' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens directly to a deal stage lens from CRM reports', async () => {
    mockSearchParams = new URLSearchParams('view=list&pipelineId=pipeline-1&stage=qualified')
    mockDealRows = [
      {
        id: 'deal-qualified',
        orgId: 'org-1',
        contactId: 'contact-1',
        title: 'Qualified opportunity',
        value: 50000,
        currency: 'ZAR',
        pipelineId: 'pipeline-1',
        stageId: 'qualified',
        ownerUid: 'owner-1',
        ownerRef: { uid: 'owner-1', displayName: 'Maya Sales' },
        expectedCloseDate: '2026-06-15',
        notes: '',
        createdAt: null,
        updatedAt: null,
      },
      {
        id: 'deal-proposal',
        orgId: 'org-1',
        contactId: 'contact-1',
        title: 'Proposal opportunity',
        value: 25000,
        currency: 'ZAR',
        pipelineId: 'pipeline-1',
        stageId: 'proposal',
        ownerUid: 'owner-1',
        ownerRef: { uid: 'owner-1', displayName: 'Maya Sales' },
        expectedCloseDate: '2026-07-15',
        notes: '',
        createdAt: null,
        updatedAt: null,
      },
    ]

    render(<DealsPage />)

    expect(await screen.findByRole('tab', { name: /List/i })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('Qualified opportunity')).toBeInTheDocument()
    expect(screen.queryByText('Proposal opportunity')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Qualified' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('treats an empty stage deal lens as a clean pipeline stage', async () => {
    mockSearchParams = new URLSearchParams('view=list&pipelineId=pipeline-1&stage=proposal')
    mockDealRows = [
      {
        id: 'deal-qualified',
        orgId: 'org-1',
        contactId: 'contact-1',
        title: 'Qualified opportunity',
        value: 50000,
        currency: 'ZAR',
        pipelineId: 'pipeline-1',
        stageId: 'qualified',
        ownerUid: 'owner-1',
        ownerRef: { uid: 'owner-1', displayName: 'Maya Sales' },
        expectedCloseDate: '2026-06-15',
        notes: '',
        createdAt: null,
        updatedAt: null,
      },
    ]

    render(<DealsPage />)

    expect(await screen.findByRole('heading', { name: 'No deals in Proposal.' })).toBeInTheDocument()
    expect(screen.getByText('This pipeline stage is clear for the current deal lens.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show all stages' }))

    expect(await screen.findByText('Qualified opportunity')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All stages' })).toHaveAttribute('aria-pressed', 'true')
  })
})
