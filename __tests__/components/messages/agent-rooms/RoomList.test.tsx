import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RoomList } from '@/components/messages/agent-rooms/RoomList'

jest.mock('@/components/portal/FeatureFlagsProvider', () => ({
  useFeatureFlag: (key: string) => key === 'personalAgentRoomsEnabled',
}))

function response(body: unknown, ok = true, status = ok ? 200 : 400): Response {
  return { ok, status, json: async () => body } as Response
}

describe('RoomList', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('renders My rooms and Org rooms sections', async () => {
    const onOpen = jest.fn()
    global.fetch = jest.fn(async () => response({
      success: true,
      data: {
        rooms: [
          {
            roomId: 'org-1_growth-desk',
            name: 'Growth desk',
            conversationId: 'conv-room-1',
            status: 'active',
            accessScope: 'organization',
            members: [{ agentId: 'maya', deviceId: 'device-a' }, { agentId: 'pip', deviceId: null }],
          },
          {
            roomId: 'org-1_u_user-1_desk',
            name: 'My desk',
            conversationId: 'conv-personal',
            status: 'active',
            accessScope: 'personal',
            ownerUserId: 'user-1',
            members: [{ agentId: 'pip', deviceId: null }, { agentId: 'maya', deviceId: null }],
          },
        ],
      },
    }))
    render(<RoomList orgId="org-1" canCreateOrgRooms onOpenConversation={onOpen} />)
    expect(await screen.findByText('My rooms')).toBeInTheDocument()
    expect(screen.getByText('Org rooms')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Growth desk' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open My desk' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Growth desk' }))
    expect(onOpen).toHaveBeenCalledWith('conv-room-1')
  })

  it('renders nothing when agent rooms are disabled', async () => {
    global.fetch = jest.fn(async () => response({ error: 'feature_disabled' }, false, 404))
    const { container } = render(<RoomList orgId="org-1" onOpenConversation={jest.fn()} />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/v1/orgs/org-1/agent-rooms'))
    expect(container).toBeEmptyDOMElement()
  })
})
