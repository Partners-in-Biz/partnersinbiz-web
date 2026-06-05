import { NextRequest } from 'next/server'

const mockUserDoc = jest.fn()
const mockOrgDoc = jest.fn()
const mockCollection = jest.fn()
const mockCanUsePortalOrg = jest.fn()
const mockCallAgentPath = jest.fn()
const mockResolveKnowledgeAgent = jest.fn((slug: string) => slug)

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/auth/portal-middleware', () => ({
  withPortalAuth:
    (handler: (req: NextRequest, uid: string) => Promise<Response>) =>
      (req: NextRequest) => handler(req, 'admin-1'),
}))

jest.mock('@/lib/portal/org-access', () => ({
  canUsePortalOrg: (...args: unknown[]) => mockCanUsePortalOrg(...args),
}))

jest.mock('@/lib/agents/team', () => ({
  callAgentPath: (...args: unknown[]) => mockCallAgentPath(...args),
}))

jest.mock('@/lib/knowledge/agents', () => ({
  resolveKnowledgeAgent: (...args: unknown[]) => mockResolveKnowledgeAgent(...args),
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockCanUsePortalOrg.mockResolvedValue(true)
  mockCallAgentPath.mockResolvedValue({
    response: { ok: true, status: 200 },
    data: { success: true, data: { items: [] } },
  })
  mockUserDoc.mockReturnValue({
    get: async () => ({
      exists: true,
      data: () => ({ role: 'admin', orgId: 'platform-org', activeOrgId: 'platform-org' }),
    }),
  })
  mockOrgDoc.mockImplementation((id: string) => ({
    get: async () => ({
      exists: true,
      data: () => ({
        slug: id === 'lumen-org' ? 'lumen-speeds' : 'partners-in-biz',
      }),
    }),
  }))
  mockCollection.mockImplementation((name: string) => {
    if (name === 'users') return { doc: mockUserDoc }
    if (name === 'organizations') return { doc: mockOrgDoc }
    throw new Error(`Unexpected collection: ${name}`)
  })
})

describe('portal knowledge scope', () => {
  it('resolves the requested CRM company organisation before proxying knowledge notes', async () => {
    const { GET } = await import('@/app/api/v1/portal/knowledge/route')

    const res = await GET(new NextRequest('http://localhost/api/v1/portal/knowledge?orgId=lumen-org&section=wiki'))

    expect(res.status).toBe(200)
    expect(mockCanUsePortalOrg).toHaveBeenCalledWith(
      'admin-1',
      expect.objectContaining({ role: 'admin' }),
      'lumen-org',
    )
    expect(mockResolveKnowledgeAgent).toHaveBeenCalledWith('lumen-speeds')
    expect(mockCallAgentPath).toHaveBeenCalledWith(
      'pip',
      expect.stringContaining('agent=lumen-speeds'),
    )
  })
})
