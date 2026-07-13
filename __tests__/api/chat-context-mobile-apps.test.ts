import { NextRequest } from 'next/server'

let mockAuthUser: Record<string, unknown>
const mockCollection = jest.fn()
const mockIsPortalModuleEnabled = jest.fn()
const mockAssertModuleVisibility = jest.fn()
const mockWithAuth = jest.fn((_role: string, handler: any) => async (req: NextRequest, ctx?: unknown) => handler(req, mockAuthUser, ctx))

jest.mock('@/lib/api/auth', () => ({ withAuth: (role: string, handler: unknown) => mockWithAuth(role, handler) }))
jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: (...args: unknown[]) => mockCollection(...args) } }))
jest.mock('@/lib/organizations/portal-modules', () => ({ isPortalModuleEnabled: (...args: unknown[]) => mockIsPortalModuleEnabled(...args) }))
jest.mock('@/lib/organizations/module-policy-access', () => ({
  assertUserCanPerformOrganizationModuleAction: (...args: unknown[]) => mockAssertModuleVisibility(...args),
}))
jest.mock('@/lib/creative-canvas/store', () => ({ listCreativeCanvases: jest.fn(), getCreativeCanvas: jest.fn() }))
jest.mock('@/lib/creative-canvas/runs', () => ({ listCreativeCanvasRuns: jest.fn() }))
jest.mock('@/lib/creative-canvas/collaboration', () => ({ listCreativeCanvasVersions: jest.fn() }))
jest.mock('@/lib/creative-canvas/credits', () => ({ getCanvasCredits: jest.fn() }))

const record = { orgId: 'org-1', name: 'Growth Pocket', platform: 'android', status: 'live', visibility: { showInClientPortal: true }, access: { accessStatus: 'active' } }

beforeEach(() => {
  jest.clearAllMocks()
  mockAuthUser = { uid: 'client-1', role: 'client', orgId: 'org-1', orgIds: ['org-1', 'org-2'], activeOrgId: 'org-1', memberAccessPolicy: { preset: 'full', modules: { mobileApps: true }, recordScopes: {} } }
  mockIsPortalModuleEnabled.mockReturnValue(true)
  mockAssertModuleVisibility.mockResolvedValue({ ok: true })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') return { doc: (id: string) => ({ get: async () => ({ exists: true, id, data: () => ({ slug: 'elemental', settings: {} }) }) }) }
    if (name === 'mobile_apps') return { doc: (id: string) => ({ get: async () => ({ exists: id === 'app-1', id, data: () => record }) }) }
    throw new Error(`unexpected collection ${name}`)
  })
})

async function get(id: string) {
  const { GET } = await import('@/app/api/v1/chat-context/[kind]/[id]/route')
  return GET(new NextRequest(`http://localhost/api/v1/chat-context/studio_artifact/${id}`), { params: Promise.resolve({ kind: 'studio_artifact', id }) })
}

describe('Mobile Apps chat context API', () => {
  it('resolves a canonical multi-organisation identity', async () => {
    const response = await get('mobile_apps:org:b3JnLTE:app:YXBwLTE')
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data.context).toEqual(expect.objectContaining({ id: 'mobile_apps:org:b3JnLTE:app:YXBwLTE', orgId: 'org-1' }))
  })

  it('rejects a mismatched or non-canonical organisation without returning the app', async () => {
    const response = await get('mobile_apps:app:org-2:app-1')
    expect(response.status).toBe(404)
  })

  it('checks a disabled portal module before app existence and returns generic unavailable', async () => {
    mockIsPortalModuleEnabled.mockReturnValue(false)
    const response = await get('mobile_apps:org:b3JnLTE:app:YXBwLTE')
    const body = await response.json()
    expect(response.status).toBe(404)
    expect(body.error).toBe('Context unavailable')
    expect(mockCollection.mock.calls.filter(([name]) => name === 'mobile_apps')).toHaveLength(0)
  })

  it('checks member Mobile Apps access before reading the organisation or app', async () => {
    mockAuthUser.memberAccessPolicy = { preset: 'custom', modules: { mobileApps: false }, recordScopes: {} }
    const response = await get('mobile_apps:org:b3JnLTE:app:YXBwLTE')
    expect(response.status).toBe(404)
    expect((await response.json()).error).toBe('Context unavailable')
    expect(mockCollection).not.toHaveBeenCalled()
  })

  it('checks organisation module role visibility before reading the app record', async () => {
    mockAssertModuleVisibility.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    const response = await get('mobile_apps:org:b3JnLTE:app:YXBwLTE')
    expect(response.status).toBe(404)
    expect((await response.json()).error).toBe('Context unavailable')
    expect(mockCollection.mock.calls.filter(([name]) => name === 'mobile_apps')).toHaveLength(0)
  })

  it('hides records excluded from the client portal', async () => {
    mockCollection.mockImplementation((name: string) => {
      if (name === 'organizations') return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ settings: {} }) }) }) }
      if (name === 'mobile_apps') return { doc: (id: string) => ({ get: async () => ({ exists: true, id, data: () => ({ ...record, visibility: { showInClientPortal: false } }) }) }) }
      throw new Error(`unexpected collection ${name}`)
    })
    const response = await get('mobile_apps:org:b3JnLTE:app:YXBwLTE')
    expect(response.status).toBe(404)
    expect((await response.json()).error).toBe('Context unavailable')
    expect(mockCollection.mock.calls.filter(([name]) => name === 'mobile_apps')).toHaveLength(1)
  })
})
