import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin' | 'client' | 'ai'; allowedOrgIds?: string[] }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockListAgents = jest.fn()
const mockCreateAgent = jest.fn()
const mockUpdateAgent = jest.fn()
const mockCallAgentPath = jest.fn()

let mockUser: MockUser = { uid: 'super-1', role: 'admin' }

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('@/lib/agents/team', () => ({
  listAgents: () => mockListAgents(),
  createAgent: (input: unknown) => mockCreateAgent(input),
  updateAgent: (agentId: string, patch: unknown) => mockUpdateAgent(agentId, patch),
  callAgentPath: (agentId: string, path: string, init?: unknown) => mockCallAgentPath(agentId, path, init),
}))

function routeCtx(agentId = 'pip') {
  return { params: Promise.resolve({ agentId }) }
}

async function readJson(res: Response) {
  return JSON.parse(await res.text())
}

beforeEach(() => {
  jest.clearAllMocks()
  mockUser = { uid: 'super-1', role: 'admin' }
  mockListAgents.mockResolvedValue([])
  mockCreateAgent.mockResolvedValue({
    agentId: 'zara',
    name: 'Zara',
    role: 'Specialist',
    persona: 'Helps',
    defaultModel: 'gpt-5.5',
    iconKey: 'smart_toy',
    colorKey: 'sky',
    enabled: true,
    baseUrl: 'https://agent.test',
    apiKey: 'masked',
  })
  mockUpdateAgent.mockResolvedValue({
    agentId: 'pip',
    name: 'Pip',
    role: 'Orchestrator',
    persona: 'Runs Partners in Biz work.',
    defaultModel: 'gpt-5.5',
    iconKey: 'smart_toy',
    colorKey: 'sky',
    enabled: true,
    baseUrl: 'https://pip.test',
    apiKey: 'masked',
  })
  mockCallAgentPath.mockResolvedValue({
    response: { ok: true, status: 200 },
    data: { baseUrl: 'https://agent.test', apiKey: 'plain-key' },
  })
})

describe('admin agent permissions', () => {
  it('lets restricted admins list agents', async () => {
    mockUser = { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-a'] }
    const { GET } = await import('@/app/api/v1/admin/agents/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/admin/agents'))

    expect(res.status).toBe(200)
    expect(mockListAgents).toHaveBeenCalled()
  })

  it('rejects restricted admins creating agents', async () => {
    mockUser = { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-a'] }
    const { POST } = await import('@/app/api/v1/admin/agents/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/admin/agents', {
      method: 'POST',
      body: JSON.stringify({ agentId: 'zara', name: 'Zara' }),
    }))

    expect(res.status).toBe(403)
    expect(mockCreateAgent).not.toHaveBeenCalled()
  })

  it('lets super admins create agents', async () => {
    const { POST } = await import('@/app/api/v1/admin/agents/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/admin/agents', {
      method: 'POST',
      body: JSON.stringify({
        agentId: 'zara',
        name: 'Zara',
        role: 'Specialist',
        persona: 'Helps',
      }),
    }))

    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.success).toBe(true)
    expect(mockCreateAgent).toHaveBeenCalled()
  })

  it('rejects restricted admins editing agent details', async () => {
    mockUser = { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-a'] }
    const { PUT } = await import('@/app/api/v1/admin/agents/[agentId]/route')
    const res = await PUT(new NextRequest('http://localhost/api/v1/admin/agents/pip', {
      method: 'PUT',
      body: JSON.stringify({ name: 'New Pip' }),
    }), routeCtx('pip'))

    expect(res.status).toBe(403)
    expect(mockUpdateAgent).not.toHaveBeenCalled()
  })
})
