import { NextRequest } from 'next/server'

type MockUser = {
  uid: string
  role: 'admin' | 'client' | 'ai'
}
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockCollection = jest.fn()
const mockGetConversation = jest.fn()
const mockCreateMessage = jest.fn()
const mockListMessages = jest.fn()
const mockTouchConversation = jest.fn()
const mockMessagesCollection = jest.fn()
const mockCreateHermesRun = jest.fn()
const mockGetAgentDecryptedKey = jest.fn()
const mockResolveContextReferences = jest.fn()
const mockBuildAttachedContextBlock = jest.fn()

let mockUser: MockUser = { uid: 'admin-1', role: 'admin' }

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: mockGetConversation,
  createMessage: mockCreateMessage,
  listMessages: mockListMessages,
  touchConversation: mockTouchConversation,
  messagesCollection: mockMessagesCollection,
}))

jest.mock('@/lib/hermes/server', () => ({
  createHermesRun: mockCreateHermesRun,
}))

jest.mock('@/lib/agents/team', () => ({
  getAgentDecryptedKey: mockGetAgentDecryptedKey,
}))

jest.mock('@/lib/context-references/registry', () => ({
  resolveContextReferences: (refs: unknown, user: unknown, orgId?: string) => mockResolveContextReferences(refs, user, orgId),
  buildAttachedContextBlock: (refs: unknown) => mockBuildAttachedContextBlock(refs),
}))

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockUser = { uid: 'admin-1', role: 'admin' }

  mockCollection.mockImplementation((name: string) => {
    if (name === 'users') {
      return {
        doc: (uid: string) => ({
          get: async () => ({
            exists: true,
            data: () => ({ displayName: uid === 'admin-1' ? 'Peet' : 'Pip' }),
          }),
        }),
      }
    }
    if (name === 'agent_team') {
      return {
        doc: (agentId: string) => ({
          get: async () => ({
            exists: true,
            data: () => ({
              agentId,
              enabled: true,
              name: 'Pip',
              baseUrl: 'https://hermes.example.com',
            }),
          }),
        }),
      }
    }
    if (name === 'organizations') {
      return {
        doc: () => ({ get: async () => ({ exists: false }) }),
      }
    }
    throw new Error(`Unexpected collection: ${name}`)
  })
  mockCreateMessage.mockImplementation(async (_convId: string, input: Record<string, unknown>) => ({
    id: input.role === 'assistant' ? 'assistant-1' : 'msg-1',
    ...input,
  }))
  mockMessagesCollection.mockReturnValue({
    doc: () => ({ update: jest.fn().mockResolvedValue(undefined) }),
  })
  mockTouchConversation.mockResolvedValue(undefined)
  mockListMessages.mockResolvedValue([])
  mockGetAgentDecryptedKey.mockResolvedValue('secret')
  mockCreateHermesRun.mockResolvedValue({
    response: { ok: true },
    data: { run_id: 'run-1' },
    runDocId: 'run-doc-1',
  })
  mockResolveContextReferences.mockResolvedValue([
    {
      type: 'contact',
      id: 'contact-1',
      orgId: 'org-1',
      label: 'Jane Client',
      origin: 'current_page',
      summary: 'Contact: Jane Client',
    },
  ])
  mockBuildAttachedContextBlock.mockReturnValue('[Attached context]\n- contact: Jane Client\n  id: contact-1\n---\n\n')
})

describe('conversation message context dispatch', () => {
  it('stores message context refs and prepends resolved attached context to Hermes input', async () => {
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'org-1',
      participantUids: ['admin-1'],
      participantAgentIds: ['pip'],
      participants: [
        { kind: 'user', uid: 'admin-1', role: 'admin', displayName: 'Peet' },
        { kind: 'agent', agentId: 'pip', name: 'Pip' },
      ],
      contextRefs: [
        { type: 'contact', id: 'contact-1', orgId: 'org-1', label: 'Jane Client', origin: 'current_page' },
      ],
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')
    const req = new NextRequest('http://localhost/api/v1/conversations/conv-1/messages', {
      method: 'POST',
      body: JSON.stringify({
        content: 'What should we do next?',
        contextRefs: [{ type: 'contact', id: 'contact-1', orgId: 'org-1', origin: 'current_page' }],
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockCreateMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      role: 'user',
      contextRefs: [expect.objectContaining({ id: 'contact-1', label: 'Jane Client' })],
    }))
    expect(mockCreateHermesRun).toHaveBeenCalledWith(expect.anything(), 'admin-1', expect.objectContaining({
      prompt: expect.stringContaining('[Attached context]'),
      metadata: expect.objectContaining({
        contextRefs: [expect.objectContaining({ id: 'contact-1', type: 'contact' })],
      }),
    }))
  })

  it('sanitizes slash command metadata and prepends it to Hermes input', async () => {
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'org-1',
      participantUids: ['admin-1'],
      participantAgentIds: ['pip'],
      participants: [
        { kind: 'user', uid: 'admin-1', role: 'admin', displayName: 'Peet' },
        { kind: 'agent', agentId: 'pip', name: 'Pip' },
      ],
      contextRefs: [],
    })
    mockResolveContextReferences.mockResolvedValue([])
    mockBuildAttachedContextBlock.mockReturnValue('')
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')
    const req = new NextRequest('http://localhost/api/v1/conversations/conv-1/messages', {
      method: 'POST',
      body: JSON.stringify({
        content: 'Create this as a task',
        slashCommand: {
          id: 'fake-id',
          token: '/task',
          label: 'Wrong label from client',
          executorKind: 'fake',
          args: 'Create this as a task',
        },
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockCreateMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      slashCommand: expect.objectContaining({
        id: 'task',
        token: '/task',
        label: 'Create task',
        executorKind: 'agent_intent',
        args: 'Create this as a task',
      }),
    }))
    expect(mockCreateHermesRun).toHaveBeenCalledWith(expect.anything(), 'admin-1', expect.objectContaining({
      prompt: expect.stringContaining('[Slash command]\nid: task'),
      metadata: expect.objectContaining({
        slashCommand: expect.objectContaining({ id: 'task', token: '/task' }),
      }),
    }))
  })
})
