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

let mockUser: MockUser = { uid: 'client-1', role: 'client' }

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

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockUser = { uid: 'client-1', role: 'client' }

  mockCollection.mockImplementation((name: string) => {
    if (name === 'users') {
      return {
        doc: (uid: string) => ({
          get: async () => ({
            exists: true,
            data: () => ({
              displayName: uid === 'client-1' ? 'Client User' : 'Pip',
              email: `${uid}@example.com`,
            }),
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
              name: agentId === 'maya' ? 'Maya' : 'Pip',
              baseUrl: 'https://hermes.example.com',
              skillPolicy: {
                runtimeSkills: ['content-engine', 'social-media-manager'],
                pibSkills: ['content-engine', 'social-media-manager'],
                globalSkills: ['google-workspace'],
                capabilities: ['read', 'draft', 'write'],
                approvalGates: ['publish'],
                primaryOwnerOf: ['content-engine'],
              },
            }),
          }),
        }),
      }
    }
    throw new Error(`Unexpected collection: ${name}`)
  })
  mockCreateMessage.mockImplementation(async (_convId: string, input: Record<string, unknown>) => ({
    id: input.role === 'assistant' ? 'assistant-1' : 'msg-1',
    ...input,
  }))
  mockMessagesCollection.mockReturnValue({
    doc: () => ({
      update: jest.fn().mockResolvedValue(undefined),
    }),
  })
  mockTouchConversation.mockResolvedValue(undefined)
  mockListMessages.mockResolvedValue([])
  mockGetAgentDecryptedKey.mockResolvedValue('secret')
  mockCreateHermesRun.mockResolvedValue({
    response: { ok: true },
    data: { run_id: 'run-1' },
    runDocId: 'run-doc-1',
  })
})

function req() {
  return new NextRequest('http://localhost/api/v1/conversations/conv-1/messages', {
    method: 'POST',
    body: JSON.stringify({ content: 'Hello' }),
  })
}

function reqWithAttachments() {
  return new NextRequest('http://localhost/api/v1/conversations/conv-1/messages', {
    method: 'POST',
    body: JSON.stringify({
      content: 'image',
      attachments: [
        {
          id: 'upload-1',
          name: 'Screenshot.png',
          url: 'https://cdn.example.com/screenshot.png',
          contentType: 'image/png',
          sizeBytes: 1234,
        },
      ],
    }),
  })
}

async function readJson(res: Response) {
  return JSON.parse(await res.text())
}

describe('unified conversation message routing', () => {
  it('does not dispatch an agent run for human-only conversations', async () => {
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1', 'admin-1'],
      participantAgentIds: [],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' },
        { kind: 'user', uid: 'admin-1', role: 'admin', displayName: 'Admin User' },
      ],
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockCreateHermesRun).not.toHaveBeenCalled()
    const body = await readJson(res)
    expect(body.data.message.id).toBe('msg-1')
    expect(body.data.assistantMessage).toBeUndefined()
  })

  it('still dispatches an agent run when an agent participant is present', async () => {
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1'],
      participantAgentIds: ['pip'],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' },
        { kind: 'agent', agentId: 'pip', name: 'Pip' },
      ],
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockCreateHermesRun).toHaveBeenCalledTimes(1)
    const body = await readJson(res)
    expect(body.data.assistantMessage.id).toBe('assistant-1')
    expect(body.data.runId).toBe('run-1')
    expect(body.data.dispatchAgentId).toBe('pip')
  })

  it('injects selected agent skills and approval gates into the dispatched prompt', async () => {
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1'],
      participantAgentIds: ['maya'],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' },
        { kind: 'agent', agentId: 'maya', name: 'Maya' },
      ],
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockCreateHermesRun).toHaveBeenCalledTimes(1)
    const prompt = mockCreateHermesRun.mock.calls[0][2].prompt as string
    expect(prompt).toContain('[Selected agent skills]')
    expect(prompt).toContain('agent: Maya (maya)')
    expect(prompt).toContain('available-skills: content-engine, social-media-manager, google-workspace')
    expect(prompt).toContain('capabilities: read, draft, write')
    expect(prompt).toContain('approval-gates: publish')
  })

  it('returns a failed assistant message instead of a 500 when agent key decrypt fails', async () => {
    const update = jest.fn().mockResolvedValue(undefined)
    mockMessagesCollection.mockReturnValue({ doc: () => ({ update }) })
    mockGetAgentDecryptedKey.mockRejectedValue(new Error('Missing env var: SOCIAL_TOKEN_MASTER_KEY'))
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1'],
      participantAgentIds: ['pip'],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' },
        { kind: 'agent', agentId: 'pip', name: 'Pip' },
      ],
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockCreateHermesRun).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error: 'Agent dispatch is not configured for this Preview environment.',
    }))
    const body = await readJson(res)
    expect(body.data.assistantMessage.status).toBe('failed')
  })

  it('stores validated message attachments with the user message', async () => {
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1', 'admin-1'],
      participantAgentIds: [],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' },
        { kind: 'user', uid: 'admin-1', role: 'admin', displayName: 'Admin User' },
      ],
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(reqWithAttachments(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockCreateMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      attachments: [
        {
          id: 'upload-1',
          name: 'Screenshot.png',
          url: 'https://cdn.example.com/screenshot.png',
          contentType: 'image/png',
          sizeBytes: 1234,
        },
      ],
    }))
  })
})
