/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MerchantCenterPanel } from '@/components/ads/google/MerchantCenterPanel'
import type { AdMerchantCenter } from '@/lib/ads/types'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))

const BINDING: AdMerchantCenter = {
  id: 'mc_1',
  orgId: 'org_1',
  merchantId: '123456789',
  accessTokenRef: 'tok_ref_1',
  refreshTokenRef: 'ref_ref_1',
  feedLabels: ['US', 'AU'],
  createdAt: null,
  updatedAt: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  // Default: no bindings
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ success: true, data: { bindings: [] } }),
  }) as unknown as typeof fetch
})

describe('MerchantCenterPanel', () => {
  it('renders Connect button when no bindings are returned', async () => {
    render(<MerchantCenterPanel orgSlug="acme" orgId="org_1" />)

    // Loading state briefly visible, then resolves
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Connect Merchant Center/i }),
      ).toBeInTheDocument()
    })
  })

  it('renders binding row with merchantId when a binding is present', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ success: true, data: { bindings: [BINDING] } }),
    }) as unknown as typeof fetch

    render(<MerchantCenterPanel orgSlug="acme" orgId="org_1" />)

    await waitFor(() => {
      expect(screen.getByText(/123456789/)).toBeInTheDocument()
    })
  })

  it('renders feed label dropdown when binding has feedLabels', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ success: true, data: { bindings: [BINDING] } }),
    }) as unknown as typeof fetch

    render(<MerchantCenterPanel orgSlug="acme" orgId="org_1" />)

    await waitFor(() => {
      const select = screen.getByRole('combobox', {
        name: /Feed label for 123456789/i,
      })
      expect(select).toBeInTheDocument()
      expect(screen.getByText('US')).toBeInTheDocument()
      expect(screen.getByText('AU')).toBeInTheDocument()
    })
  })

  it('renders Disconnect button for each binding', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ success: true, data: { bindings: [BINDING] } }),
    }) as unknown as typeof fetch

    render(<MerchantCenterPanel orgSlug="acme" orgId="org_1" />)

    await waitFor(() => {
      expect(
        screen.getByRole('button', {
          name: 'Disconnect Merchant Center account 123456789 for acme',
        }),
      ).toBeInTheDocument()
    })
  })

  it('calls the authorize endpoint when Connect button is clicked', async () => {
    // First call: GET bindings (no bindings)
    // Second call: POST authorize
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { bindings: [] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            data: { authorizeUrl: 'https://accounts.google.com/o/oauth2/auth?mc=1' },
          }),
      }) as unknown as typeof fetch

    render(<MerchantCenterPanel orgSlug="acme" orgId="org_1" />)

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Connect Merchant Center/i }),
      ).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Connect Merchant Center/i }))
    })

    await waitFor(() => {
      // Verify the authorize POST was made with correct orgId header
      const calls = (global.fetch as jest.Mock).mock.calls
      const authorizeCall = calls.find(
        (c) =>
          c[0] === '/api/v1/ads/google/merchant-center/oauth/authorize' &&
          c[1]?.method === 'POST',
      )
      expect(authorizeCall).toBeTruthy()
      expect(authorizeCall[1].headers['X-Org-Id']).toBe('org_1')
    })
  })

  it('shows error message when fetch fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: () =>
        Promise.resolve({ success: false, error: 'Unauthorized' }),
    }) as unknown as typeof fetch

    render(<MerchantCenterPanel orgSlug="acme" orgId="org_1" />)

    await waitFor(() => {
      expect(screen.getByText(/Unauthorized/i)).toBeInTheDocument()
    })
  })

  it('confirms Merchant Center disconnects inside the page', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { bindings: [BINDING] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      }) as unknown as typeof fetch

    render(<MerchantCenterPanel orgSlug="acme" orgId="org_1" />)

    const disconnectButton = await screen.findByRole('button', {
      name: 'Disconnect Merchant Center account 123456789 for acme',
    })
    fireEvent.click(disconnectButton)

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole('alertdialog', {
        name: 'Disconnect Merchant Center account 123456789 for acme?',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Shopping campaigns using this Merchant Center account will stop syncing. Campaign history stays in PiB.'),
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Confirm disconnect Merchant Center account 123456789 for acme',
      }),
    )

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/ads/google/merchant-center/mc_1', {
        method: 'DELETE',
        headers: { 'X-Org-Id': 'org_1' },
      })
    })
    expect(await screen.findByText('Merchant Center account 123456789 disconnected.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Merchant Center binding 123456789')).not.toBeInTheDocument()

    confirmSpy.mockRestore()
  })
})
