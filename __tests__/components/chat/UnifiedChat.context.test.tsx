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
      if (url.includes('/visible-agents')) {
        return jsonResponse({
          data: [
            {
              agentId: 'pip',
              name: 'Pip',
              role: 'Operator',
              persona: 'Routes work',
              iconKey: 'robot_2',
              colorKey: 'violet',
              enabled: true,
              baseUrl: 'https://agent.example.com',
              defaultModel: 'gpt-5',
              skills: ['partnersinbiz/client-manager'],
              skillPolicy: {
                runtimeSkills: ['content-engine', 'social-media-manager'],
                pibSkills: ['content-engine', 'social-media-manager'],
                globalSkills: ['google-workspace'],
                capabilities: ['read', 'draft', 'write'],
                approvalGates: ['publish'],
              },
            },
          ],
        })
      }
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
        currentPageContext={{
          type: 'company',
          id: 'company-1',
          orgId: 'org-1',
          origin: 'current_page',
          href: '/portal/companies/company-1',
        }}
      />,
    )

    const input = await screen.findByPlaceholderText('Send a message')
    fireEvent.change(input, { target: { value: 'Compare @projects:launch' } })

    fireEvent.click(await screen.findByText('Launch Project'))

    await waitFor(() => expect(screen.getByTitle('project: Launch Project')).toBeInTheDocument())
    expect(input).toHaveValue('Compare')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('contextType=company'),
      expect.anything(),
    )
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('contextId=company-1'),
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

  it('shows slash commands and sends structured command metadata', async () => {
    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
      />,
    )

    const input = await screen.findByPlaceholderText('Send a message')
    fireEvent.change(input, { target: { value: '/' } })

    expect(await screen.findByRole('button', { name: 'Use /task' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use /route' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use /council' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Use /task' }))
    expect(input).toHaveValue('/task ')

    fireEvent.change(input, { target: { value: '/task Follow up with Theo about slash commands' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      const messagePost = mockFetch.mock.calls.find(([url, init]) =>
        String(url) === '/api/v1/conversations/conv-1/messages' && init?.method === 'POST',
      )
      expect(messagePost).toBeTruthy()
      const body = JSON.parse(messagePost![1].body as string)
      expect(body.content).toBe('Follow up with Theo about slash commands')
      expect(body.slashCommand).toMatchObject({
        id: 'task',
        token: '/task',
        executorKind: 'agent_intent',
        args: 'Follow up with Theo about slash commands',
      })
    })
  })

  it('sends /council as structured command metadata', async () => {
    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
      />,
    )

    const input = await screen.findByPlaceholderText('Send a message')
    fireEvent.change(input, { target: { value: '/council Should we launch the new workflow this week?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      const messagePost = mockFetch.mock.calls.find(([url, init]) =>
        String(url) === '/api/v1/conversations/conv-1/messages' && init?.method === 'POST',
      )
      expect(messagePost).toBeTruthy()
      const body = JSON.parse(messagePost![1].body as string)
      expect(body.content).toBe('Should we launch the new workflow this week?')
      expect(body.slashCommand).toMatchObject({
        id: 'council',
        token: '/council',
        executorKind: 'agent_intent',
        args: 'Should we launch the new workflow this week?',
      })
    })
  })

  it('shows selected agent skills and exposes /skills as structured command intent', async () => {
    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
      />,
    )

    const input = await screen.findByPlaceholderText('Send a message')
    expect(await screen.findByRole('button', { name: 'Show Pip skills' })).toBeInTheDocument()
    expect(screen.getByText('content-engine')).toBeInTheDocument()
    expect(screen.getByText('social-media-manager')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: '/sk' } })
    expect(await screen.findByRole('button', { name: 'Use /skills' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Use /skills' }))
    expect(input).toHaveValue('/skills ')

    fireEvent.change(input, { target: { value: '/skills content campaigns' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      const messagePost = mockFetch.mock.calls.find(([url, init]) =>
        String(url) === '/api/v1/conversations/conv-1/messages' && init?.method === 'POST',
      )
      expect(messagePost).toBeTruthy()
      const body = JSON.parse(messagePost![1].body as string)
      expect(body.content).toBe('content campaigns')
      expect(body.slashCommand).toMatchObject({
        id: 'skills',
        token: '/skills',
        executorKind: 'agent_intent',
        args: 'content campaigns',
      })
    })
  })

  it('treats /use-current-page as a structured pin-only command with no message send', async () => {
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
    fireEvent.change(input, { target: { value: '/use-current-page' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => expect(screen.getByTitle('contact: Jane Client')).toBeInTheDocument())
    const messagePosts = mockFetch.mock.calls.filter(([url, init]) =>
      String(url) === '/api/v1/conversations/conv-1/messages' && init?.method === 'POST',
    )
    expect(messagePosts).toHaveLength(0)
  })

  it('allows attaching a file before an auto-created agent conversation exists', async () => {
    mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/visible-agents')) {
        return jsonResponse({ data: [] })
      }
      if (url.startsWith('/api/v1/conversations?')) {
        return jsonResponse({ data: { conversations: [] } })
      }
      if (url === '/api/v1/conversations' && init?.method === 'POST') {
        return jsonResponse({
          data: {
            conversation: {
              ...baseConversation,
              id: 'conv-created',
              title: 'Attachment conversation',
            },
          },
        })
      }
      if (url === '/api/v1/conversations/conv-created/attachments' && init?.method === 'POST') {
        return jsonResponse({
          data: {
            id: 'file-1',
            name: 'brief.pdf',
            url: 'https://files.example.com/brief.pdf',
            contentType: 'application/pdf',
            sizeBytes: 1024,
          },
        })
      }
      if (url === '/api/v1/conversations/conv-created/messages') {
        if (init?.method === 'POST') {
          return jsonResponse({
            data: {
              message: {
                id: 'msg-1',
                conversationId: 'conv-created',
                role: 'user',
                content: 'Please review\n\nAttachment: brief.pdf (1.0 KB)',
                authorKind: 'user',
                authorId: 'user-1',
                authorDisplayName: 'Peet',
                status: 'completed',
              },
            },
          })
        }
        return jsonResponse({ data: { messages: [] } })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    const { container } = render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
      />,
    )

    const input = await screen.findByPlaceholderText('Message Pip')
    const attachButton = screen.getByRole('button', { name: 'Attach file' })
    expect(attachButton).not.toBeDisabled()

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['pdf'], 'brief.pdf', { type: 'application/pdf' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    expect(await screen.findByText('brief.pdf')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'Please review' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/conversations', expect.objectContaining({ method: 'POST' }))
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/conversations/conv-created/attachments', expect.objectContaining({ method: 'POST' }))
      const messagePost = mockFetch.mock.calls.find(([url, init]) =>
        String(url) === '/api/v1/conversations/conv-created/messages' && init?.method === 'POST',
      )
      expect(messagePost).toBeTruthy()
      expect(JSON.parse(messagePost![1].body as string)).toMatchObject({
        content: 'Please review\n\nAttachment: brief.pdf (1.0 KB)',
        attachments: [{ id: 'file-1', name: 'brief.pdf' }],
      })
    })
  })

  it('keeps loaded messages in a scrollable log and scrolls to the latest message', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return this.getAttribute('role') === 'log' ? 1200 : 0
      },
    })

    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/visible-agents')) {
        return jsonResponse({ data: [] })
      }
      if (url.startsWith('/api/v1/conversations?')) {
        return jsonResponse({ data: { conversations: [conversation] } })
      }
      if (url === '/api/v1/conversations/conv-1/messages') {
        return jsonResponse({
          data: {
            messages: [
              {
                id: 'msg-1',
                conversationId: 'conv-1',
                role: 'user',
                content: 'Earlier note',
                authorKind: 'user',
                authorId: 'user-1',
                authorDisplayName: 'Peet',
                status: 'completed',
                createdAt: { seconds: 1 },
              },
              {
                id: 'msg-2',
                conversationId: 'conv-1',
                role: 'assistant',
                content: 'Latest reply',
                authorKind: 'agent',
                authorId: 'pip',
                authorDisplayName: 'Pip',
                status: 'completed',
                createdAt: { seconds: 2 },
              },
            ],
          },
        })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        initialConvId="conv-1"
      />,
    )

    const messageLog = await screen.findByRole('log', { name: 'Conversation messages' })
    await screen.findByText('Latest reply')

    await waitFor(() => {
      expect(messageLog.scrollTop).toBe(1200)
    })
  })
})
