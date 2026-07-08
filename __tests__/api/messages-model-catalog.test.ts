import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin' | 'client' | 'ai' }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockGetConversation = jest.fn()
const mockCollection = jest.fn()
const mockCallAgentPath = jest.fn()

let mockUser: MockUser = { uid: 'admin-1', role: 'admin' }

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
  mockUser = { uid: 'admin-1', role: 'admin' }
  mockGetConversation.mockResolvedValue({
    id: 'conv-1',
    orgId: 'org-1',
    participantUids: ['client-1'],
    participantAgentIds: ['pip'],
    participants: [
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
  mockCallAgentPath.mockResolvedValue({
    response: { ok: true, status: 200 },
    data: {
      data: [
        { id: 'anthropic/claude-sonnet-4.6', provider: 'anthropic', display_name: 'Claude Sonnet 4.6', supportsThinking: true },
        { id: 'openai/gpt-5.5', provider: 'openai', display_name: 'GPT-5.5' },
      ],
    },
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
      currentModel: 'anthropic/claude-sonnet-4.6',
      currentProvider: 'anthropic',
      source: 'hermes',
    }))
    expect(body.data.models).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'anthropic/claude-sonnet-4.6',
        provider: 'anthropic',
        active: true,
        supportsThinking: true,
      }),
      expect.objectContaining({ id: 'openai/gpt-5.5', provider: 'openai' }),
    ]))
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('encrypted-secret')
    expect(raw).not.toContain('secret-runtime')
    expect(mockCallAgentPath).toHaveBeenCalledWith('pip', '/v1/models', { method: 'GET' })
  })

  it('lets participants inspect safe model status without granting selection rights', async () => {
    mockUser = { uid: 'client-1', role: 'client' }
    const { GET } = await import('@/app/api/v1/conversations/[convId]/models/route')

    const res = await GET(
      new NextRequest('http://localhost/api/v1/conversations/conv-1/models'),
      { params: Promise.resolve({ convId: 'conv-1' }) },
    )

    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.data.canSelect).toBe(false)
    expect(JSON.stringify(body)).not.toContain('encrypted-secret')
  })

  it('rejects non-participants', async () => {
    mockUser = { uid: 'client-2', role: 'client' }
    const { GET } = await import('@/app/api/v1/conversations/[convId]/models/route')

    const res = await GET(
      new NextRequest('http://localhost/api/v1/conversations/conv-1/models'),
      { params: Promise.resolve({ convId: 'conv-1' }) },
    )

    expect(res.status).toBe(403)
    expect(mockCallAgentPath).not.toHaveBeenCalled()
  })

  it('falls back to the agent default model when Hermes catalogue is unavailable', async () => {
    mockCallAgentPath.mockRejectedValue(new Error('gateway down'))
    const { GET } = await import('@/app/api/v1/conversations/[convId]/models/route')

    const res = await GET(
      new NextRequest('http://localhost/api/v1/conversations/conv-1/models'),
      { params: Promise.resolve({ convId: 'conv-1' }) },
    )

    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.data.source).toBe('agent-default')
    expect(body.data.warning).toContain('unavailable')
    expect(body.data.models).toEqual([
      expect.objectContaining({ id: 'anthropic/claude-sonnet-4.6', source: 'agent-default' }),
    ])
  })
})
