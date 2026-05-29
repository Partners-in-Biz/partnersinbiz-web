import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ContactDealsPanel } from '@/components/crm/ContactDealsPanel'
import type { Deal } from '@/lib/crm/types'

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

jest.mock('@/components/crm/DealDrawer', () => ({
  DealDrawer: ({
    defaultContactLabel,
    onSaved,
  }: {
    defaultContactLabel?: string
    onSaved: (dealId: string) => void
  }) => (
    <div>
      <p>Drawer contact label: {defaultContactLabel || 'missing'}</p>
      <button type="button" onClick={() => onSaved('deal-new')}>
        Save mocked deal
      </button>
    </div>
  ),
}))

const mockFetch = jest.fn()
global.fetch = mockFetch

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeDeal = (overrides: Partial<Deal> = {}): Deal => ({
  id: 'deal-1',
  orgId: 'org-1',
  contactId: 'contact-1',
  title: 'Test Deal',
  value: 5000,
  currency: 'ZAR',
  // A3 W2-F: pipelineId + stageId replace the old stage field
  pipelineId: 'pl-default',
  stageId: 'discovery',
  expectedCloseDate: null,
  notes: '',
  createdAt: null,
  updatedAt: null,
  ...overrides,
})

function apiResponse(deals: Deal[]) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ success: true, data: deals }),
  })
}

function pipelinesResponse() {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      success: true,
      data: [
        {
          id: 'pl-default',
          name: 'Default pipeline',
          isDefault: true,
          stages: [{ id: 'discovery', label: 'Discovery', kind: 'open', order: 1, probability: 25 }],
        },
      ],
    }),
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockFetch.mockReset()
})

describe('ContactDealsPanel', () => {
  it('renders deal titles and values', async () => {
    const deals: Deal[] = [
      makeDeal({ id: 'd1', title: 'Alpha Deal', stageId: 'discovery', value: 10000, currency: 'ZAR' }),
      makeDeal({ id: 'd2', title: 'Beta Deal',  stageId: 'proposal',  value: 25000, currency: 'ZAR' }),
      makeDeal({ id: 'd3', title: 'Gamma Deal', stageId: 'won',       value:  5000, currency: 'ZAR' }),
    ]
    mockFetch.mockReturnValue(apiResponse(deals))

    render(<ContactDealsPanel contactId="contact-1" />)

    await waitFor(() => {
      expect(screen.getByText('Alpha Deal')).toBeInTheDocument()
      expect(screen.getByText('Beta Deal')).toBeInTheDocument()
      expect(screen.getByText('Gamma Deal')).toBeInTheDocument()
    })

    // Stage chips show stageId text (W3-H will resolve to pretty labels)
    expect(screen.getByText('discovery')).toBeInTheDocument()
    expect(screen.getByText('proposal')).toBeInTheDocument()
    expect(screen.getByText('won')).toBeInTheDocument()

    // Values
    expect(screen.getAllByText(/10[\s ,.]?000/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/25[\s ,.]?000/).length).toBeGreaterThan(0)
  })

  it('shows empty state when no deals are returned', async () => {
    mockFetch.mockReturnValue(apiResponse([]))
    render(<ContactDealsPanel contactId="contact-1" />)
    await waitFor(() => {
      expect(screen.getByText('No deals linked to this contact yet.')).toBeInTheDocument()
    })
  })

  it('calls the correct API endpoint with the contactId', async () => {
    mockFetch.mockReturnValue(apiResponse([]))
    render(<ContactDealsPanel contactId="abc-123" />)
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('contactId=abc-123'),
      )
    })
  })

  it('shows loading skeletons while fetching', () => {
    // Never resolve so loading stays true
    mockFetch.mockReturnValue(new Promise(() => {}))
    const { container } = render(<ContactDealsPanel contactId="contact-1" />)
    expect(container.querySelectorAll('.pib-skeleton').length).toBeGreaterThan(0)
  })

  it('renders deal count in the panel header', async () => {
    const deals = [
      makeDeal({ id: 'd1', title: 'Deal One', stageId: 'proposal' }),
      makeDeal({ id: 'd2', title: 'Deal Two', stageId: 'negotiation' }),
    ]
    mockFetch.mockReturnValue(apiResponse(deals))
    render(<ContactDealsPanel contactId="contact-1" />)
    await waitFor(() => {
      expect(screen.getByText('2 records')).toBeInTheDocument()
    })
  })

  it('summarizes the contact pipeline and links each deal title to its detail page', async () => {
    const deal = makeDeal({ id: 'deal-99', title: 'Linked Deal', stageId: 'discovery' })
    mockFetch.mockReturnValue(apiResponse([deal]))
    render(<ContactDealsPanel contactId="contact-1" />)
    await waitFor(() => {
      const link = screen.getByRole('link', { name: 'Linked Deal' })
      expect(link).toHaveAttribute('href', '/portal/deals/deal-99')
    })
    expect(screen.getByText('Relationship pipeline')).toBeInTheDocument()
    expect(screen.getByText('Open deals')).toBeInTheDocument()
    expect(screen.getByText('Weighted value')).toBeInTheDocument()
  })

  it('renders a newly created contact deal from the standard deal response envelope', async () => {
    const savedDeal = makeDeal({ id: 'deal-new', title: 'Fresh relationship deal', value: 12000 })
    mockFetch.mockImplementation((url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url)
      if (path.startsWith('/api/v1/crm/deals?contactId=')) return apiResponse([])
      if (path === '/api/v1/crm/pipelines') return pipelinesResponse()
      if (path === '/api/v1/crm/deals' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { id: 'deal-new' } }),
        })
      }
      if (path === '/api/v1/crm/deals/deal-new') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { deal: savedDeal } }),
        })
      }
      return Promise.reject(new Error(`Unexpected fetch: ${path}`))
    })

    render(<ContactDealsPanel contactId="contact-1" orgId="org-1" />)
    await waitFor(() => expect(screen.getByText('No deals linked to this contact yet.')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /New deal/i }))
    fireEvent.click(await screen.findByRole('button', { name: /Save mocked deal/i }))

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Fresh relationship deal' })).toHaveAttribute('href', '/portal/deals/deal-new')
    })
    expect(screen.getByText('1 record')).toBeInTheDocument()
  })

  it('opens the new deal drawer with the readable contact name', async () => {
    mockFetch.mockReturnValue(apiResponse([]))

    render(<ContactDealsPanel contactId="contact-1" contactName="Ava Owner" />)
    await waitFor(() => expect(screen.getByText('No deals linked to this contact yet.')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /New deal/i }))

    expect(screen.getByText('Drawer contact label: Ava Owner')).toBeInTheDocument()
  })

  it('opens the deal drawer from the empty-state first-deal action', async () => {
    mockFetch.mockReturnValue(apiResponse([]))

    render(<ContactDealsPanel contactId="contact-1" contactName="Ava Owner" />)
    await waitFor(() => expect(screen.getByText('No deals linked to this contact yet.')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Create first deal/i }))

    expect(screen.getByText('Drawer contact label: Ava Owner')).toBeInTheDocument()
  })
})
