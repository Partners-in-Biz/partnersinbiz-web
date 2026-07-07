import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockAssemble = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: mockCollection } }))
jest.mock('@/lib/api/platformAdmin', () => ({ canAccessOrg: () => true }))
jest.mock('@/lib/organizations/portal-modules', () => ({ isPortalModuleEnabled: () => true }))
jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: unknown, ctx: unknown) => unknown) =>
    (req: NextRequest, ctx: unknown) => handler(req, { uid: 'admin-1', role: 'admin' }, ctx),
}))
jest.mock('@/lib/book-studio/assembly/assemble', () => ({
  assembleBookProject: (...args: unknown[]) => mockAssemble(...args),
  AssemblyNotFoundError: class AssemblyNotFoundError extends Error {},
  AssemblyNotReadyError: class AssemblyNotReadyError extends Error {},
  AssemblyValidationError: class AssemblyValidationError extends Error {},
}))
jest.mock('@/lib/book-studio/assembly/interior-pdf', () => ({
  AssemblyMissingAssetError: class AssemblyMissingAssetError extends Error { orders: number[] = [] },
}))

function stageProject(project: Record<string, unknown> | null) {
  const orgGet = jest.fn().mockResolvedValue({ exists: true, data: () => ({ settings: { portalModules: { bookStudio: true } } }) })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') return { doc: () => ({ get: orgGet }) }
    if (name === 'book_studio_projects') {
      return { doc: () => ({ get: async () => ({ exists: Boolean(project), data: () => project }) }) }
    }
    throw new Error(`unexpected collection ${name}`)
  })
}

function makeRequest() {
  return new NextRequest('http://localhost/api/v1/book-studio/projects/proj-1/assemble?orgId=org-1', { method: 'POST', body: '{}' })
}

describe('POST /api/v1/book-studio/projects/[id]/assemble lifecycle gate', () => {
  beforeEach(() => { jest.clearAllMocks() })

  it('422s with blockers when rights ledger is needs_review (below rights_cleared)', async () => {
    stageProject({ orgId: 'org-1', lifecycleState: 'content_complete', deleted: false })
    const { POST } = await import('@/app/api/v1/book-studio/projects/[id]/assemble/route')
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'proj-1' }) })
    const body = await res.json()
    expect(res.status).toBe(422)
    expect(body.success).toBe(false)
    expect(Array.isArray(body.blockers)).toBe(true)
    expect(mockAssemble).not.toHaveBeenCalled()
  })

  it('proceeds to assembleBookProject when lifecycleState is rights_cleared or later', async () => {
    stageProject({ orgId: 'org-1', lifecycleState: 'rights_cleared', deleted: false })
    mockAssemble.mockResolvedValue({ status: 'draft' })
    const { POST } = await import('@/app/api/v1/book-studio/projects/[id]/assemble/route')
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'proj-1' }) })
    expect(res.status).toBe(200)
    expect(mockAssemble).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'proj-1', orgId: 'org-1' }))
  })

  it('422s a project with no lifecycleState at all (defaults to draft)', async () => {
    stageProject({ orgId: 'org-1', deleted: false })
    const { POST } = await import('@/app/api/v1/book-studio/projects/[id]/assemble/route')
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'proj-1' }) })
    expect(res.status).toBe(422)
    expect(mockAssemble).not.toHaveBeenCalled()
  })

  it('404s when the project does not exist', async () => {
    stageProject(null)
    const { POST } = await import('@/app/api/v1/book-studio/projects/[id]/assemble/route')
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'proj-1' }) })
    expect(res.status).toBe(404)
  })
})
