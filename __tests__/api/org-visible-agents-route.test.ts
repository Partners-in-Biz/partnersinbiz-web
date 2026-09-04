import { NextRequest } from 'next/server'

type MockUser = {
  uid: string
  role: 'admin' | 'client' | 'ai'
  orgId?: string
}
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockCollection = jest.fn()
const mockOrgChatConfigGet = jest.fn()
const mockLoadOrgMemberAccessPolicy = jest.fn()

let mockUser: MockUser = { uid: 'client-1', role: 'client', orgId: 'org-1' }
let mockAgentRuntimeAccess: Record<string, unknown> = {}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('@/lib/conversations/conversations', () => {
  const actual = jest.requireActual('@/lib/conversations/conversations') as typeof import('@/lib/conversations/conversations')
  return {
    resolveVisibleAgents: actual.resolveVisibleAgents,
    orgChatConfigDoc: jest.fn(() => ({ get: mockOrgChatConfigGet })),
  }
})

jest.mock('@/lib/orgMembers/org-access-policy', () => ({
  loadOrgMemberAccessPolicy: (...args: unknown[]) => mockLoadOrgMemberAccessPolicy(...args),
}))

jest.mock('@/lib/linked-computers/hosted-agents', () => ({
  hostedAgentIdsForDevice: jest.fn(async (input: { availableAgentIds?: unknown[] | null; deviceKind?: string }) => {
    const ids = (input.availableAgentIds ?? []).filter((id): id is string => typeof id === 'string')
    if (input.deviceKind === 'vps' && ids.length === 0) return ['pip', 'sales']
    return ids
  }),
}))

async function readJson(res: Response) {
  return JSON.parse(await res.text())
}

beforeEach(() => {
  jest.clearAllMocks()
  mockUser = { uid: 'client-1', role: 'client', orgId: 'org-1' }
  mockAgentRuntimeAccess = {}
  mockOrgChatConfigGet.mockResolvedValue({
    exists: true,
    data: () => ({ visibleAgents: { client: ['pip', 'sales', 'theo', 'blake'] } }),
  })
  mockLoadOrgMemberAccessPolicy.mockResolvedValue({
    preset: 'custom',
    modules: {
      crm: true,
      projects: true,
      documents: true,
      marketing: true,
      messages: true,
      email: false,
      reports: false,
      research: false,
      properties: false,
      billing: false,
      mobileApps: false,
      youtubeStudio: false,
      bookStudio: false,
    },
    recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
    agentRuntimeAccess: mockAgentRuntimeAccess,
    allowPersonalLlmOnOrgVps: false,
  })

  const agentRows = [
    {
      data: () => ({
        agentId: 'pip',
        enabled: true,
        name: 'Pip',
      }),
    },
    {
      data: () => ({
        agentId: 'sales',
        enabled: true,
        name: 'Sales',
        provisioningMode: 'cloud',
      }),
    },
    {
      data: () => ({
        agentId: 'blake',
        enabled: true,
        name: 'Blake',
      }),
    },
  ]
  const linkedRuntime = {
    deviceId: 'device-1',
    ownerUserId: 'owner-1',
    ownerType: 'user',
    ownerOrgId: 'org-1',
    availableAgentIds: ['pip'],
    credentialReadyAgentIds: ['pip'],
    status: 'active',
  }
  const linkedSales = {
    data: () => ({
      agentId: 'theo',
      enabled: true,
      name: 'Theo',
      provisioningMode: 'linked_device',
      provisioningStatus: 'ready',
      scopeOrgId: 'org-1',
      accessScope: 'organization',
      ownerUserId: 'owner-1',
    }),
  }

  mockCollection.mockImplementation((name: string) => {
    if (name === 'agent_team') {
      return {
        get: async () => ({ docs: [...agentRows, linkedSales] }),
      }
    }
    if (name === 'orgMembers') {
      return {
        doc: (_id: string) => ({
          get: async () => ({ exists: false, data: () => ({}) }),
        }),
      }
    }
    if (name === 'linked_devices') {
      return {
        doc: (runtimeTarget: string) => ({
          get: async () => ({
            exists: runtimeTarget === 'device-1',
            data: () => runtimeTarget === 'device-1' ? linkedRuntime : null,
          }),
        }),
      }
    }
    return { doc: () => ({ get: async () => ({ exists: false, data: () => undefined }) }) }
  })
})

describe('visible agents API', () => {
  it('returns role-visible non-linked specialists without requiring a runtime grant', async () => {
    const { GET } = await import('@/app/api/v1/orgs/[orgId]/visible-agents/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/orgs/org-1/visible-agents'), {
      params: Promise.resolve({ orgId: 'org-1' }),
    })

    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentId: 'sales', enabled: true }),
      expect.objectContaining({ agentId: 'pip', enabled: true }),
    ]))
  })

  it('does not return linked specialists without a matching agent runtime grant', async () => {
    const { GET } = await import('@/app/api/v1/orgs/[orgId]/visible-agents/route')
    const res = await GET(
      new NextRequest('http://localhost/api/v1/orgs/org-1/visible-agents?runtimeTarget=linked-device:device-1'),
      { params: Promise.resolve({ orgId: 'org-1' }) },
    )

    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.data).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ agentId: 'theo' }),
    ]))
  })

  it('drops agents that are not hosted on the selected VPS', async () => {
    const { GET } = await import('@/app/api/v1/orgs/[orgId]/visible-agents/route')
    const res = await GET(
      new NextRequest('http://localhost/api/v1/orgs/org-1/visible-agents?runtimeTarget=vps'),
      { params: Promise.resolve({ orgId: 'org-1' }) },
    )
    expect(res.status).toBe(200)
    const body = await readJson(res)
    const ids = (body.data as Array<{ agentId: string }>).map((row) => row.agentId)
    expect(ids).toEqual(expect.arrayContaining(['pip', 'sales']))
    expect(ids).not.toContain('theo')
    expect(ids).not.toContain('blake')
  })
})
