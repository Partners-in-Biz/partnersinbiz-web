import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import PipelinePage from '@/app/(admin)/admin/crm/pipeline/page'

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

describe('Admin CRM pipeline page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn((url: RequestInfo | URL) => {
      const path = String(url)
      if (path === '/api/v1/crm/pipelines') {
        return apiResponse([
          {
            id: 'pipeline-1',
            name: 'Sales pipeline',
            isDefault: true,
            stages: [{ id: 'qualified', label: 'Qualified', kind: 'open', order: 1, probability: 40 }],
          },
        ])
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
      if (path === '/api/v1/crm/deals?pipelineId=pipeline-1&limit=300') {
        return apiResponse([
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
            ownerRef: { uid: 'owner-1', displayName: 'Maya Sales', kind: 'human' },
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
        ])
      }
      if (path === '/api/v1/crm/deals/deal-2') {
        return apiResponse({ id: 'deal-2' })
      }
      return Promise.reject(new Error(`Unexpected fetch: ${path}`))
    })
  })

  it('shows resolved contact names in the deal list and search', async () => {
    render(<PipelinePage />)

    fireEvent.click(await screen.findByRole('tab', { name: /List/i }))
    await screen.findByText('Growth retainer')

    const contactLink = screen.getByRole('link', { name: 'Ava Owner' })
    expect(contactLink).toHaveAttribute('href', '/admin/crm/contacts/contact-1')

    fireEvent.change(screen.getByPlaceholderText('Search deals, company, contact id...'), {
      target: { value: 'Ava' },
    })

    await waitFor(() => expect(screen.getByText('Growth retainer')).toBeInTheDocument())
  })

  it('lets admins assign unowned pipeline deals to a team member', async () => {
    render(<PipelinePage />)

    fireEvent.click(await screen.findByRole('tab', { name: /List/i }))
    await screen.findByText('Growth retainer')

    expect(screen.getByText('Deal owner coverage')).toBeInTheDocument()
    expect(screen.getByText('1 unassigned')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show unassigned admin deals needing an owner' }))
    expect(screen.queryByText('Growth retainer')).not.toBeInTheDocument()
    expect(screen.getByText('Unowned expansion')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Unowned expansion for admin deal owner assignment' }))
    fireEvent.change(screen.getByLabelText('Assign selected admin deals to owner'), {
      target: { value: 'sales-lead-2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Assign owner to 1 selected admin deal' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/deals/deal-2', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerUid: 'sales-lead-2' }),
      })
    })

    expect(screen.getByText('0 unassigned')).toBeInTheDocument()
    const row = screen.getByText('Unowned expansion').closest('[data-admin-deal-row]')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('Mandy Manager')).toBeInTheDocument()
  })
})
