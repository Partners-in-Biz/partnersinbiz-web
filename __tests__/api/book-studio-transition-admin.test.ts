import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockRunTransaction = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
    runTransaction: (fn: (tx: unknown) => Promise<void>) => mockRunTransaction(fn),
  },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: unknown, ctx: unknown) => unknown) =>
    (req: NextRequest, ctx: unknown) => handler(req, { uid: 'admin-1', role: 'admin' }, ctx),
}))

jest.mock('@/lib/api/platformAdmin', () => ({ canAccessOrg: () => true }))
jest.mock('@/lib/organizations/portal-modules', () => ({ isPortalModuleEnabled: () => true }))

type DocRecord = Record<string, unknown>

function stageFirestore(options: { project: DocRecord | null; chapters?: DocRecord[]; pages?: DocRecord[] }) {
  const { project, chapters = [], pages = [] } = options
  const projectDoc = { ...project }
  const updateSpy = jest.fn((patch: Record<string, unknown>) => Object.assign(projectDoc, patch))
  const createSpy = jest.fn()
  const orgGet = jest.fn().mockResolvedValue({ exists: true, data: () => ({ settings: { portalModules: { bookStudio: true } } }) })

  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') return { doc: () => ({ get: orgGet }) }
    if (name === 'book_studio_projects') {
      return { doc: () => ({ get: async () => ({ exists: Boolean(project), data: () => projectDoc }) }) }
    }
    if (name === 'book_studio_decision_logs') return { doc: () => ({}) }
    if (name === 'book_studio_chapters') {
      return { where: () => ({ get: async () => ({ docs: chapters.map((data) => ({ data: () => data })) }) }) }
    }
    if (name === 'book_studio_pages') {
      return { where: () => ({ get: async () => ({ docs: pages.map((data) => ({ data: () => data })) }) }) }
    }
    throw new Error(`unexpected collection ${name}`)
  })

  mockRunTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
    const projectRef = { get: async () => ({ exists: Boolean(project), data: () => projectDoc }) }
    const tx = { get: (ref: { get: () => Promise<unknown> }) => ref.get(), update: updateSpy, create: createSpy }
    return fn(tx)
  })

  return { updateSpy, createSpy }
}

function makeRequest(body: Record<string, unknown>, orgId = 'org-1') {
  return new NextRequest(`http://localhost/api/v1/book-studio/projects/proj-1/transition?orgId=${orgId}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/book-studio/projects/[id]/transition', () => {
  beforeEach(() => { jest.clearAllMocks() })

  it('200s and updates lifecycleState on an allowed transition', async () => {
    stageFirestore({
      project: { orgId: 'org-1', lifecycleState: 'draft', deleted: false },
      chapters: [{ status: 'edited' }],
      pages: [{ status: 'approved' }],
    })
    const { POST } = await import('@/app/api/v1/book-studio/projects/[id]/transition/route')
    const res = await POST(makeRequest({ toState: 'content_complete' }), { params: Promise.resolve({ id: 'proj-1' }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data).toEqual({ from: 'draft', to: 'content_complete' })
  })

  it('422s with blockers when the guard fails', async () => {
    stageFirestore({
      project: { orgId: 'org-1', lifecycleState: 'draft', deleted: false },
      chapters: [{ status: 'draft' }],
      pages: [],
    })
    const { POST } = await import('@/app/api/v1/book-studio/projects/[id]/transition/route')
    const res = await POST(makeRequest({ toState: 'content_complete' }), { params: Promise.resolve({ id: 'proj-1' }) })
    const body = await res.json()
    expect(res.status).toBe(422)
    expect(body.success).toBe(false)
    expect(Array.isArray(body.blockers)).toBe(true)
    expect(body.blockers.length).toBeGreaterThan(0)
  })

  it('400s on an invalid toState', async () => {
    stageFirestore({ project: { orgId: 'org-1', lifecycleState: 'draft', deleted: false } })
    const { POST } = await import('@/app/api/v1/book-studio/projects/[id]/transition/route')
    const res = await POST(makeRequest({ toState: 'not-a-state' }), { params: Promise.resolve({ id: 'proj-1' }) })
    expect(res.status).toBe(400)
  })

  it('400s on a disallowed skip-ahead transition', async () => {
    stageFirestore({ project: { orgId: 'org-1', lifecycleState: 'draft', deleted: false } })
    const { POST } = await import('@/app/api/v1/book-studio/projects/[id]/transition/route')
    const res = await POST(makeRequest({ toState: 'live' }), { params: Promise.resolve({ id: 'proj-1' }) })
    expect(res.status).toBe(400)
  })
})
