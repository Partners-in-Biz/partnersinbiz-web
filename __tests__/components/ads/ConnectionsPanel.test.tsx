/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ConnectionsPanel } from '@/components/ads/ConnectionsPanel'
import type { AdConnection } from '@/lib/ads/types'

const META_CONNECTION: AdConnection = {
  id: 'c1',
  orgId: 'org_1',
  platform: 'meta',
  status: 'active',
  userId: 'u',
  scopes: [],
  adAccounts: [
    { id: 'act_42', name: 'Brand X', currency: 'USD', timezone: 'UTC' },
  ],
  defaultAdAccountId: 'act_42',
}

describe('ConnectionsPanel', () => {
  it('shows the "Connect Meta" CTA when no Meta connection exists', () => {
    render(<ConnectionsPanel orgSlug="acme" orgId="org_1" connections={[]} />)
    expect(screen.getByText(/Connect Meta/i)).toBeInTheDocument()
  })

  it('renders ad accounts list when a Meta connection is present', () => {
    render(
      <ConnectionsPanel
        orgSlug="acme"
        orgId="org_1"
        connections={[META_CONNECTION]}
      />,
    )
    expect(screen.getByText(/Brand X/)).toBeInTheDocument()
    expect(screen.getByText(/act_42/)).toBeInTheDocument()
  })

  it('confirms Meta disconnects inside the page', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: async () => ({ success: true }) } as Response),
    ) as jest.Mock

    render(
      <ConnectionsPanel
        orgSlug="acme"
        orgId="org_1"
        connections={[META_CONNECTION]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Meta ads connection for acme' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(
      screen.getByRole('alertdialog', { name: 'Disconnect Meta ads connection for acme?' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('This revokes Meta ad account access for this workspace. Campaign history stays in PiB.'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm disconnect Meta ads connection for acme' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/ads/connections/meta', {
        method: 'DELETE',
        headers: { 'X-Org-Id': 'org_1' },
      })
    })
    expect(await screen.findByText('Meta ads disconnected.')).toBeInTheDocument()

    confirmSpy.mockRestore()
  })
})
