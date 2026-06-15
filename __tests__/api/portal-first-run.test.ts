import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockOrgGet = jest.fn()
const mockMemberGet = jest.fn()
const mockProfileGet = jest.fn()
const mockProfileSet = jest.fn()

type MockPortalRoleHandler = (
  req: NextRequest,
  uid: string,
  orgId: string,
  role: string,
) => Promise<Response> | Response

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/auth/portal-middleware', () => ({
  withPortalAuthAndRole: (_minRole: string, handler: MockPortalRoleHandler) =>
    (req: NextRequest) => handler(req, 'uid-1', req.nextUrl.searchParams.get('orgId') || 'org-1', 'viewer'),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}))

function stageCollections({
  features = {},
  member = {},
  profile = null,
}: {
  features?: Record<string, boolean>
  member?: Record<string, unknown>
  profile?: Record<string, unknown> | null
} = {}) {
  mockOrgGet.mockResolvedValue({ exists: true, data: () => ({ settings: { features } }) })
  mockMemberGet.mockResolvedValue({ exists: true, data: () => member })
  mockProfileGet.mockResolvedValue({ exists: Boolean(profile), data: () => profile ?? undefined })
  mockProfileSet.mockResolvedValue(undefined)
  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') return { doc: () => ({ get: mockOrgGet }) }
    if (name === 'orgMembers') return { doc: () => ({ get: mockMemberGet }) }
    if (name === 'life_os_profiles') return { doc: () => ({ get: mockProfileGet, set: mockProfileSet }) }
    throw new Error(`Unexpected collection: ${name}`)
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.resetModules()
  process.env.LIFE_OS_ENABLED = 'true'
  stageCollections()
})

describe('portal first-run feature gate', () => {
  it('blocks reads and writes when the approved Life OS feature flag is disabled', async () => {
    const { GET, PATCH } = await import('@/app/api/v1/portal/first-run/route')

    const getRes = await GET(new NextRequest('http://localhost/api/v1/portal/first-run'))
    const patchRes = await PATCH(new NextRequest('http://localhost/api/v1/portal/first-run', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: { preferredName: 'Peet' } }),
    }))

    expect(getRes.status).toBe(403)
    expect(patchRes.status).toBe(403)
    expect(mockProfileSet).not.toHaveBeenCalled()
  })

  it('blocks reads when the environment kill switch is off even if org settings are enabled', async () => {
    process.env.LIFE_OS_ENABLED = 'false'
    stageCollections({ features: { lifeOs: true } })

    const { GET } = await import('@/app/api/v1/portal/first-run/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/first-run'))

    expect(res.status).toBe(403)
    expect(mockProfileGet).not.toHaveBeenCalled()
    expect(mockProfileSet).not.toHaveBeenCalled()
  })

  it('returns safe first-run defaults when the feature flag is enabled', async () => {
    stageCollections({ features: { lifeOs: true }, member: { firstName: 'Peet', lastName: 'Stander' } })

    const { GET } = await import('@/app/api/v1/portal/first-run/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/first-run'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toMatchObject({
      portalModule: 'lifeOs',
      firstRun: {
        completed: false,
        identity: { preferredName: 'Peet Stander' },
        values: [],
        lifeDomains: [],
        constraints: [],
        goals: [],
        baseline: { confidence: null, energy: null, timeCapacityHours: null },
        privacy: { consentToStore: false, shareWithTeam: false, allowAgentPersonalization: false },
      },
    })
  })

  it('sanitizes and persists identity, values, domains, constraints, goals, baseline, and consent settings', async () => {
    stageCollections({ features: { lifeOs: true }, member: { role: 'owner' } })

    const { PATCH } = await import('@/app/api/v1/portal/first-run/route')
    const res = await PATCH(new NextRequest('http://localhost/api/v1/portal/first-run', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identity: { preferredName: '  Peet  ', pronouns: ' he/him ', location: 'Ballito' },
        values: [' freedom ', '', 'family'],
        lifeDomains: [{ key: 'health', label: 'Health', priority: 5, notes: 'Morning training' }],
        constraints: ['school runs', ''],
        goals: [{ title: 'Launch private alpha', domain: 'business', timeframe: '90 days' }],
        baseline: { confidence: 8, energy: 6, timeCapacityHours: 12 },
        privacy: { consentToStore: true, shareWithTeam: false, allowAgentPersonalization: true },
      }),
    }))

    expect(res.status).toBe(200)
    expect(mockProfileSet).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        ownerUid: 'uid-1',
        firstRun: expect.objectContaining({
          completed: true,
          identity: { preferredName: 'Peet', pronouns: 'he/him', location: 'Ballito' },
          values: ['freedom', 'family'],
          lifeDomains: [{ key: 'health', label: 'Health', priority: 5, notes: 'Morning training' }],
          constraints: ['school runs'],
          goals: [{ title: 'Launch private alpha', domain: 'business', timeframe: '90 days' }],
          baseline: { confidence: 8, energy: 6, timeCapacityHours: 12 },
          privacy: { consentToStore: true, shareWithTeam: false, allowAgentPersonalization: true },
          completedAt: 'SERVER_TS',
          updatedAt: 'SERVER_TS',
        }),
        updatedAt: 'SERVER_TS',
      }),
      { merge: true },
    )
  })

  it('requires explicit storage consent before persisting first-run answers', async () => {
    stageCollections({ features: { lifeOs: true } })

    const { PATCH } = await import('@/app/api/v1/portal/first-run/route')
    const res = await PATCH(new NextRequest('http://localhost/api/v1/portal/first-run', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: { preferredName: 'Peet' }, privacy: { consentToStore: false } }),
    }))

    expect(res.status).toBe(400)
    expect(mockProfileSet).not.toHaveBeenCalled()
  })
})
