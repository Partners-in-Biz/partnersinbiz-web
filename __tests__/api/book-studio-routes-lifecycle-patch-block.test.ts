import { NextRequest } from 'next/server'

const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: mockCollection } }))
jest.mock('@/lib/api/platformAdmin', () => ({ canAccessOrg: () => true }))
jest.mock('@/lib/organizations/portal-modules', () => ({ isPortalModuleEnabled: () => true }))
jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: unknown, ctx: unknown) => unknown) =>
    (req: NextRequest, ctx: unknown) => handler(req, { uid: 'admin-1', role: 'admin' }, ctx),
}))
jest.mock('@/lib/auth/portal-middleware', () => ({
  withPortalAuthAndRole: (_minRole: string, handler: (req: NextRequest, uid: string, orgId: string, role: string, ctx: unknown) => unknown) =>
    (req: NextRequest, ctx: unknown) => handler(req, 'uid-1', 'org-1', 'owner', ctx),
}))

function stageProject() {
  const orgGet = jest.fn().mockResolvedValue({ exists: true, data: () => ({ settings: { portalModules: { bookStudio: true }, modulePolicies: { bookStudio: { actions: { edit: { owner: true } } } } } }) })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') return { doc: () => ({ get: orgGet }) }
    if (name === 'book_studio_projects') {
      return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ orgId: 'org-1', deleted: false }) }) }) }
    }
    throw new Error(`unexpected collection ${name}`)
  })
}

describe('admin PATCH /api/v1/book-studio/[resource]/[id] blocks direct lifecycleState writes', () => {
  beforeEach(() => { jest.clearAllMocks(); stageProject() })

  it('403s when lifecycleState is in the PATCH body', async () => {
    const { PATCH } = await import('@/lib/book-studio/routes').then((m) => m.createBookStudioRecordHandlers())
    const req = new NextRequest('http://localhost/api/v1/book-studio/projects/proj-1?orgId=org-1', {
      method: 'PATCH',
      body: JSON.stringify({ lifecycleState: 'live' }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ resource: 'projects', id: 'proj-1' }) })
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body.success).toBe(false)
  })
})

describe('portal PATCH /api/v1/portal/book-studio/[resource]/[id] blocks direct lifecycleState writes', () => {
  beforeEach(() => { jest.clearAllMocks(); stageProject() })

  it('403s when lifecycleState is in the PATCH body', async () => {
    const { PATCH } = await import('@/app/api/v1/portal/book-studio/[resource]/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/portal/book-studio/projects/proj-1', {
      method: 'PATCH',
      body: JSON.stringify({ lifecycleState: 'live' }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ resource: 'projects', id: 'proj-1' }) })
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body.success).toBe(false)
  })
})
