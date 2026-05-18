/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { TiktokConnectionsPanel } from '@/components/ads/TiktokConnectionsPanel'

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

const TIKTOK_CONNECTION_NO_ADVERTISER = {
  id: 'conn_tt_1',
  orgId: 'org_1',
  platform: 'tiktok' as const,
  status: 'active' as const,
  userId: 'u1',
  scopes: [],
  adAccounts: [],
  meta: { tiktok: {} },
}

const TIKTOK_CONNECTION_WITH_ADVERTISER = {
  ...TIKTOK_CONNECTION_NO_ADVERTISER,
  meta: { tiktok: { selectedAdvertiserId: '1234567890123456789' } },
}

beforeEach(() => {
  jest.resetAllMocks()
})

describe('TiktokConnectionsPanel', () => {
  it('renders "Connect TikTok Ads" button when no TikTok connection exists', () => {
    render(
      <TiktokConnectionsPanel
        orgSlug="acme"
        orgId="org_1"
        connections={[META_CONNECTION] as any}
      />,
    )
    expect(screen.getByText('Connect TikTok Ads')).toBeInTheDocument()
    expect(screen.getByText('Not connected')).toBeInTheDocument()
  })

  it('shows "Connected · pick an Advertiser below" and fetches accounts when connection has no selectedAdvertiserId', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { accounts: [] } }),
    }) as jest.Mock

    render(
      <TiktokConnectionsPanel
        orgSlug="acme"
        orgId="org_1"
        connections={[TIKTOK_CONNECTION_NO_ADVERTISER] as any}
      />,
    )

    expect(screen.getByText('Connected · pick an Advertiser below')).toBeInTheDocument()

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/ads/tiktok/accounts?connectionId=conn_tt_1'),
        expect.objectContaining({ headers: { 'X-Org-Id': 'org_1' } }),
      )
    })
  })

  it('renders the advertiser picker with returned advertisers', async () => {
    const accounts = [
      { advertiserId: '1111111111111111111', advertiserName: 'Brand Alpha', currency: 'USD' },
      { advertiserId: '2222222222222222222', advertiserName: 'Brand Beta', currency: 'EUR' },
    ]

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { accounts } }),
    }) as jest.Mock

    render(
      <TiktokConnectionsPanel
        orgSlug="acme"
        orgId="org_1"
        connections={[TIKTOK_CONNECTION_NO_ADVERTISER] as any}
      />,
    )

    // Wait for accounts to load and render in the select
    await screen.findByText('Brand Alpha (1111111111111111111)')
    expect(screen.getByText('Brand Beta (2222222222222222222)')).toBeInTheDocument()
  })

  it('PATCHes the correct URL with selectedAdvertiserId on "Use this advertiser" click', async () => {
    const accounts = [
      { advertiserId: '1111111111111111111', advertiserName: 'Brand Alpha', currency: 'USD' },
    ]

    // First call: GET accounts; second call: PATCH account
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { accounts } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { id: 'conn_tt_1', selectedAdvertiserId: '1111111111111111111' } }),
      }) as jest.Mock

    render(
      <TiktokConnectionsPanel
        orgSlug="acme"
        orgId="org_1"
        connections={[TIKTOK_CONNECTION_NO_ADVERTISER] as any}
      />,
    )

    // Wait for the button to appear
    const useButton = await screen.findByText('Use this advertiser')
    fireEvent.click(useButton)

    await waitFor(() => {
      const calls = (global.fetch as jest.Mock).mock.calls
      const patchCall = calls.find(([url, opts]: [string, any]) =>
        url.includes('/api/v1/ads/tiktok/connections/conn_tt_1/account') &&
        opts?.method === 'PATCH',
      )
      expect(patchCall).toBeDefined()
      const patchBody = JSON.parse(patchCall[1].body)
      expect(patchBody.selectedAdvertiserId).toBe('1111111111111111111')
    })
  })
})
