import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin' | 'client' | 'ai'; allowedOrgIds?: string[] }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockGetAgent = jest.fn()
const mockUpdateAgent = jest.fn()
const mockCallAgentPath = jest.fn()

let mockUser: MockUser = { uid: 'super-1', role: 'admin' }

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('@/lib/api/capabilityGate', () => ({
  enforceAgentCapability: () => null,
}))

jest.mock('@/lib/agents/team', () => ({
  getAgent: (agentId: string) => mockGetAgent(agentId),
  updateAgent: (agentId: string, patch: unknown) => mockUpdateAgent(agentId, patch),
  callAgentPath: (agentId: string, path: string, init?: unknown) => mockCallAgentPath(agentId, path, init),
}))

function routeCtx(agentId = 'pip') {
  return { params: Promise.resolve({ agentId }) }
}

async function readJson(res: Response) {
  return JSON.parse(await res.text())
}

const liveConfig = {
  path: '/var/lib/hermes/profiles/pip/config.yaml',
  config: {
    model: {
      provider: 'openai-codex',
      default: 'gpt-5.6-luna',
      base_url: 'https://chatgpt.com/backend-api/codex',
    },
    agent: { max_turns: 90, reasoning_effort: '' },
    fallback_providers: [{ provider: 'xai', model: 'grok-4.20-0309-reasoning' }],
    skills: { external_dirs: ['/skills/pip'] },
  },
}

beforeEach(() => {
  jest.clearAllMocks()
  mockUser = { uid: 'super-1', role: 'admin' }
  mockGetAgent.mockResolvedValue({
    agentId: 'pip',
    name: 'Pip',
    defaultModel: 'stale-label',
    enabled: true,
  })
  mockUpdateAgent.mockImplementation(async (_id: string, patch: { defaultModel?: string }) => ({
    agentId: 'pip',
    name: 'Pip',
    defaultModel: patch.defaultModel ?? 'stale-label',
    enabled: true,
  }))
  mockCallAgentPath.mockImplementation(async (_agentId: string, path: string, init?: { method?: string; body?: string }) => {
    if (path === '/admin/config' && (!init || !init.method || init.method === 'GET')) {
      return { response: { ok: true, status: 200 }, data: liveConfig }
    }
    if (path === '/admin/config' && init?.method === 'PUT') {
      return { response: { ok: true, status: 200 }, data: { ok: true, written: true } }
    }
    return { response: { ok: false, status: 404 }, data: { error: 'not found' } }
  })
})

describe('admin agent runtime-model', () => {
  it('returns extracted live Auto model settings', async () => {
    const { GET } = await import('@/app/api/v1/admin/agents/[agentId]/runtime-model/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/admin/agents/pip/runtime-model'), routeCtx())
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.data.settings).toMatchObject({
      primaryProvider: 'openai-codex',
      primaryModel: 'gpt-5.6-luna',
      reasoningEffort: '',
      fallbacks: [{ provider: 'xai', model: 'grok-4.20-0309-reasoning' }],
    })
  })

  it('rejects restricted admins from writing runtime model settings', async () => {
    mockUser = { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-a'] }
    const { PUT } = await import('@/app/api/v1/admin/agents/[agentId]/runtime-model/route')
    const res = await PUT(new NextRequest('http://localhost/api/v1/admin/agents/pip/runtime-model', {
      method: 'PUT',
      body: JSON.stringify({
        primaryProvider: 'xai',
        primaryModel: 'grok-4',
        fallbacks: [],
      }),
    }), routeCtx())

    expect(res.status).toBe(403)
    expect(mockCallAgentPath).not.toHaveBeenCalled()
  })

  it('writes live Hermes config and syncs registry defaultModel', async () => {
    const { PUT } = await import('@/app/api/v1/admin/agents/[agentId]/runtime-model/route')
    const res = await PUT(new NextRequest('http://localhost/api/v1/admin/agents/pip/runtime-model', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        primaryProvider: 'xai',
        primaryModel: 'grok-4.20-0309-reasoning',
        primaryBaseUrl: '',
        reasoningEffort: 'high',
        fallbacks: [
          { provider: 'openai-codex', model: 'gpt-5.6-sol' },
          { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        ],
      }),
    }), routeCtx())

    expect(res.status).toBe(200)
    const body = await readJson(res)

    expect(mockCallAgentPath).toHaveBeenCalledWith(
      'pip',
      '/admin/config',
      expect.objectContaining({ method: 'PUT' }),
    )

    const putInit = mockCallAgentPath.mock.calls.find(
      (call: unknown[]) => call[1] === '/admin/config' && (call[2] as { method?: string } | undefined)?.method === 'PUT',
    )?.[2] as { body?: string }
    const written = JSON.parse(putInit.body ?? '{}')
    expect(written.config.model).toEqual({
      provider: 'xai',
      default: 'grok-4.20-0309-reasoning',
    })
    expect(written.config.agent).toMatchObject({
      max_turns: 90,
      reasoning_effort: 'high',
    })
    expect(written.config.fallback_providers).toEqual([
      { provider: 'openai-codex', model: 'gpt-5.6-sol' },
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    ])
    expect(written.config.skills).toEqual({ external_dirs: ['/skills/pip'] })

    expect(mockUpdateAgent).toHaveBeenCalledWith('pip', {
      defaultModel: 'xai / grok-4.20-0309-reasoning → openai-codex / gpt-5.6-sol',
    })
    expect(body.data.settings.reasoningEffort).toBe('high')
    expect(body.data.agent.defaultModel).toContain('xai / grok-4.20-0309-reasoning')
  })

  it('rejects invalid effort values', async () => {
    const { PUT } = await import('@/app/api/v1/admin/agents/[agentId]/runtime-model/route')
    const res = await PUT(new NextRequest('http://localhost/api/v1/admin/agents/pip/runtime-model', {
      method: 'PUT',
      body: JSON.stringify({
        primaryProvider: 'xai',
        primaryModel: 'grok-4',
        reasoningEffort: 'insane',
      }),
    }), routeCtx())

    expect(res.status).toBe(400)
    const body = await readJson(res)
    expect(body.error).toMatch(/reasoningEffort/)
  })
})
