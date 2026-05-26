import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PortalViewSwitch } from '@/components/admin/PortalViewSwitch'

const mockPush = jest.fn()
const mockRefresh = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}))

describe('PortalViewSwitch', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn()
  })

  it('sets the active portal org before navigating to the portal', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ orgs: [{ id: 'client-org' }] }),
    }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ orgId: 'client-org' }),
    })

    render(<PortalViewSwitch orgId="client-org" />)
    fireEvent.click(await screen.findByRole('button', { name: /portal view/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenNthCalledWith(2, '/api/v1/portal/active-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: 'client-org' }),
      })
      expect(mockPush).toHaveBeenCalledWith('/portal/dashboard')
      expect(mockRefresh).toHaveBeenCalled()
    })
  })

  it('does not render when the user is not an org member', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ orgs: [{ id: 'other-org' }] }),
    })

    render(<PortalViewSwitch orgId="client-org" />)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/orgs')
      expect(screen.queryByRole('button', { name: /portal view/i })).not.toBeInTheDocument()
    })
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('still shows the portal access error if access changes before navigation', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ orgs: [{ id: 'client-org' }] }),
    }).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'You do not have access to this organisation' }),
    })

    render(<PortalViewSwitch orgId="client-org" />)
    fireEvent.click(await screen.findByRole('button', { name: /portal view/i }))

    expect(await screen.findByText('You do not have access to this organisation')).toBeInTheDocument()
    expect(mockPush).not.toHaveBeenCalled()
  })
})
