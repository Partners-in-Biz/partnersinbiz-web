import { render, screen, waitFor } from '@testing-library/react'
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
})
