import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RoomDriftBanner } from '@/components/messages/agent-rooms/RoomDriftBanner'

describe('RoomDriftBanner', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('posts adopt and revert against the drift routes', async () => {
    const onResolved = jest.fn()
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ success: true }) } as Response))
    global.fetch = fetchMock
    render(
      <RoomDriftBanner
        orgId="org-1"
        projectionId="device-a_partners--maya"
        profile="partners--maya"
        onResolved={onResolved}
      />,
    )
    expect(screen.getByText(/partners--maya drifted/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Adopt' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/orgs/org-1/agent-rooms/drift/device-a_partners--maya/adopt',
      expect.objectContaining({ method: 'POST' }),
    ))
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
    await waitFor(() => expect(onResolved).toHaveBeenCalled())
  })
})
