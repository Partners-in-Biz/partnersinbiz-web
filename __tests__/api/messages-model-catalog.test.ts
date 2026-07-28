import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin' | 'client' | 'ai'; orgId: string }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockGetConversation = jest.fn()
const mockCollection = jest.fn()
const mockCallAgentPath = jest.fn()

let mockUser: MockUser = { uid: 'admin-1', role: 'admin', orgId: 'org-1' }

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: mockGetConversation,
}))

jest.mock('@/lib/agents/team', () => ({
  callAgentPath: mockCallAgentPath,
}))

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockUser = { uid: 'admin-1', role: 'admin', orgId: 'org-1' }
  mockGetConversation.mockResolvedValue({
    id: 'conv-1',
    orgId: 'org-1',
    participantUids: ['admin-1', 'client-1'],
    participantAgentIds: ['pip'],
    participants: [
      { kind: 'user', uid: 'admin-1', role: 'admin', displayName: 'Admin User' },
      { kind: 'user', uid: 'client-1', role: 'client', displayName: 'Client User' },
      { kind: 'agent', agentId: 'pip', name: 'Pip' },
    ],
  })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'agent_team') {
      return {
        doc: (agentId: string) => ({
          get: async () => ({
            exists: true,
            data: () => ({
              agentId,
              defaultModel: 'anthropic/claude-sonnet-4.6',
              baseUrl: 'https://secret-runtime.example.com',
              apiKey: 'encrypted-secret',
              enabled: true,
            }),
          }),
        }),
      }
    }
    throw new Error(`Unexpected collection: ${name}`)
  })
  mockCallAgentPath.mockImplementation(async (_agentId: string, path: string) => {
    if (path === '/admin/config') {
      return {
        response: { ok: true, status: 200 },
        data: {
          config: {
            model: { provider: 'openai-codex', default: 'gpt-5.6-luna' },
            fallback_providers: [
              { provider: 'xai', model: 'grok-4.20-0309-reasoning' },
              { provider: 'gemini', model: 'gemini-2.5-pro' },
            ],
          },
        },
      }
    }
    return {
      response: { ok: true, status: 200 },
      data: {
        data: [
          { id: 'claude-haiku-4-5', provider: 'anthropic', display_name: 'Claude Haiku 4.5' },
          { id: 'claude-sonnet-4-6', provider: 'anthropic', display_name: 'Claude Sonnet 4.6', supportsThinking: true },
          { id: 'gpt-5.6-luna', provider: 'openai-codex', display_name: 'GPT 5.6 Luna' },
          { id: 'gemini-2.5-pro', provider: 'gemini', display_name: 'Gemini 2.5 Pro' },
          { id: 'openai/gpt-5.5', provider: 'openai', display_name: 'GPT-5.5' },
        ],
      },
    }
  })
})

async function readJson(res: Response) {
  return JSON.parse(await res.text())
}

