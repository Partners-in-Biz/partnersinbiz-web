import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import DealsPage from '@/app/(portal)/portal/deals/page'

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

describe('Portal deals page', () => {
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
      if (path === '/api/v1/crm/deals?pipelineId=pipeline-1&limit=200') {
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
            expectedCloseDate: null,
            notes: '',
            createdAt: null,
            updatedAt: null,
          },
        ])
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

    fireEvent.change(screen.getByLabelText('Search deals'), {
      target: { value: 'Ava' },
    })

    await waitFor(() => expect(screen.getByText('Growth retainer')).toBeInTheDocument())
  })
})
