/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { LinkedinConnectionsPanel } from '@/components/ads/LinkedinConnectionsPanel'
import type { AdConnection } from '@/lib/ads/types'

// next/navigation mock
const refresh = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

const META_CONNECTION: AdConnection = {
  id: 'conn_meta_1',
  orgId: 'org_1',
  platform: 'meta',
  status: 'active',
  userId: 'u1',
  scopes: [],
  adAccounts: [],
}

const GOOGLE_CONNECTION: AdConnection = {
  id: 'conn_google_1',
  orgId: 'org_1',
  platform: 'google',
  status: 'active',
  userId: 'u1',
  scopes: [],
  adAccounts: [],
}

const LINKEDIN_CONNECTION_NO_ACCOUNT: AdConnection = {
  id: 'conn_li_1',
  orgId: 'org_1',
  platform: 'linkedin',
  status: 'active',
  userId: 'u1',
  scopes: [],
  adAccounts: [],
  meta: { linkedin: {} },
}

const LINKEDIN_CONNECTION_WITH_ACCOUNT: AdConnection = {
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
        connections={[META_CONNECTION, GOOGLE_CONNECTION]}
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
        connections={[LINKEDIN_CONNECTION_NO_ACCOUNT]}
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
        connections={[LINKEDIN_CONNECTION_NO_ACCOUNT]}
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
        connections={[LINKEDIN_CONNECTION_NO_ACCOUNT]}
      />,
    )

    // Wait for the button to appear
    const useButton = await screen.findByText('Use this account')
    fireEvent.click(useButton)

    await waitFor(() => {
      const calls = (global.fetch as jest.Mock).mock.calls
      const patchCall = calls.find(([url, opts]: [string, RequestInit]) =>
        url.includes('/api/v1/ads/linkedin/connections/conn_li_1/account') &&
        opts?.method === 'PATCH',
      )
      expect(patchCall).toBeDefined()
      const patchBody = JSON.parse(patchCall[1].body)
      expect(patchBody.selectedAdAccountUrn).toBe('urn:li:sponsoredAccount:111111111')
    })
  })

  it('confirms LinkedIn Ads disconnects inside the page', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: async () => ({ success: true }) } as Response),
    ) as jest.Mock

    render(
      <LinkedinConnectionsPanel
        orgSlug="acme"
        orgId="org_1"
        connections={[LINKEDIN_CONNECTION_WITH_ACCOUNT]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect LinkedIn Ads connection for acme' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(
      screen.getByRole('alertdialog', { name: 'Disconnect LinkedIn Ads connection for acme?' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('This revokes LinkedIn Marketing API ad account access for this workspace. Campaign history stays in PiB.'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm disconnect LinkedIn Ads connection for acme' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/ads/connections/linkedin', {
        method: 'DELETE',
        headers: { 'X-Org-Id': 'org_1' },
      })
    })
    expect(await screen.findByText('LinkedIn Ads disconnected.')).toBeInTheDocument()
    expect(refresh).toHaveBeenCalled()

    confirmSpy.mockRestore()
  })
})
