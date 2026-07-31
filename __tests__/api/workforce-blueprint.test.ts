import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin' | 'client' | 'ai'; orgId: string }
type MockHandler = (req: NextRequest, user: MockUser, context?: unknown) => Promise<Response>

let mockUser: MockUser = { uid: 'member-1', role: 'client', orgId: 'org-1' }
const mockMemberGet = jest.fn()

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => (
    req: NextRequest,
    context?: unknown,
  ) => handler(req, mockUser, context),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name !== 'orgMembers') throw new Error(`Unexpected collection: ${name}`)
      return { doc: () => ({ get: mockMemberGet }) }
    },
  },
}))

describe('member workforce blueprint API', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    mockUser = { uid: 'member-1', role: 'client', orgId: 'org-1' }
    mockMemberGet.mockResolvedValue({
      exists: true,
      data: () => ({ department: 'Marketing', jobTitle: 'Campaign Manager' }),
    })
  })

  it('returns a policy-backed recommendation from caller member metadata', async () => {
    const { GET } = await import('@/app/api/v1/orgs/[orgId]/workforce-blueprint/route')
    const response = await GET(
      new NextRequest('http://localhost/api/v1/orgs/org-1/workforce-blueprint'),
      { params: Promise.resolve({ orgId: 'org-1' }) },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      orgId: 'org-1',
      member: { department: 'Marketing', jobTitle: 'Campaign Manager' },
      matchSource: 'department',
      blueprint: {
        id: 'marketing',
        recommendedAgentIds: ['maya', 'ads', 'seo', 'data'],
      },
      policyEvidence: {
        policyReady: true,
        policyVersion: expect.any(String),
      },
      recommendationStatus: 'ready_for_owner_review',
      requiresOwnerApproval: true,
      note: 'Recommendations never grant agent, runtime, module, or data access.',
    })
    expect(body.data.policyEvidence.agents).toHaveLength(4)
    expect(body.data.policyEvidence.skillCoverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ skillId: 'ads-manager', coveredByAgentIds: expect.arrayContaining(['ads']) }),
      expect.objectContaining({ skillId: 'seo-sprint-manager', coveredByAgentIds: expect.arrayContaining(['seo']) }),
    ]))
  })

  it('returns finance and people recommendations with dedicated dedicated specialist agents', async () => {
    mockMemberGet.mockResolvedValue({
      exists: true,
      data: () => ({ department: 'Human Resources', jobTitle: 'People Manager' }),
    })
    const { GET } = await import('@/app/api/v1/orgs/[orgId]/workforce-blueprint/route')
    const response = await GET(
      new NextRequest('http://localhost/api/v1/orgs/org-1/workforce-blueprint'),
      { params: Promise.resolve({ orgId: 'org-1' }) },
    )
    const body = await response.json()

    expect(body.data.blueprint).toMatchObject({
      id: 'people',
      specialistGaps: [],
      recommendedAgentIds: expect.arrayContaining(['people']),
    })
    expect(body.data.policyEvidence.agents.map((agent: { policyDefined: boolean, agentId: string }) => agent.agentId)).toContain('people')
  })

  it('returns Finance role coverage without specialist placeholder', async () => {
    mockMemberGet.mockResolvedValue({
      exists: true,
      data: () => ({ department: 'Finance', jobTitle: 'Finance Controller' }),
    })
    const { GET } = await import('@/app/api/v1/orgs/[orgId]/workforce-blueprint/route')
    const response = await GET(
      new NextRequest('http://localhost/api/v1/orgs/org-1/workforce-blueprint'),
      { params: Promise.resolve({ orgId: 'org-1' }) },
    )
    const body = await response.json()

    expect(body.data.blueprint).toMatchObject({
      id: 'finance',
      specialistGaps: [],
      recommendedAgentIds: expect.arrayContaining(['finance']),
    })
  })

  it('rejects selecting another organisation', async () => {
    const { GET } = await import('@/app/api/v1/orgs/[orgId]/workforce-blueprint/route')
    const response = await GET(
      new NextRequest('http://localhost/api/v1/orgs/org-other/workforce-blueprint'),
      { params: Promise.resolve({ orgId: 'org-other' }) },
    )

    expect(response.status).toBe(403)
    expect(mockMemberGet).not.toHaveBeenCalled()
  })
})
