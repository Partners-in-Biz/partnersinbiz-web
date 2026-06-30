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
let organizationSettings: Record<string, unknown> = {}
let organizationMembers: Array<{ userId: string; role: string }> = []

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
  organizationSettings = {}
  organizationMembers = [{ userId: 'client-1', role: 'member' }]

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
    if (name === 'organizations') {
      return {
        doc: (orgId: string) => ({
          get: async () => ({
            exists: orgId === 'org-1' || orgId === 'pib-platform-owner',
            data: () => ({
              members: organizationMembers,
              settings: organizationSettings,
            }),
          }),
        }),
      }
    }
    if (name === 'orgMembers') {
      return {
        doc: (_id: string) => ({
          get: async () => ({ exists: false, data: () => undefined }),
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

function req(input: { content?: string } = {}) {
  return new NextRequest('http://localhost/api/v1/conversations/conv-1/messages', {
    method: 'POST',
    body: JSON.stringify({ content: input.content ?? 'Hello' }),
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

  it('blocks client replies when the messages reply policy denies their org role', async () => {
    organizationSettings = {
      modulePolicies: {
        messages: {
          actions: {
            reply: { owner: true, admin: true, member: false },
          },
        },
      },
    }
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'org-1',
      participantUids: ['client-1', 'admin-1'],
      participantAgentIds: [],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' },
        { kind: 'user', uid: 'admin-1', role: 'admin', displayName: 'Admin User' },
      ],
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(403)
    expect(mockCreateMessage).not.toHaveBeenCalled()
    expect(mockCreateHermesRun).not.toHaveBeenCalled()
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

  it('includes the CEO data-first dashboard rule in every agent prompt', async () => {
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

    const res = await POST(req({ content: 'Build me a dashboard for marketing performance' }), {
      params: Promise.resolve({ convId: 'conv-1' }),
    })

    expect(res.status).toBe(201)
    const prompt = mockCreateHermesRun.mock.calls[0][2].prompt as string
    expect(prompt).toContain('[CEO data-decision operating rule]')
    expect(prompt).toContain('Do not default to permanent dashboards')
    expect(prompt).toContain('Confirm the needed facts are stored in the database')
    expect(prompt).toContain('Use or create a reusable gather skill/workflow')
    expect(prompt).toContain('Run focused analysis for the specific decision')
    expect(prompt).toContain('Create temporary throw-away HTML only when useful')
    expect(prompt).toContain('Do not make server Markdown, local files, logs, or a hidden dashboard the CEO-facing delivery surface')
    expect(prompt).toContain('Return the decision, evidence, reusable workflow, and next actions in this dynamic chat window')
    expect(prompt).toContain('If you persist Markdown/docs for internal memory, summarize every actionable outcome in chat')
    expect(prompt).toContain('Temporary HTML is allowed only as a throw-away linked/attached artifact inside the chat thread')
    expect(prompt).toContain('When you need CEO approval, return a structured rich message, not a Markdown-only card')
    expect(prompt).toContain('type "approval_card"')
    expect(prompt).toContain('Approval cards must include: title, body, statusLabel, evidence, dataSkill, analysisQuestion, decisions, recommendation, replyTemplate, and safetyNote')
    expect(prompt).toContain('Use approval_card for deal follow-ups, Marketing Studio publish/schedule decisions')
    expect(prompt).toContain('"rich_parts":[{"type":"approval_card"')
    expect(prompt).toContain('Build me a dashboard for marketing performance')
  })

  it('routes multi-agent conversations through Pip with council-style orchestration guidance', async () => {
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'pib-platform-owner',
      participantUids: ['client-1'],
      participantAgentIds: ['pip', 'maya', 'theo'],
      participants: [
        { kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' },
        { kind: 'agent', agentId: 'pip', name: 'Pip' },
        { kind: 'agent', agentId: 'maya', name: 'Maya' },
        { kind: 'agent', agentId: 'theo', name: 'Theo' },
      ],
    })
    const { POST } = await import('@/app/api/v1/conversations/[convId]/messages/route')

    const res = await POST(req(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockCreateHermesRun).toHaveBeenCalledTimes(1)
    const prompt = mockCreateHermesRun.mock.calls[0][2].prompt as string
    expect(prompt).toContain('[Multi-agent orchestration]')
    expect(prompt).toContain('Council-style multi-agent orchestration requirements:')
    expect(prompt).toContain('Hermes subagents for bounded one-off analysis')
    expect(prompt).toContain('Theo=engineering')
    expect(mockCreateHermesRun.mock.calls[0][2].metadata).toEqual(expect.objectContaining({
      dispatchAgentId: 'pip',
      requestedAgentIds: ['pip', 'maya', 'theo'],
      orchestrationMode: 'pip-orchestrator',
    }))
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

  it('injects council-mode guidance when the /council slash command is used', async () => {
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

    const res = await POST(new NextRequest('http://localhost/api/v1/conversations/conv-1/messages', {
      method: 'POST',
      body: JSON.stringify({
        content: 'Should we launch the new workflow this week?',
        slashCommand: {
          id: 'council',
          token: '/council',
          label: 'Council mode',
          executorKind: 'agent_intent',
          args: 'Should we launch the new workflow this week?',
        },
      }),
    }), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockCreateHermesRun).toHaveBeenCalledTimes(1)
    const prompt = mockCreateHermesRun.mock.calls[0][2].prompt as string
    expect(prompt).toContain('id: council')
    expect(prompt).toContain('Council mode requirements:')
    expect(prompt).toContain('Select the relevant PiB specialist perspectives')
    expect(prompt).toContain('consensus/recommendation')
    expect(mockCreateMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      slashCommand: expect.objectContaining({
        id: 'council',
        token: '/council',
        args: 'Should we launch the new workflow this week?',
      }),
    }))
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
