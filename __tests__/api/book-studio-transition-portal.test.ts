import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockRunTransaction = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
    runTransaction: (fn: (tx: unknown) => Promise<void>) => mockRunTransaction(fn),
  },
}))

type MockPortalRoleHandler = (
  req: NextRequest,
  uid: string,
  orgId: string,
  role: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...args: any[]
) => Promise<Response> | Response

let currentRole = 'member'

jest.mock('@/lib/auth/portal-middleware', () => ({
  withPortalAuthAndRole: (_minRole: string, handler: MockPortalRoleHandler) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req: NextRequest, ...args: any[]) =>
      handler(req, 'uid-1', req.nextUrl.searchParams.get('orgId') || 'org-1', currentRole, ...args),
}))

jest.mock('@/lib/book-studio/capabilities', () => {
  const actual = jest.requireActual('@/lib/book-studio/capabilities')
  return {
    ...actual,
    resolveBookStudioCapabilities: jest.fn(actual.resolveBookStudioCapabilities),
  }
})

type DocRecord = Record<string, unknown>

function stageFirestore(options: {
  settings?: Record<string, unknown>
  project: DocRecord | null
  chapters?: DocRecord[]
  pages?: DocRecord[]
}) {
  const {
    settings = { portalModules: { bookStudio: true } },
    project,
    chapters = [],
    pages = [],
  } = options
  const projectDoc = { ...project }
  const updateSpy = jest.fn((patch: Record<string, unknown>) => Object.assign(projectDoc, patch))
  const createSpy = jest.fn()
  const orgGet = jest.fn().mockResolvedValue({ exists: true, data: () => ({ settings }) })

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
  return new NextRequest(`http://localhost/api/v1/portal/book-studio/projects/proj-1/transition?orgId=${orgId}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/portal/book-studio/projects/[id]/transition', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    currentRole = 'member'
  })

  it('200s and updates lifecycleState on an allowed transition (member can reach content_complete)', async () => {
    stageFirestore({
      project: { orgId: 'org-1', lifecycleState: 'draft', deleted: false },
      chapters: [{ status: 'edited' }],
      pages: [{ status: 'approved' }],
    })
    const { POST } = await import('@/app/api/v1/portal/book-studio/projects/[id]/transition/route')
    const res = await POST(makeRequest({ toState: 'content_complete' }), { params: Promise.resolve({ id: 'proj-1' }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data).toEqual({ from: 'draft', to: 'content_complete' })
  })

  it('403s when a role without canApprovalGates tries to transition past content_complete', async () => {
    // 'viewer' normalizes to the 'member' policy row (module-policies.ts has
    // no dedicated viewer row); org explicitly denies member/viewer
    // approvalGates here to exercise the capability-gating acceptance
    // criterion for Task 4.
    currentRole = 'viewer'
    stageFirestore({
      settings: {
        portalModules: { bookStudio: true },
        modulePolicies: {
          bookStudio: {
            actions: {
              approvalGates: { owner: true, admin: true, member: false },
            },
          },
        },
      },
      project: { orgId: 'org-1', lifecycleState: 'content_complete', deleted: false },
    })
    const { POST } = await import('@/app/api/v1/portal/book-studio/projects/[id]/transition/route')
    const res = await POST(makeRequest({ toState: 'rights_cleared' }), { params: Promise.resolve({ id: 'proj-1' }) })
    expect(res.status).toBe(403)
  })

  it('allows a role with canApprovalGates (owner) to transition past content_complete', async () => {
    currentRole = 'owner'
    stageFirestore({
      project: { orgId: 'org-1', lifecycleState: 'content_complete', deleted: false },
      chapters: [],
      pages: [],
    })
    const { POST } = await import('@/app/api/v1/portal/book-studio/projects/[id]/transition/route')
    const res = await POST(
      makeRequest({ toState: 'rights_cleared' }),
      { params: Promise.resolve({ id: 'proj-1' }) },
    )
    // rights_cleared guard needs a cleared rightsLedger; project has none, so
    // this should fail the guard (422) rather than the capability check (403) —
    // proving the owner role passed the capability gate.
    expect(res.status).toBe(422)
  })

  it('400s on an invalid toState', async () => {
    stageFirestore({ project: { orgId: 'org-1', lifecycleState: 'draft', deleted: false } })
    const { POST } = await import('@/app/api/v1/portal/book-studio/projects/[id]/transition/route')
    const res = await POST(makeRequest({ toState: 'not-a-state' }), { params: Promise.resolve({ id: 'proj-1' }) })
    expect(res.status).toBe(400)
  })

  it('403s when the portal module is disabled for the org', async () => {
    stageFirestore({
      settings: { portalModules: { bookStudio: false } },
      project: { orgId: 'org-1', lifecycleState: 'draft', deleted: false },
    })
    const { POST } = await import('@/app/api/v1/portal/book-studio/projects/[id]/transition/route')
    const res = await POST(makeRequest({ toState: 'content_complete' }), { params: Promise.resolve({ id: 'proj-1' }) })
    expect(res.status).toBe(403)
  })
})
