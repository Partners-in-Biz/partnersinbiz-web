/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { LinkedinConnectionsPanel } from '@/components/ads/LinkedinConnectionsPanel'

// next/navigation mock
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}))

const META_CONNECTION = {
  id: 'conn_meta_1',
  orgId: 'org_1',
  platform: 'meta' as const,
  status: 'active' as const,
  userId: 'u1',
  scopes: [],
  adAccounts: [],
}

const GOOGLE_CONNECTION = {
  id: 'conn_google_1',
  orgId: 'org_1',
  platform: 'google' as const,
  status: 'active' as const,
  userId: 'u1',
  scopes: [],
  adAccounts: [],
}

const LINKEDIN_CONNECTION_NO_ACCOUNT = {
  id: 'conn_li_1',
  orgId: 'org_1',
  platform: 'linkedin' as const,
  status: 'active' as const,
  userId: 'u1',
  scopes: [],
  adAccounts: [],
  meta: { linkedin: {} },
}

const LINKEDIN_CONNECTION_WITH_ACCOUNT = {
  ...LINKEDIN_CONNECTION_NO_ACCOUNT,
  meta: { linkedin: { selectedAdAccountUrn: 'urn:li:sponsoredAccount:9876543210' } },
}

beforeEach(() => {
  jest.resetAllMocks()
})

describe('LinkedinConnectionsPanel', () => {
  it('renders "Connect LinkedIn Ads" button when no LinkedIn connection exists', () => {
    render(
      <LinkedinConnectionsPanel
        orgSlug="acme"
        orgId="org_1"
        connections={[META_CONNECTION, GOOGLE_CONNECTION] as any}
      />,
    )
    expect(screen.getByText('Connect LinkedIn Ads')).toBeInTheDocument()
    expect(screen.getByText('Not connected')).toBeInTheDocument()
  })

  it('shows "Connected · pick an Ad Account below" and fetches accounts when connection has no selectedAdAccountUrn', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { accounts: [] } }),
    }) as jest.Mock

    render(
      <LinkedinConnectionsPanel
        orgSlug="acme"
        orgId="org_1"
        connections={[LINKEDIN_CONNECTION_NO_ACCOUNT] as any}
      />,
    )

    expect(screen.getByText('Connected · pick an Ad Account below')).toBeInTheDocument()

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/ads/linkedin/accounts?connectionId=conn_li_1'),
        expect.objectContaining({ headers: { 'X-Org-Id': 'org_1' } }),
      )
    })
  })

  it('renders the account picker with returned accounts', async () => {
    const accounts = [
      { urn: 'urn:li:sponsoredAccount:111111111', name: 'Brand Alpha', currency: 'USD' },
      { urn: 'urn:li:sponsoredAccount:222222222', name: 'Brand Beta', currency: 'EUR' },
    ]

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { accounts } }),
    }) as jest.Mock

    render(
      <LinkedinConnectionsPanel
        orgSlug="acme"
        orgId="org_1"
        connections={[LINKEDIN_CONNECTION_NO_ACCOUNT] as any}
      />,
    )

    // Wait for accounts to load and render in the select
    await screen.findByText('Brand Alpha (Account 111111111)')
    expect(screen.getByText('Brand Beta (Account 222222222)')).toBeInTheDocument()
  })

  it('PATCHes the correct URL with selectedAdAccountUrn on "Use this account" click', async () => {
    const accounts = [
      { urn: 'urn:li:sponsoredAccount:111111111', name: 'Brand Alpha', currency: 'USD' },
    ]

    // First call: GET accounts; second call: PATCH account
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { accounts } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { id: 'conn_li_1', selectedAdAccountUrn: 'urn:li:sponsoredAccount:111111111' } }),
      }) as jest.Mock

    render(
      <LinkedinConnectionsPanel
        orgSlug="acme"
        orgId="org_1"
        connections={[LINKEDIN_CONNECTION_NO_ACCOUNT] as any}
      />,
    )

    // Wait for the button to appear
    const useButton = await screen.findByText('Use this account')
    fireEvent.click(useButton)

    await waitFor(() => {
      const calls = (global.fetch as jest.Mock).mock.calls
      const patchCall = calls.find(([url, opts]: [string, any]) =>
        url.includes('/api/v1/ads/linkedin/connections/conn_li_1/account') &&
        opts?.method === 'PATCH',
      )
      expect(patchCall).toBeDefined()
      const patchBody = JSON.parse(patchCall[1].body)
      expect(patchBody.selectedAdAccountUrn).toBe('urn:li:sponsoredAccount:111111111')
    })
  })
})
