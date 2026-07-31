import { act, render, screen, waitFor } from '@testing-library/react'
import { CommunicationsConsole } from '@/components/communications/CommunicationsConsole'

const useOrgMock = jest.fn()

jest.mock('@/lib/contexts/OrgContext', () => ({
  useOrg: () => useOrgMock(),
}))

function mockOrgContext(overrides: Partial<ReturnType<typeof useOrgMock>> = {}) {
  useOrgMock.mockReturnValue({
    selectedOrgId: '',
    orgName: '',
    orgs: [],
    setOrg: jest.fn(),
    clearOrg: jest.fn(),
    orgId: '',
    ...overrides,
  })
}

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
  } as Response
}

describe('CommunicationsConsole organisation scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockOrgContext()
    global.fetch = jest.fn(async () => jsonResponse({
      success: true,
      data: { items: [], total: 0 },
    }))
  })

  it('uses the shared segmented page tabs for communication views', async () => {
    render(<CommunicationsConsole mode="admin" initialOrgId="org-1" />)

    const tablist = screen.getByRole('tablist', { name: 'Communications views' })
    expect(tablist).toHaveClass('pib-tabs', 'pib-tabs-segmented')
    expect(screen.getByRole('tab', { name: /inbox/i })).toHaveClass('pib-tab-active')

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/communications/conversations?orgId=org-1&status=open&limit=100',
      )
    })
  })

  it('loads admin workspace conversations using the organisation slug from the entry link', async () => {
    mockOrgContext({
      orgs: [{ id: 'org-1', name: 'Partners in Biz', slug: 'partners-in-biz', type: 'client' }],
    })

    render(<CommunicationsConsole mode="admin" initialOrgSlug="partners-in-biz" />)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/communications/conversations?orgId=org-1&status=open&limit=100',
      )
    })
  })

  it('resolves the active portal organisation before loading communications', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/portal/active-org') {
        return jsonResponse({ orgId: 'org-1' })
      }
      return jsonResponse({
        success: true,
        data: { items: [], total: 0 },
      })
    })

    render(<CommunicationsConsole mode="portal" />)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/active-org', { cache: 'no-store' })
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/communications/conversations?orgId=org-1&status=open&limit=100',
      )
    })

    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/v1/communications/conversations?status=open&limit=100',
    )
  })

  it('shows the linked CRM company workspace and preserves source context on portal handoffs', async () => {
    render(
      <CommunicationsConsole
        mode="portal"
        initialOrgId="lumen-org"
        initialOrgSlug="lumen-speeds"
        sourceCompanyId="company-1"
        sourceCompanyName="Lumen"
      />,
    )

    expect(screen.getByRole('heading', { name: 'Communications command center' })).toBeInTheDocument()
    expect(screen.getByText('Lumen workspace')).toBeInTheDocument()
    expect(screen.getByText('Inbox control')).toBeInTheDocument()
    expect(screen.getByText('Human handoff')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /marketing/i })).toHaveAttribute(
      'href',
      '/portal/marketing?orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
    )
    expect(screen.queryByRole('link', { name: /arrow_back Marketing/i })).not.toBeInTheDocument()

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/communications/conversations?orgId=lumen-org&status=open&limit=100',
      )
    })
  })

  it('shows live messaging fallback when EventSource is unavailable', async () => {
    const originalEventSource = (global as typeof globalThis & { EventSource?: unknown }).EventSource
    Object.defineProperty(global, 'EventSource', { value: undefined, configurable: true })

    render(<CommunicationsConsole mode="admin" initialOrgId="org-1" />)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/communications/conversations?orgId=org-1&status=open&limit=100',
      )
    })
    expect(screen.getByText('Live updates are not supported in this environment; using manual refresh.')).toBeInTheDocument()

    Object.defineProperty(global, 'EventSource', {
      value: originalEventSource,
      configurable: true,
    })
  })

  it('uses live snapshots to refresh conversations and thread messages', async () => {
    const instances: Array<{
      url: string
      listeners: Record<string, (event: MessageEvent) => void>
      close: jest.Mock
    }> = []

    class MockEventSource {
      url: string
      listeners: Record<string, (event: MessageEvent) => void> = {}
      close = jest.fn()

      constructor(url: string) {
        this.url = url
        instances.push(this)
      }

      addEventListener(event: string, listener: EventListener) {
        this.listeners[event] = listener as (event: MessageEvent) => void
      }
    }

    Object.defineProperty(global, 'EventSource', {
      value: MockEventSource,
      configurable: true,
    })

    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.startsWith('/api/v1/communications/conversations/')) {
        return jsonResponse({
          success: true,
          data: {
            conversation: {
              id: 'conv-1',
              orgId: 'org-1',
              status: 'open',
              channel: 'whatsapp',
              contactSnapshot: { name: 'Ada' },
            } as Record<string, unknown>,
            messages: [{
              id: 'msg-live-1',
              direction: 'inbound',
              body: 'Before live',
              status: 'received',
            }],
          },
        })
      }

      if (url === '/api/v1/communications/conversations?orgId=org-1&status=open&limit=100') {
        return jsonResponse({
          success: true,
          data: {
            items: [{
              id: 'conv-1',
              orgId: 'org-1',
              channel: 'whatsapp',
              status: 'open',
              contactSnapshot: { name: 'Ada' },
            }],
            total: 1,
          },
        })
      }

      return jsonResponse({
        success: true,
        data: { items: [], total: 0 },
      })
    })

    render(<CommunicationsConsole mode="admin" initialOrgId="org-1" />)

    await waitFor(() => {
      expect(instances.length).toBeGreaterThanOrEqual(1)
    })

    const stream = instances[instances.length - 1]
    expect(stream.url).toContain('/api/v1/communications/live?orgId=org-1&limit=100')
      
    await waitFor(() => {
      expect(screen.getByText('Live updates connected.')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByText('Before live')).toBeInTheDocument()
    })

    act(() => {
      const message = new MessageEvent('snapshot', {
        data: JSON.stringify({
          type: 'snapshot',
          conversations: [{
            id: 'conv-1',
            orgId: 'org-1',
            channel: 'whatsapp',
            status: 'pending',
            contactSnapshot: { name: 'Ada' },
          }],
          conversation: {
            id: 'conv-1',
            orgId: 'org-1',
            channel: 'whatsapp',
            status: 'pending',
            contactSnapshot: { name: 'Ada' },
          },
          messages: [{
            id: 'msg-live-2',
            direction: 'inbound',
            body: 'Live response arrived',
            status: 'received',
          }],
          filter: {
            orgId: 'org-1',
            status: 'open',
            channel: 'whatsapp',
            limit: 100,
            conversationId: null,
          },
          emittedAtMs: 123,
        }),
      })

      for (const source of instances) {
        source.listeners.snapshot?.(message)
      }
    })

    await waitFor(() => {
      expect(screen.getByText('Live response arrived')).toBeInTheDocument()
      expect(screen.getByText('Live updates connected.')).toBeInTheDocument()
    })
  })
})