describe('conversation model catalogue API', () => {
  it('returns a sanitized Hermes model catalogue for admins', async () => {
    const { GET } = await import('@/app/api/v1/conversations/[convId]/models/route')

    const res = await GET(
      new NextRequest('http://localhost/api/v1/conversations/conv-1/models'),
      { params: Promise.resolve({ convId: 'conv-1' }) },
    )

    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.data).toEqual(expect.objectContaining({
      agentId: 'pip',
      canSelect: true,
      currentModel: 'gpt-5.6-luna',
      currentProvider: 'openai-codex',
      autoModel: 'gpt-5.6-luna',
      autoProvider: 'openai-codex',
      runtimeSource: 'live_config',
      source: 'hermes',
    }))
    expect(body.data.models).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'gpt-5.6-luna',
        provider: 'openai-codex',
        active: true,
        available: true,
      }),
      expect.objectContaining({
        id: 'gemini-2.5-pro',
        provider: 'gemini',
        available: true,
      }),
      expect.objectContaining({
        id: 'claude-sonnet-4-6',
        provider: 'anthropic',
        available: false,
        reasonUnavailable: expect.stringMatching(/No credentials configured for Anthropic/i),
      }),
      expect.objectContaining({
        id: 'openai/gpt-5.5',
        provider: 'openai',
        available: true,
      }),
    ]))
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('encrypted-secret')
    expect(raw).not.toContain('secret-runtime')
    expect(mockCallAgentPath).toHaveBeenCalledWith('pip', '/v1/models', { method: 'GET' }, { runtimeTarget: undefined })
    expect(mockCallAgentPath).toHaveBeenCalledWith('pip', '/admin/config', {}, { runtimeTarget: undefined })
  })

  it('lets conversation participants select models for the unlocked providers', async () => {
    mockUser = { uid: 'client-1', role: 'client', orgId: 'org-1' }
    const { GET } = await import('@/app/api/v1/conversations/[convId]/models/route')

    const res = await GET(
      new NextRequest('http://localhost/api/v1/conversations/conv-1/models'),
      { params: Promise.resolve({ convId: 'conv-1' }) },
    )

    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.data.canSelect).toBe(true)
    expect(JSON.stringify(body)).not.toContain('encrypted-secret')
  })

  it('rejects non-participants', async () => {
    mockUser = { uid: 'client-2', role: 'client', orgId: 'org-1' }
    const { GET } = await import('@/app/api/v1/conversations/[convId]/models/route')

    const res = await GET(
      new NextRequest('http://localhost/api/v1/conversations/conv-1/models'),
      { params: Promise.resolve({ convId: 'conv-1' }) },
    )

    expect(res.status).toBe(403)
    expect(mockCallAgentPath).not.toHaveBeenCalled()
  })

  it('falls back to the agent default model when Hermes catalogue is unavailable', async () => {
    mockCallAgentPath.mockImplementation(async (_agentId: string, path: string) => {
      if (path === '/admin/config') {
        return {
          response: { ok: true, status: 200 },
          data: {
            config: {
              model: { provider: 'openai-codex', default: 'gpt-5.6-luna' },
            },
          },
        }
      }
      throw new Error('gateway down')
    })
    const { GET } = await import('@/app/api/v1/conversations/[convId]/models/route')

    const res = await GET(
      new NextRequest('http://localhost/api/v1/conversations/conv-1/models'),
      { params: Promise.resolve({ convId: 'conv-1' }) },
    )

    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.data.warning).toContain('unavailable')
    expect(body.data.autoModel).toBe('gpt-5.6-luna')
    expect(body.data.autoProvider).toBe('openai-codex')
    expect(body.data.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'gpt-5.6-luna', available: true, active: true }),
      expect.objectContaining({ id: 'anthropic/claude-sonnet-4.6', source: 'agent-default', available: false }),
    ]))
  })

  it('shows the complete supported catalogue for connected providers when a linked runtime cannot serve live models', async () => {
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'org-1',
      participantUids: ['admin-1'],
      participantAgentIds: ['pip'],
      participants: [
        { kind: 'user', uid: 'admin-1', role: 'admin', displayName: 'Admin User' },
        { kind: 'agent', agentId: 'pip', name: 'Pip' },
      ],
      workspaceContext: { runtimeTarget: 'local' },
    })
    mockCallAgentPath.mockRejectedValue(new Error('linked computer loopback endpoint is not public'))

    jest.doMock('@/lib/llm-providers/store', () => ({
      listLlmProviderConnections: jest.fn().mockResolvedValue([
        {
          provider: 'openai-codex',
          hermesProvider: 'openai-codex',
          scope: 'user',
          status: 'connected',
          hasCredentials: true,
        },
        {
          provider: 'xai-oauth',
          hermesProvider: 'xai-oauth',
          scope: 'user',
          status: 'connected',
          hasCredentials: true,
        },
      ]),
    }))
    jest.doMock('@/lib/llm-providers/sync-targets', () => ({
      isOrgVpsConversationRuntime: jest.fn().mockReturnValue(false),
      runtimeBelongsToUserComputer: jest.fn().mockResolvedValue(true),
    }))

    const { GET } = await import('@/app/api/v1/conversations/[convId]/models/route')
    const res = await GET(
      new NextRequest('http://localhost/api/v1/conversations/conv-1/models'),
      { params: Promise.resolve({ convId: 'conv-1' }) },
    )

    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.data.warning).toMatch(/showing the supported catalogue/i)
    expect(body.data.selectableModelCount).toBe(16)
    expect(body.data.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'gpt-5.6-luna', provider: 'openai-codex', connected: true, available: true }),
      expect.objectContaining({ id: 'gpt-5.6-sol', provider: 'openai-codex', connected: true, available: true }),
      expect.objectContaining({ id: 'gpt-5.6-terra', provider: 'openai-codex', connected: true, available: true }),
      expect.objectContaining({ id: 'grok-4.20-multi-agent-0309', provider: 'xai-oauth', connected: true, available: true }),
    ]))
  })
})
