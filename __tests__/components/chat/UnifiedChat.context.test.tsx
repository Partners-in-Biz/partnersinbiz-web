import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import UnifiedChat from '@/components/chat/UnifiedChat'
import type { ContextReference } from '@/lib/context-references/types'

jest.mock('@/components/chat/VoiceInputButton', () => ({
  __esModule: true,
  default: () => <button type="button" aria-label="Voice input" />,
}))

const baseConversation = {
  id: 'conv-1',
  orgId: 'org-1',
  participants: [{ kind: 'agent', agentId: 'pip', name: 'Pip' }],
  participantUids: ['user-1'],
  participantAgentIds: ['pip'],
  startedBy: 'user-1',
  title: 'Launch chat',
  messageCount: 0,
  archived: false,
  contextRefs: [] as ContextReference[],
}

const contactRef: ContextReference = {
  type: 'contact',
  id: 'contact-1',
  orgId: 'org-1',
  label: 'Jane Client',
  origin: 'current_page',
  href: '/admin/crm/contacts/contact-1',
}

const projectRef: ContextReference = {
  type: 'project',
  id: 'project-1',
  orgId: 'org-1',
  label: 'Launch Project',
  origin: 'mention',
  summary: 'status: development',
}

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response
}

describe('UnifiedChat context references', () => {
  let mockFetch: jest.Mock
  let conversation: typeof baseConversation

  beforeEach(() => {
    conversation = { ...baseConversation, contextRefs: [] }
    mockFetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/visible-agents')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/conversations?')) {
        return jsonResponse({ data: { conversations: [conversation] } })
      }
      if (url === '/api/v1/conversations/conv-1/messages') {
        if (init?.method === 'POST') {
          return jsonResponse({
            data: {
              message: {
                id: 'msg-1',
                conversationId: 'conv-1',
                role: 'user',
                content: 'What next?',
                authorKind: 'user',
                authorId: 'user-1',
                authorDisplayName: 'Peet',
                status: 'completed',
              },
            },
          }, true)
        }
        return jsonResponse({ data: { messages: [] } })
      }
      if (url === '/api/v1/conversations/conv-1/context') {
        const parsedBody = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
        const nextRef = parsedBody.refs?.[0]?.type === 'project' ? projectRef : contactRef
        conversation = { ...conversation, contextRefs: [nextRef] }
        return jsonResponse({ data: { contextRefs: [nextRef] } })
      }
      if (url.startsWith('/api/v1/context-references/search')) {
        return jsonResponse({ data: { refs: [projectRef] } })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    global.fetch = mockFetch
  })

  it('pins the detected current page from the drawer action', async () => {
    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        currentPageContext={{
          type: 'contact',
          id: 'contact-1',
          orgId: 'org-1',
          origin: 'current_page',
          href: '/admin/crm/contacts/contact-1',
        }}
      />,
    )

    await screen.findByPlaceholderText('Send a message')
    fireEvent.click(await screen.findByRole('button', { name: /Use current page/ }))

    await waitFor(() => expect(screen.getByTitle('contact: Jane Client')).toBeInTheDocument())
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/conversations/conv-1/context', expect.objectContaining({
      method: 'PATCH',
    }))
  })

  it('treats the exact current-page phrase as a pin-only command', async () => {
    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        currentPageContext={{
          type: 'contact',
          id: 'contact-1',
          orgId: 'org-1',
          origin: 'current_page',
          href: '/admin/crm/contacts/contact-1',
        }}
      />,
    )

    const input = await screen.findByPlaceholderText('Send a message')
    fireEvent.change(input, { target: { value: 'use current page as context' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => expect(screen.getByTitle('contact: Jane Client')).toBeInTheDocument())
    const messagePosts = mockFetch.mock.calls.filter(([url, init]) =>
      String(url) === '/api/v1/conversations/conv-1/messages' && init?.method === 'POST',
    )
    expect(messagePosts).toHaveLength(0)
  })

  it('searches and attaches namespaced @references', async () => {
    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
      />,
    )

    const input = await screen.findByPlaceholderText('Send a message')
    fireEvent.change(input, { target: { value: 'Compare @projects:launch' } })

    fireEvent.click(await screen.findByText('Launch Project'))

    await waitFor(() => expect(screen.getByTitle('project: Launch Project')).toBeInTheDocument())
    expect(input).toHaveValue('Compare')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/context-references/search?'),
      expect.anything(),
    )
  })

  it('shows reference type options for bare @ input', async () => {
    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
      />,
    )

    const input = await screen.findByPlaceholderText('Send a message')
    fireEvent.change(input, { target: { value: '@' } })

    expect(await screen.findByRole('button', { name: 'Use @projects:' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use @contacts:' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use @tasks:' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use @businesses:' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use @products:' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Use @products:' }))

    expect(input).toHaveValue('@products:')
  })
})
