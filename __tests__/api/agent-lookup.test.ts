import { NextRequest } from 'next/server'

const mockResolveAgentEntities = jest.fn()
const mockRetrieveAgentMemory = jest.fn()

jest.mock('@/lib/api/auth', () => ({
  withAuth: (
    _role: string,
    handler: (req: unknown, user: unknown, context?: unknown) => unknown,
  ) => (req: unknown, context?: unknown) => handler(req, globalThis.__agentLookupUser, context),
}))

jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: jest.fn((_user, orgId) => orgId !== 'blocked-org'),
}))

jest.mock('@/lib/agent-memory/entity-resolution', () => ({
  resolveAgentEntities: (input: unknown) => mockResolveAgentEntities(input),
}))

jest.mock('@/lib/agent-memory/retrieval', () => ({
  retrieveAgentMemory: (input: unknown) => mockRetrieveAgentMemory(input),
}))

declare global {
  var __agentLookupUser: unknown
}

beforeEach(() => {
  jest.clearAllMocks()
  globalThis.__agentLookupUser = { uid: 'agent:pip', role: 'ai', agentId: 'pip', authKind: 'agent_api_key', orgId: 'org-john' }
  mockResolveAgentEntities.mockResolvedValue({
    intent: 'entity_lookup',
    entityCandidates: [],
    selectedEntity: null,
    nextActions: [],
  })
  mockRetrieveAgentMemory.mockResolvedValue({ memory: [], citations: [] })
})

describe('POST /api/v1/agent/lookup', () => {
  it('requires an orgId for agent requests', async () => {
    globalThis.__agentLookupUser = { uid: 'agent:pip', role: 'ai', agentId: 'pip', authKind: 'agent_api_key' }
    const { POST } = await import('@/app/api/v1/agent/lookup/route')
    const req = new NextRequest('http://localhost/api/v1/agent/lookup', {
      method: 'POST',
      body: JSON.stringify({ query: 'get me the client called John' }),
    })

    const res = await POST(req)

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ success: false, error: 'orgId is required for agent lookup' })
  })

  it('returns structured entity candidates, selected entity, memory and citations', async () => {
    mockResolveAgentEntities.mockResolvedValue({
      intent: 'entity_lookup',
      entityCandidates: [{ type: 'organization', id: 'org-john', label: 'John Plumbing', score: 100 }],
      selectedEntity: { type: 'organization', id: 'org-john', label: 'John Plumbing', score: 100 },
      nextActions: [],
    })
    mockRetrieveAgentMemory.mockResolvedValue({
      memory: [{ id: 'chunk-1', title: 'Research', text: 'Memory', sourceType: 'research_item' }],
      citations: [{ sourceType: 'research_item', sourceId: 'research-1', title: 'Research' }],
    })

    const { POST } = await import('@/app/api/v1/agent/lookup/route')
    const req = new NextRequest('http://localhost/api/v1/agent/lookup', {
      method: 'POST',
      headers: new Headers({ 'x-org-id': 'org-john' }),
      body: JSON.stringify({ query: 'get me the client called John Plumbing', limit: 5 }),
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toMatchObject({
      intent: 'entity_lookup',
      selectedEntity: { id: 'org-john' },
      memory: [{ id: 'chunk-1' }],
      citations: [{ sourceId: 'research-1' }],
    })
    expect(mockRetrieveAgentMemory).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-john',
      selectedEntity: { type: 'organization', id: 'org-john', label: 'John Plumbing', score: 100 },
      limit: 5,
    }))
    expect(mockResolveAgentEntities).toHaveBeenCalledWith(expect.objectContaining({
      allowedOrganizationIds: ['org-john'],
    }))
  })

  it('blocks admin lookup against inaccessible orgs', async () => {
    globalThis.__agentLookupUser = { uid: 'admin-1', role: 'admin', authKind: 'session', allowedOrgIds: ['allowed-org'] }

    const { POST } = await import('@/app/api/v1/agent/lookup/route')
    const req = new NextRequest('http://localhost/api/v1/agent/lookup', {
      method: 'POST',
      body: JSON.stringify({ query: 'John', orgId: 'blocked-org' }),
    })

    const res = await POST(req)

    expect(res.status).toBe(403)
  })

  it('blocks agent lookup against another tenant without delegated memory permission', async () => {
    globalThis.__agentLookupUser = {
      uid: 'agent:pip',
      role: 'ai',
      agentId: 'pip',
      authKind: 'agent_api_key',
      orgId: 'allowed-org',
      permissions: [],
    }

    const { POST } = await import('@/app/api/v1/agent/lookup/route')
    const req = new NextRequest('http://localhost/api/v1/agent/lookup', {
      method: 'POST',
      body: JSON.stringify({ query: 'John', orgId: 'blocked-org' }),
    })

    const res = await POST(req)

    expect(res.status).toBe(403)
    expect(mockResolveAgentEntities).not.toHaveBeenCalled()
    expect(mockRetrieveAgentMemory).not.toHaveBeenCalled()
  })

  it('blocks legacy agent keys from choosing arbitrary orgs without delegated permission', async () => {
    globalThis.__agentLookupUser = {
      uid: 'ai-agent',
      role: 'ai',
      authKind: 'legacy_ai_key',
    }

    const { POST } = await import('@/app/api/v1/agent/lookup/route')
    const req = new NextRequest('http://localhost/api/v1/agent/lookup', {
      method: 'POST',
      headers: new Headers({ 'x-org-id': 'org-john' }),
      body: JSON.stringify({ query: 'John' }),
    })

    const res = await POST(req)

    expect(res.status).toBe(403)
    expect(mockResolveAgentEntities).not.toHaveBeenCalled()
    expect(mockRetrieveAgentMemory).not.toHaveBeenCalled()
  })

  it('blocks retrieval if resolution selects an organization outside the caller scope', async () => {
    globalThis.__agentLookupUser = {
      uid: 'agent:pip',
      role: 'ai',
      agentId: 'pip',
      authKind: 'agent_api_key',
      orgId: 'allowed-org',
      permissions: [],
    }
    mockResolveAgentEntities.mockResolvedValue({
      intent: 'entity_lookup',
      entityCandidates: [{ type: 'organization', id: 'blocked-org', label: 'Blocked Client', score: 100 }],
      selectedEntity: { type: 'organization', id: 'blocked-org', label: 'Blocked Client', score: 100 },
      nextActions: [],
    })

    const { POST } = await import('@/app/api/v1/agent/lookup/route')
    const req = new NextRequest('http://localhost/api/v1/agent/lookup', {
      method: 'POST',
      body: JSON.stringify({ query: 'Blocked Client', orgId: 'allowed-org' }),
    })

    const res = await POST(req)

    expect(res.status).toBe(403)
    expect(mockResolveAgentEntities).toHaveBeenCalled()
    expect(mockRetrieveAgentMemory).not.toHaveBeenCalled()
  })
})
