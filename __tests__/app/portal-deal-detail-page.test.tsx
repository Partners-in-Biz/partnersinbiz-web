import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import DealDetailPage from '@/app/(portal)/portal/deals/[id]/page'

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

  it('lets users add line items from the empty commercial detail panel', async () => {
    render(<DealDetailPage />)

    await screen.findByText('Unowned expansion')
    expect(screen.getByText('No line items yet. Add services or products so the deal can become a quote.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add products or services to Unowned expansion' }))

    expect(screen.getByTestId('deal-drawer')).toBeInTheDocument()
  })

  it('turns empty activity into a contact-link action when the deal has no contact', async () => {
    render(<DealDetailPage />)

    await screen.findByText('Unowned expansion')
    expect(screen.getByText('No activity yet.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Link contact to start activity for Unowned expansion' }))

    expect(screen.getByTestId('deal-drawer')).toBeInTheDocument()
  })

  it('turns missing stage movement into a stage update action', async () => {
    render(<DealDetailPage />)

    await screen.findByText('Unowned expansion')
    expect(screen.getByText('No stage movement recorded yet.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Update stage for Unowned expansion' }))

    expect(screen.getByTestId('deal-drawer')).toBeInTheDocument()
  })
})
