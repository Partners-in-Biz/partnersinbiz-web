import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import DealDetailPage from '@/app/(portal)/portal/deals/[id]/page'

let mockDealOverrides: Record<string, unknown> = {}

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'deal-1' }),
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

jest.mock('@/components/crm/DealDrawer', () => ({
  DealDrawer: () => <div data-testid="deal-drawer" />,
}))

describe('Portal deal detail page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDealOverrides = {}
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/crm/deals/deal-1' && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as Response)
      }
      if (url === '/api/v1/crm/deals/deal-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              deal: {
                id: 'deal-1',
                orgId: 'org-1',
                title: 'Unowned expansion',
                value: 25000,
                currency: 'ZAR',
                pipelineId: 'pipeline-1',
                stageId: 'qualified',
                probability: 40,
                expectedCloseDate: null,
                notes: '',
                lineItems: [],
                stageHistory: [],
                ...mockDealOverrides,
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/pipelines/pipeline-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              id: 'pipeline-1',
              name: 'Sales pipeline',
              stages: [{ id: 'qualified', label: 'Qualified' }],
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/portal/settings/team') {
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
      if (url === '/api/v1/crm/contacts/contact-raw-id') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              contact: {
                id: 'contact-raw-id',
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/activities?contactId=contact-raw-id&limit=20') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { activities: [] } }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock
  })

  it('lets users assign an owner when deal detail is unowned', async () => {
    render(<DealDetailPage />)

    await screen.findByText('Unowned expansion')
    expect(screen.getByText('No owner assigned')).toBeInTheDocument()
    await screen.findByRole('option', { name: 'Mandy Manager - Sales lead' })

    fireEvent.change(screen.getByLabelText('Assign deal owner'), {
      target: { value: 'sales-lead-2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Assign owner to Unowned expansion' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/deals/deal-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerUid: 'sales-lead-2' }),
      })
    })

    await waitFor(() => expect(screen.getByText('Mandy Manager')).toBeInTheDocument())
  })

  it('names incomplete deal owner snapshots instead of exposing raw owner ids', async () => {
    mockDealOverrides = {
      ownerUid: 'owner-raw-id',
    }

    render(<DealDetailPage />)

    await screen.findByText('Unowned expansion')

    expect(screen.getByText('Deal owner identity missing')).toBeInTheDocument()
    expect(screen.queryByText('owner-raw-id')).not.toBeInTheDocument()
  })

  it('names incomplete deal relationship links instead of exposing raw ids', async () => {
    mockDealOverrides = {
      contactId: 'contact-raw-id',
      companyId: 'company-raw-id',
    }

    render(<DealDetailPage />)

    await screen.findByText('Unowned expansion')

    expect(await screen.findByText('Contact identity missing')).toBeInTheDocument()
    expect(screen.getByText('Company identity missing')).toBeInTheDocument()
    expect(screen.queryByText('contact-raw-id')).not.toBeInTheDocument()
    expect(screen.queryByText('company-raw-id')).not.toBeInTheDocument()
  })

  it('names incomplete stage history snapshots instead of showing generic audit gaps', async () => {
    mockDealOverrides = {
      stageHistory: [
        {
          pipelineId: 'pipeline-raw-id',
          enteredByRef: {
            uid: 'actor-raw-id',
            displayName: '',
            kind: 'human',
          },
        },
      ],
    }

    render(<DealDetailPage />)

    await screen.findByText('Unowned expansion')

    expect(screen.getByText('Stage not captured')).toBeInTheDocument()
    expect(screen.getByText('Stage time not captured · Stage actor identity missing')).toBeInTheDocument()
    expect(screen.queryByText('actor-raw-id')).not.toBeInTheDocument()
  })

  it('lets users update forecast probability from the deal command center', async () => {
    render(<DealDetailPage />)

    await screen.findByText('Unowned expansion')
    expect(screen.getAllByText('40%').length).toBeGreaterThan(0)

    fireEvent.change(screen.getByLabelText('Update forecast probability'), {
      target: { value: '65' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Update forecast probability for Unowned expansion' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/deals/deal-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ probability: 65 }),
      })
    })

    await waitFor(() => expect(screen.getAllByText('65%').length).toBeGreaterThan(0))
  })

  it('lets users set a close date from the deal command center', async () => {
    render(<DealDetailPage />)

    await screen.findByText('Unowned expansion')
    expect(screen.getByText('Close date missing')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Set expected close date'), {
      target: { value: '2026-06-15' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Update close date for Unowned expansion' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/deals/deal-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedCloseDate: '2026-06-15' }),
      })
    })

    await waitFor(() => expect(screen.queryByText('Close date missing')).not.toBeInTheDocument())
  })

  it('names missing close date in the deal details panel instead of showing a bare dash', async () => {
    render(<DealDetailPage />)

    await screen.findByText('Unowned expansion')

    expect(screen.getByText('No close date captured')).toBeInTheDocument()
    expect(screen.queryAllByText('—')).toHaveLength(0)
  })

  it('lets users add line items from the empty commercial detail panel', async () => {
    render(<DealDetailPage />)

    await screen.findByText('Unowned expansion')
    expect(screen.getByText('Commercial detail missing')).toBeInTheDocument()
    expect(screen.getByText('Make this deal quote-ready')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Add products, services, or ad-hoc pricing so leadership can review value, delivery can see scope, and the opportunity can become a client-ready quote.'
      )
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add first commercial item to Unowned expansion' }))

    expect(screen.getByTestId('deal-drawer')).toBeInTheDocument()
  })

  it('turns empty activity into a contact-link action when the deal has no contact', async () => {
    render(<DealDetailPage />)

    await screen.findByText('Unowned expansion')
    expect(screen.getByText('Relationship trail missing')).toBeInTheDocument()
    expect(screen.getByText('Anchor the first deal activity')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Link a contact before the first note, email, call, or meeting so every employee can see who owns the conversation and what happened next.'
      )
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Link contact and start activity for Unowned expansion' }))

    expect(screen.getByTestId('deal-drawer')).toBeInTheDocument()
  })

  it('turns missing stage movement into a stage update action', async () => {
    render(<DealDetailPage />)

    await screen.findByText('Unowned expansion')
    expect(screen.getByText('Pipeline progress unproven')).toBeInTheDocument()
    expect(screen.getByText('Record the first stage signal')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Confirm the current stage now so leadership can trust the forecast, reps can see where the opportunity is stuck, and future stage changes have a baseline.'
      )
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm stage baseline for Unowned expansion' }))

    expect(screen.getByTestId('deal-drawer')).toBeInTheDocument()
  })
})
