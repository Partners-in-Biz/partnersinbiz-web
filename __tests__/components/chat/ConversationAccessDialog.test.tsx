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
      if (String(input) === '/api/v1/orgs/org-1/contacts') {
        return response({ data: [
          { uid: 'member-2', displayName: 'Member Two', email: 'member@example.com', role: 'client' },
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
})
