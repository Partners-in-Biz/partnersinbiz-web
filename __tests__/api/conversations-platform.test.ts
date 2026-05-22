import { NextRequest } from 'next/server'

type MockUser = {
  uid: string
  role: 'admin' | 'client' | 'ai'
  orgId?: string
  orgIds?: string[]
  allowedOrgIds?: string[]
}
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockCollection = jest.fn()
const mockCreateConversation = jest.fn()
const mockListConversations = jest.fn()
const mockOrgChatConfigGet = jest.fn()
const mockResolveVisibleAgents = jest.fn()

let mockUser: MockUser = { uid: 'admin-1', role: 'admin' }

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('@/lib/conversations/conversations', () => ({
  createConversation: mockCreateConversation,
  listConversations: mockListConversations,
  orgChatConfigDoc: jest.fn(() => ({ get: mockOrgChatConfigGet })),
  resolveVisibleAgents: mockResolveVisibleAgents,
}))

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockUser = { uid: 'admin-1', role: 'admin' }
  mockOrgChatConfigGet.mockResolvedValue({ exists: false, data: () => ({}) })
  mockResolveVisibleAgents.mockReturnValue(['pip', 'theo', 'maya', 'sage', 'nora', 'ads', 'qa-release', 'support', 'data', 'docs', 'seo'])
  mockCreateConversation.mockImplementation(async (input) => ({ id: 'conv-1', ...input }))
  mockListConversations.mockResolvedValue([{ id: 'conv-1', orgId: 'pib-platform-owner' }])

  const usersById: Record<string, Record<string, unknown>> = {
    'admin-1': { role: 'admin', email: 'peet@example.com', displayName: 'Peet' },
    'admin-2': { role: 'admin', email: 'ops@example.com', displayName: 'Ops' },
    'client-1': { role: 'client', email: 'client@example.com', displayName: 'Client' },
  }

  mockCollection.mockImplementation((name: string) => {
    if (name === 'users') {
      return {
        doc: (uid: string) => ({
          get: async () => ({ exists: !!usersById[uid], data: () => usersById[uid] ?? {} }),
        }),
        where: () => ({
          get: async () => ({
            docs: Object.entries(usersById)
              .filter(([, data]) => data.role === 'admin' && !data.orgId)
              .map(([id, data]) => ({ id, data: () => data })),
          }),
        }),
      }
    }
    if (name === 'agent_team') {
      return {
        doc: (agentId: string) => ({
          get: async () => ({
            exists: agentId === 'pip',
            data: () => ({ agentId, enabled: true, name: 'Pip' }),
          }),
        }),
      }
    }
    if (name === 'organizations') {
      return {
        doc: (orgId: string) => ({
          get: async () => ({
            exists: orgId === 'pib-platform-owner',
            data: () => ({
              members: [
                { userId: 'client-1', role: 'member' },
                { userId: 'admin-2', role: 'member' },
              ],
            }),
          }),
        }),
      }
    }
    throw new Error(`Unexpected collection: ${name}`)
  })
})

async function readJson(res: Response) {
  return JSON.parse(await res.text())
}

describe('platform-scoped unified conversations', () => {
  it('lets a super admin create a top-level platform conversation without a client org document', async () => {
    const { POST } = await import('@/app/api/v1/conversations/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'pib-platform-owner',
        participants: [{ kind: 'agent', agentId: 'pip' }, { kind: 'user', uid: 'admin-2' }],
        title: 'Internal planning',
      }),
    }))

    expect(res.status).toBe(201)
    expect(mockCreateConversation).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'pib-platform-owner',
      startedBy: 'admin-1',
      title: 'Internal planning',
    }))
    const body = await readJson(res)
    expect(body.data.conversation.id).toBe('conv-1')
  })

  it('lists top-level platform conversations for the current admin', async () => {
    const { GET } = await import('@/app/api/v1/conversations/route')

    const res = await GET(new NextRequest('http://localhost/api/v1/conversations?orgId=pib-platform-owner'))

    expect(res.status).toBe(200)
    expect(mockListConversations).toHaveBeenCalledWith('pib-platform-owner', 'admin-1', 30, expect.any(Object))
  })

  it('lets a client start a platform-workspace conversation with listed org members', async () => {
    mockUser = { uid: 'client-1', role: 'client', orgId: 'pib-platform-owner' }
    const { POST } = await import('@/app/api/v1/conversations/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'pib-platform-owner',
        participants: [{ kind: 'user', uid: 'admin-2' }],
      }),
    }))

    expect(res.status).toBe(201)
    expect(mockCreateConversation).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'pib-platform-owner',
      startedBy: 'client-1',
      participants: expect.arrayContaining([
        expect.objectContaining({ kind: 'user', uid: 'client-1' }),
        expect.objectContaining({ kind: 'user', uid: 'admin-2' }),
      ]),
    }))
  })

  it('returns platform admins as people for the top-level participant picker', async () => {
    const { GET } = await import('@/app/api/v1/orgs/[orgId]/contacts/route')

    const res = await GET(new NextRequest('http://localhost/api/v1/orgs/pib-platform-owner/contacts'), {
      params: Promise.resolve({ orgId: 'pib-platform-owner' }),
    })

    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.data).toEqual([
      expect.objectContaining({ uid: 'admin-2', role: 'admin', email: 'ops@example.com' }),
    ])
  })
})
