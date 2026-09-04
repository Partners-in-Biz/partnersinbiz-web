import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RoomList } from '@/components/messages/agent-rooms/RoomList'

function response(body: unknown, ok = true, status = ok ? 200 : 400): Response {
  return { ok, status, json: async () => body } as Response
}

describe('RoomList', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('renders rooms and opens the mirror conversation', async () => {
    const onOpen = jest.fn()
    global.fetch = jest.fn(async () => response({
      success: true,
      data: {
        rooms: [{
          roomId: 'org-1_growth-desk',
          name: 'Growth desk',
          conversationId: 'conv-room-1',
          status: 'active',
          members: [{ agentId: 'maya', deviceId: 'device-a' }, { agentId: 'pip', deviceId: null }],
        }],
      },
    }))
    render(<RoomList orgId="org-1" onOpenConversation={onOpen} />)
    expect(await screen.findByRole('button', { name: 'Open Growth desk' })).toBeInTheDocument()
    expect(screen.getByText('@maya-device-a')).toBeInTheDocument()
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
