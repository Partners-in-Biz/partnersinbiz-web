/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { GoogleConnectionsPanel } from '@/components/ads/GoogleConnectionsPanel'
import type { AdConnection } from '@/lib/ads/types'

const refresh = jest.fn()
let mockSearchParamsValue = ''

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
  useSearchParams: () => new URLSearchParams(mockSearchParamsValue),
}))

const GOOGLE_CONNECTION: AdConnection = {
  id: 'conn_google_1',
  orgId: 'org_1',
  platform: 'google',
  status: 'active',
  userId: 'u1',
  scopes: [],
  adAccounts: [],
  defaultAdAccountId: '1234567890',
}

describe('GoogleConnectionsPanel', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockSearchParamsValue = ''
  })

  it('shows Google OAuth callback account-selection status from the URL', () => {
    mockSearchParamsValue = 'status=connected&provider=google&needsAccountSelection=1&connectionId=conn_google_1'

    render(<GoogleConnectionsPanel orgSlug="acme" orgId="org_1" connections={[{ ...GOOGLE_CONNECTION, defaultAdAccountId: undefined }]} />)

    expect(screen.getByText('Google Ads connected. Select a Customer ID to finish account setup.')).toBeInTheDocument()
  })

  it('does not show a Google callback notice for another provider callback', () => {
    mockSearchParamsValue = 'status=error&provider=meta&connectionId=conn_meta_1&needsAccountSelection=1&message=oauth_failed'

    render(<GoogleConnectionsPanel orgSlug="acme" orgId="org_1" connections={[{ ...GOOGLE_CONNECTION, defaultAdAccountId: undefined }]} />)

    expect(screen.queryByText(/Google Ads connection failed/)).not.toBeInTheDocument()
    expect(screen.queryByText('Google Ads connected. Select a Customer ID to finish account setup.')).not.toBeInTheDocument()
  })

  it('does not show a Google callback notice for account selection without provider=google', () => {
    mockSearchParamsValue = 'status=connected&needsAccountSelection=1&connectionId=conn_meta_1'

    render(<GoogleConnectionsPanel orgSlug="acme" orgId="org_1" connections={[{ ...GOOGLE_CONNECTION, defaultAdAccountId: undefined }]} />)

    expect(screen.queryByText('Google Ads connected. Select a Customer ID to finish account setup.')).not.toBeInTheDocument()
  })

  it('confirms Google Ads disconnects inside the page', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: async () => ({ success: true }) } as Response),
    ) as jest.Mock

    render(<GoogleConnectionsPanel orgSlug="acme" orgId="org_1" connections={[GOOGLE_CONNECTION]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Google Ads connection for acme' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(
      screen.getByRole('alertdialog', { name: 'Disconnect Google Ads connection for acme?' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('This revokes Google Ads account access for this workspace. Campaign history stays in PiB.'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm disconnect Google Ads connection for acme' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/ads/connections/google', {
        method: 'DELETE',
        headers: { 'X-Org-Id': 'org_1' },
      })
    })
    expect(await screen.findByText('Google Ads disconnected.')).toBeInTheDocument()
    expect(refresh).toHaveBeenCalled()

    confirmSpy.mockRestore()
  })
})
