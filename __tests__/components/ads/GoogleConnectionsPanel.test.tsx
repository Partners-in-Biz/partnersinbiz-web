/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { GoogleConnectionsPanel } from '@/components/ads/GoogleConnectionsPanel'
import type { AdConnection } from '@/lib/ads/types'

const refresh = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
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
