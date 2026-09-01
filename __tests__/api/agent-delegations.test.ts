import { NextRequest } from 'next/server'

const mockResolveUser = jest.fn()
const mockMintAgentDelegation = jest.fn()
const mockCanAccessOrg = jest.fn()

jest.mock('@/lib/api/auth', () => ({
  resolveUser: (...args: unknown[]) => mockResolveUser(...args),
}))

jest.mock('@/lib/api/delegations', () => ({
  mintAgentDelegation: (...args: unknown[]) => mockMintAgentDelegation(...args),
}))

jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: (...args: unknown[]) => mockCanAccessOrg(...args),
}))

describe('POST /api/v1/agent/delegations', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCanAccessOrg.mockReturnValue(true)
  })

  it('mints a delegation for an interactive human user', async () => {
    mockResolveUser.mockResolvedValue({
      uid: 'user-1',
      role: 'client',
      authKind: 'session',
      orgId: 'org-1',
      activeOrgId: 'org-1',
      orgIds: ['org-1'],
    })
    mockMintAgentDelegation.mockResolvedValue({
      id: 'dlg-1',
      token: 'pib_dlg_secret',
      scopes: ['documents:create'],
    })

    const { POST } = await import('@/app/api/v1/agent/delegations/route')
    const req = new NextRequest('http://localhost/api/v1/agent/delegations', {
      method: 'POST',
      body: JSON.stringify({ orgId: 'org-1', agentId: 'pip', purpose: 'messages:conv-1', ttlSeconds: 1800 }),
      headers: new Headers({ 'content-type': 'application/json' }),
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(mockMintAgentDelegation).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      agentId: 'pip',
      purpose: 'messages:conv-1',
      ttlSeconds: 1800,
    }))
    expect(body.data.id).toBe('dlg-1')
  })

  it('rejects ai/system callers', async () => {
    mockResolveUser.mockResolvedValue({
      uid: 'agent:pip',
      role: 'ai',
      authKind: 'agent_api_key',
      agentId: 'pip',
    })
    const { POST } = await import('@/app/api/v1/agent/delegations/route')
    const req = new NextRequest('http://localhost/api/v1/agent/delegations', {
      method: 'POST',
      body: JSON.stringify({ orgId: 'org-1', agentId: 'pip', purpose: 'messages:conv-1' }),
      headers: new Headers({ 'content-type': 'application/json' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('lets mintAgentDelegation decide org access so staff can mint without membership', async () => {
    mockCanAccessOrg.mockReturnValue(false)
    mockResolveUser.mockResolvedValue({
      uid: 'stean',
      role: 'client',
      authKind: 'session',
      orgId: 'pib-platform-owner',
      orgIds: ['pib-platform-owner'],
    })
    mockMintAgentDelegation.mockResolvedValue({
      id: 'dlg-staff',
      token: 'pib_dlg_secret',
      orgIds: ['wS5pgwa6c9WbPocf4w0w', 'pib-platform-owner'],
    })

    const { POST } = await import('@/app/api/v1/agent/delegations/route')
    const req = new NextRequest('http://localhost/api/v1/agent/delegations', {
      method: 'POST',
      body: JSON.stringify({ orgId: 'wS5pgwa6c9WbPocf4w0w', agentId: 'pip', purpose: 'skill:crm' }),
      headers: new Headers({ 'content-type': 'application/json' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(201)
    expect(mockMintAgentDelegation).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'wS5pgwa6c9WbPocf4w0w',
      conversationId: '',
    }))
  })
})
