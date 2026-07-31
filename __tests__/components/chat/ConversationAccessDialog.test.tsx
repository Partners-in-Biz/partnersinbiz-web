import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ConversationAccessDialog from '@/components/chat/ConversationAccessDialog'
import type { Conversation } from '@/lib/conversations/types'

const conversation = {
  id: 'conv-1',
  orgId: 'org-1',
  startedBy: 'owner-1',
  title: 'Workspace planning',
  participants: [
    { kind: 'user' as const, uid: 'owner-1', role: 'client' as const, displayName: 'Owner' },
    { kind: 'agent' as const, agentId: 'pip', name: 'Pip' },
  ],
  participantUids: ['owner-1'],
  participantAgentIds: ['pip'],
  messageCount: 0,
  archived: false,
  workspaceContext: {
    workspaceId: 'acme', orgId: 'org-1', orgName: 'Acme', orgSlug: 'acme', agentDomain: 'acme',
    vpsPath: '/var/lib/hermes/Cowork/partners/Acme', localPath: '~/Cowork/partners/Acme', sourceOfTruth: 'vps' as const,
    syncMode: 'hybrid', defaultRuntimeTarget: 'vps', runtimeTarget: 'vps', ownerUserId: 'owner-1',
    shareMode: 'private' as const,
  },
} as Conversation

function response(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: async () => body } as Response
}

describe('ConversationAccessDialog', () => {
  beforeEach(() => {
    jest.spyOn(window, 'confirm').mockReturnValue(true)
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/v1/orgs/org-1/people') {
        return response({ data: [
          { uid: 'member-2', displayName: 'Member Two', email: 'member@example.com', role: 'client' },
          { uid: 'member-3', displayName: 'Member Three', email: 'member3@example.com', role: 'client' },
        ] })
      }
      if (String(input) === '/api/v1/conversations/conv-1' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        return response({ data: { conversation: {
          ...conversation,
          participantUids: body.participantUids,
          workspaceContext: { ...conversation.workspaceContext, shareMode: body.shareMode },
        } } })
      }
      throw new Error(`Unhandled fetch ${String(input)}`)
    })
  })

  it('keeps the access footer reachable in short phone and tablet viewports', () => {
    render(<ConversationAccessDialog conversation={conversation} onClose={jest.fn()} onUpdated={jest.fn()} />)

    expect(screen.getByRole('dialog', { name: 'Manage conversation access' })).toHaveClass('max-h-[calc(100dvh-2rem)]', 'flex-col')
    expect(screen.getByTestId('conversation-access-scroll-body')).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto')
    expect(screen.getByRole('button', { name: 'Save access' }).closest('footer')).toHaveClass('shrink-0')
  })

  it('requires another person for selected-people access', async () => {
    render(<ConversationAccessDialog conversation={conversation} onClose={jest.fn()} onUpdated={jest.fn()} />)
    fireEvent.click(screen.getByText('Selected people'))
    await screen.findByText('Member Two')
    fireEvent.click(screen.getByRole('button', { name: 'Save access' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Select at least one additional person')
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('saves selected collaborators and returns the updated conversation', async () => {
    const onUpdated = jest.fn()
    const onClose = jest.fn()
    render(<ConversationAccessDialog conversation={conversation} onClose={onClose} onUpdated={onUpdated} />)
    fireEvent.click(screen.getByText('Selected people'))
    await screen.findByText('Member Two')
    fireEvent.click(screen.getByText('Member Two'))
    fireEvent.click(screen.getByRole('button', { name: 'Save access' }))

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({
      participantUids: ['owner-1', 'member-2'],
      workspaceContext: expect.objectContaining({ shareMode: 'shared' }),
    })))
    expect(onClose).toHaveBeenCalled()
    expect(global.fetch).toHaveBeenLastCalledWith('/api/v1/conversations/conv-1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ shareMode: 'shared', participantUids: ['owner-1', 'member-2'], expectedAccessVersion: 0 }),
    }))
  })

  it('selects and clears an entire department in access management', async () => {
    const onUpdated = jest.fn()
    const onClose = jest.fn()
    const groupConversation = {
      ...conversation,
      workspaceContext: undefined,
    } as Conversation
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/v1/orgs/org-1/people') {
        return response({
          data: [
            { uid: 'member-2', displayName: 'Member Two', email: 'member@example.com', role: 'client', department: 'Sales' },
            { uid: 'member-3', displayName: 'Member Three', email: 'member3@example.com', role: 'client', department: 'Sales' },
          ],
        })
      }
      if (String(input) === '/api/v1/conversations/conv-1' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        return response({ data: { conversation: {
          ...groupConversation,
          participantUids: body.participantUids,
          workspaceContext: groupConversation.workspaceContext,
        } } })
      }
      throw new Error(`Unhandled fetch ${String(input)}`)
    })

    render(<ConversationAccessDialog conversation={groupConversation} onClose={onClose} onUpdated={onUpdated} />)
    const initialGroupCheckbox = await screen.findByLabelText('Select department Sales (0/2)')
    fireEvent.click(initialGroupCheckbox)
    await screen.findByLabelText('Select department Sales (2/2)')

    const groupCheckbox = screen.getByLabelText('Select department Sales (2/2)')
    fireEvent.click(groupCheckbox)
    fireEvent.click(screen.getByRole('button', { name: 'Save access' }))

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({
      participantUids: ['owner-1'],
    })))
    expect(onClose).toHaveBeenCalled()
    expect(global.fetch).toHaveBeenLastCalledWith('/api/v1/conversations/conv-1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({
        participantUids: ['owner-1'],
        expectedAccessVersion: 0,
      }),
    }))
  })

  it('manages explicit participants for a non-Workspace group chat', async () => {
    const groupConversation = {
      ...conversation,
      title: 'Sales team',
      workspaceContext: undefined,
    } as Conversation
    const onUpdated = jest.fn()
    render(<ConversationAccessDialog conversation={groupConversation} onClose={jest.fn()} onUpdated={onUpdated} />)

    expect(await screen.findByRole('dialog', { name: 'Manage people' })).toBeInTheDocument()
    expect(screen.queryByText('Organisation')).not.toBeInTheDocument()
    fireEvent.click(await screen.findByText('Member Two'))
    fireEvent.click(screen.getByRole('button', { name: 'Save access' }))

    await waitFor(() => expect(global.fetch).toHaveBeenLastCalledWith(
      '/api/v1/conversations/conv-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          participantUids: ['owner-1', 'member-2'],
          expectedAccessVersion: 0,
        }),
      }),
    ))
  })
})
