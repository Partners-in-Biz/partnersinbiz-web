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
    deal,
    defaultContactLabel,
    orgScope,
    onSaved,
  }: {
    deal?: Deal
    defaultContactLabel?: string
    orgScope?: { orgId?: string; orgSlug?: string; sourceCompanyId?: string; sourceCompanyName?: string }
    onSaved: (dealId: string) => void
  }) => (
    <div
      data-testid="mock-deal-drawer"
      data-org-id={orgScope?.orgId ?? ''}
      data-org-slug={orgScope?.orgSlug ?? ''}
      data-source-company-id={orgScope?.sourceCompanyId ?? ''}
      data-source-company-name={orgScope?.sourceCompanyName ?? ''}
    >
      {deal && <p>Drawer deal title: {deal.title}</p>}
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

    expect(screen.getByText('Discovery')).toBeInTheDocument()
    expect(screen.getByText('Proposal')).toBeInTheDocument()
    expect(screen.getByText('Won')).toBeInTheDocument()

    // Values
    expect(screen.getAllByText(/10[\s ,.]?000/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/25[\s ,.]?000/).length).toBeGreaterThan(0)
  })

  it('formats fallback stage ids as readable labels when pipeline metadata is unavailable', async () => {
    mockFetch.mockReturnValue(apiResponse([
      makeDeal({ id: 'd1', title: 'Fallback Stage Deal', stageId: 'proposal_sent' }),
    ]))

    render(<ContactDealsPanel contactId="contact-1" />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Fallback Stage Deal' })).toBeInTheDocument()
    })

    expect(screen.getByText('Proposal Sent')).toBeInTheDocument()
    expect(screen.queryByText('proposal_sent')).not.toBeInTheDocument()
  })

  it('names missing deal values while keeping zero-value deals explicit on contact detail', async () => {
    mockFetch.mockReturnValue(apiResponse([
      makeDeal({ id: 'd1', title: 'Unpriced relationship deal', value: undefined }),
      makeDeal({ id: 'd2', title: 'Zero value scoping deal', value: 0 }),
    ]))

    render(<ContactDealsPanel contactId="contact-1" contactName="Ava Owner" />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Unpriced relationship deal' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Zero value scoping deal' })).toBeInTheDocument()
    })

    expect(screen.getByText(/No value captured/)).toBeInTheDocument()
    expect(screen.getAllByText(/R\s*0/).length).toBeGreaterThan(0)
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  it('names missing close dates on contact deal rows as forecast cleanup work', async () => {
    mockFetch.mockReturnValue(apiResponse([
      makeDeal({ id: 'd1', title: 'Forecast hygiene deal', expectedCloseDate: null }),
    ]))

    render(<ContactDealsPanel contactId="contact-1" contactName="Ava Owner" />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Forecast hygiene deal' })).toBeInTheDocument()
    })

    expect(screen.getByText(/Close date missing/)).toBeInTheDocument()
  })

  it('opens linked deal forecast cleanup directly from the contact deal row', async () => {
    mockFetch.mockReturnValue(apiResponse([
      makeDeal({ id: 'd1', title: 'Forecast hygiene deal', expectedCloseDate: null }),
    ]))

    render(<ContactDealsPanel contactId="contact-1" contactName="Ava Owner" />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Forecast hygiene deal' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add close date for Forecast hygiene deal from contact deal row' }))

    expect(screen.getByText('Drawer deal title: Forecast hygiene deal')).toBeInTheDocument()
  })

  it('opens linked deal value cleanup directly from the contact deal row', async () => {
    mockFetch.mockReturnValue(apiResponse([
      makeDeal({ id: 'd1', title: 'Unpriced relationship deal', value: undefined }),
    ]))

    render(<ContactDealsPanel contactId="contact-1" contactName="Ava Owner" />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Unpriced relationship deal' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add value for Unpriced relationship deal from contact deal row' }))

    expect(screen.getByText('Drawer deal title: Unpriced relationship deal')).toBeInTheDocument()
  })

  it('opens linked deal stage cleanup directly from the contact deal row', async () => {
    mockFetch.mockReturnValue(apiResponse([
      makeDeal({ id: 'd1', title: 'Stage review deal', stageId: 'proposal_sent' }),
    ]))

    render(<ContactDealsPanel contactId="contact-1" contactName="Ava Owner" />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Stage review deal' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit stage for Stage review deal from contact deal row' }))

    expect(screen.getByText('Drawer deal title: Stage review deal')).toBeInTheDocument()
  })

  it('names unreadable linked-deal close dates as forecast cleanup work', async () => {
    mockFetch.mockReturnValue(apiResponse([
      makeDeal({
        id: 'd1',
        title: 'Corrupt timing deal',
        expectedCloseDate: { _seconds: Number.NaN } as never,
      }),
    ]))

    render(<ContactDealsPanel contactId="contact-1" contactName="Ava Owner" />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Corrupt timing deal' })).toBeInTheDocument()
    })

    expect(screen.getByText(/Close date needs review/)).toBeInTheDocument()
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Close date missing/)).not.toBeInTheDocument()
  })

  it('names sparse linked deal titles instead of rendering blank rows on contact detail', async () => {
    mockFetch.mockReturnValue(apiResponse([
      makeDeal({ id: 'd1', title: '' }),
    ]))

    render(<ContactDealsPanel contactId="contact-1" contactName="Ava Owner" />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Deal name missing' })).toBeInTheDocument()
    })

    expect(screen.getByRole('link', { name: 'Deal name missing' })).toHaveAttribute('href', '/portal/deals/d1')
    expect(screen.queryByText('Test Deal')).not.toBeInTheDocument()
  })

  it('names unpriced pipeline summaries instead of rolling missing deal values into zero', async () => {
    mockFetch.mockReturnValue(apiResponse([
      makeDeal({ id: 'd1', title: 'Unpriced relationship deal', value: undefined }),
    ]))

    render(<ContactDealsPanel contactId="contact-1" contactName="Ava Owner" />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Unpriced relationship deal' })).toBeInTheDocument()
    })

    expect(screen.getByText('No priced deals')).toBeInTheDocument()
    expect(screen.getByText('Forecast value needed')).toBeInTheDocument()
    expect(screen.getByText('Capture deal value to unlock linked pipeline totals')).toBeInTheDocument()
    expect(screen.queryByText(/R\s*0/)).not.toBeInTheDocument()
  })

  it('turns an empty contact deal panel into a relationship pipeline launch state', async () => {
    mockFetch.mockReturnValue(apiResponse([]))
    render(<ContactDealsPanel contactId="contact-1" contactName="Ava Owner" />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: "Start Ava Owner's first opportunity." })).toBeInTheDocument()
    })
    expect(screen.getByText('Create a deal from this contact so pipeline value, quotes, close dates, and next steps stay connected to the relationship.')).toBeInTheDocument()
    expect(screen.getByText('Contact anchored')).toBeInTheDocument()
    expect(screen.getByText('Forecast ready')).toBeInTheDocument()
  })

  it('names contact deal creation commands without decorative icon text', async () => {
    mockFetch.mockReturnValue(apiResponse([]))
    render(<ContactDealsPanel contactId="contact-1" contactName="Ava Owner" />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: "Start Ava Owner's first opportunity." })).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'New deal for Ava Owner' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create first deal for Ava Owner' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'add New deal' })).not.toBeInTheDocument()
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

  it('names the linked-deal loading state while fetching', () => {
    // Never resolve so loading stays true
    mockFetch.mockReturnValue(new Promise(() => {}))
    const { container } = render(<ContactDealsPanel contactId="contact-1" contactName="Ava Owner" />)

    expect(screen.getByText('Loading relationship pipeline for Ava Owner...')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(container.querySelectorAll('.pib-skeleton').length).toBeGreaterThan(0)
  })

  it('shows a retryable pipeline load error instead of an empty deal state', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Deals request failed'))
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: [] }),
      })

    render(<ContactDealsPanel contactId="contact-1" contactName="Ava Owner" />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Deal pipeline unavailable' })).toBeInTheDocument()
    })
    expect(screen.getByText('We could not load linked deals for Ava Owner. Retry before treating this relationship as having no open opportunity.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: "Start Ava Owner's first opportunity." })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry linked deals for Ava Owner' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: "Start Ava Owner's first opportunity." })).toBeInTheDocument()
    })
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

  it('loads linked deals and links deal detail through the active company workspace scope', async () => {
    const deal = makeDeal({ id: 'deal-99', title: 'Lumen scoped deal', stageId: 'discovery' })
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const path = String(url)
      if (path === '/api/v1/crm/deals?contactId=contact-1&limit=100&orgId=lumen-org') return apiResponse([deal])
      if (path === '/api/v1/crm/pipelines?orgId=lumen-org') return pipelinesResponse()
      return Promise.reject(new Error(`Unexpected fetch: ${path}`))
    })

    render(
      <ContactDealsPanel
        contactId="contact-1"
        contactName="Ava Owner"
        orgScope={{
          orgId: 'lumen-org',
          orgSlug: 'lumen-speeds',
          sourceCompanyId: 'company-1',
          sourceCompanyName: 'Lumen',
        }}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Lumen scoped deal' })).toHaveAttribute(
        'href',
        '/portal/deals/deal-99?orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
      )
    })
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/crm/deals?contactId=contact-1&limit=100&orgId=lumen-org')
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/crm/pipelines?orgId=lumen-org')
    expect(mockFetch).not.toHaveBeenCalledWith('/api/v1/crm/deals?contactId=contact-1&limit=100')
    expect(mockFetch).not.toHaveBeenCalledWith('/api/v1/crm/pipelines')
  })

  it('opens deal creation with the active company workspace scope', async () => {
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const path = String(url)
      if (path === '/api/v1/crm/deals?contactId=contact-1&limit=100&orgId=lumen-org') return apiResponse([])
      if (path === '/api/v1/crm/pipelines?orgId=lumen-org') return pipelinesResponse()
      return Promise.reject(new Error(`Unexpected fetch: ${path}`))
    })

    render(
      <ContactDealsPanel
        contactId="contact-1"
        contactName="Ava Owner"
        orgScope={{
          orgId: 'lumen-org',
          orgSlug: 'lumen-speeds',
          sourceCompanyId: 'company-1',
          sourceCompanyName: 'Lumen',
        }}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: "Start Ava Owner's first opportunity." })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create first deal for Ava Owner' }))

    const drawer = screen.getByTestId('mock-deal-drawer')
    expect(drawer).toHaveAttribute('data-org-id', 'lumen-org')
    expect(drawer).toHaveAttribute('data-org-slug', 'lumen-speeds')
    expect(drawer).toHaveAttribute('data-source-company-id', 'company-1')
    expect(drawer).toHaveAttribute('data-source-company-name', 'Lumen')
  })

  it('renders a newly created contact deal from the standard deal response envelope', async () => {
    const savedDeal = makeDeal({ id: 'deal-new', title: 'Fresh relationship deal', value: 12000 })
    mockFetch.mockImplementation((url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url)
      if (path.startsWith('/api/v1/crm/deals?contactId=')) return apiResponse([])
      if (path === '/api/v1/crm/pipelines?orgId=org-1') return pipelinesResponse()
      if (path === '/api/v1/crm/deals' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { id: 'deal-new' } }),
        })
      }
      if (path === '/api/v1/crm/deals/deal-new?orgId=org-1') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { deal: savedDeal } }),
        })
      }
      return Promise.reject(new Error(`Unexpected fetch: ${path}`))
    })

    render(<ContactDealsPanel contactId="contact-1" orgId="org-1" />)
    await waitFor(() => expect(screen.getByRole('heading', { name: "Start this contact's first opportunity." })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /New deal/i }))
    fireEvent.click(await screen.findByRole('button', { name: /Save mocked deal/i }))

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Fresh relationship deal' })).toHaveAttribute('href', '/portal/deals/deal-new?orgId=org-1')
    })
    expect(screen.getByText('1 record')).toBeInTheDocument()
  })

  it('opens the new deal drawer with the readable contact name', async () => {
    mockFetch.mockReturnValue(apiResponse([]))

    render(<ContactDealsPanel contactId="contact-1" contactName="Ava Owner" />)
    await waitFor(() => expect(screen.getByRole('heading', { name: "Start Ava Owner's first opportunity." })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /New deal/i }))

    expect(screen.getByText('Drawer contact label: Ava Owner')).toBeInTheDocument()
  })

  it('opens the deal drawer from the empty-state first-deal action', async () => {
    mockFetch.mockReturnValue(apiResponse([]))

    render(<ContactDealsPanel contactId="contact-1" contactName="Ava Owner" />)
    await waitFor(() => expect(screen.getByRole('heading', { name: "Start Ava Owner's first opportunity." })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Create first deal/i }))

    expect(screen.getByText('Drawer contact label: Ava Owner')).toBeInTheDocument()
  })
})
