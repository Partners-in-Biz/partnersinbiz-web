import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CreateRoomDialog, deriveRoomSlug } from '@/components/messages/agent-rooms/CreateRoomDialog'

function response(body: unknown, ok = true, status = ok ? 200 : 400): Response {
  return { ok, status, json: async () => body } as Response
}

describe('CreateRoomDialog', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('derives a slug from the room name', () => {
    expect(deriveRoomSlug('Growth Desk')).toBe('growth-desk')
  })

  it('POSTs members and human teams on create', async () => {
    const onCreated = jest.fn()
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/agent-rooms') && init?.method === 'POST') {
        return response({ success: true, data: { room: { conversationId: 'conv-room-1' } } }, true, 201)
      }
      if (url.includes('/linked-computers')) {
        return response({ success: true, data: [{ deviceId: 'device-a', label: "Peet's Mac", availableAgentIds: ['maya'] }] })
      }
      if (url.includes('/teams')) {
        return response({ success: true, data: { teams: [{ teamId: 'org-1_growth', name: 'Growth' }] } })
      }
      return response({})
    })
    global.fetch = fetchMock
    render(<CreateRoomDialog orgId="org-1" onCreated={onCreated} onClose={jest.fn()} />)
    expect(await screen.findByLabelText('Growth')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'Growth Desk' } })
    expect(screen.getByLabelText('Room slug')).toHaveValue('growth-desk')
    fireEvent.click(screen.getByLabelText('Growth'))
    fireEvent.change(screen.getByLabelText('Member 2 device'), { target: { value: 'device-a' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('conv-room-1'))
    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      name: 'Growth Desk',
      slug: 'growth-desk',
      pictureUrl: null,
      members: [
        { agentId: 'pip', deviceId: null },
        { agentId: 'maya', deviceId: 'device-a' },
      ],
      humanTeamIds: ['org-1_growth'],
    })
  })
})
