import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockOrgGet = jest.fn()

type MockPortalRoleHandler = (
  req: NextRequest,
  uid: string,
  orgId: string,
  role: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...args: any[]
) => Promise<Response> | Response

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/auth/portal-middleware', () => ({
  withPortalAuthAndRole: (_minRole: string, handler: MockPortalRoleHandler) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req: NextRequest, ...args: any[]) =>
      handler(req, 'uid-1', req.nextUrl.searchParams.get('orgId') || 'org-1', 'member', ...args),
}))

type DocRecord = { id: string; data: Record<string, unknown> }

/**
 * Stages a fake Firestore for the org settings + a set of named collections.
 * Each collection in `collections` supports:
 *   - .where('orgId', '==', orgId).get() -> { docs }
 *   - .doc(id).get() -> snapshot
 *   - .doc(id).update(patch) -> records the patch on updateSpy
 *   - .add(data) -> records the created data on addSpy, returns { id: 'new-id' }
 */
function stageFirestore(
  settings: Record<string, unknown>,
  collections: Record<string, DocRecord[]> = {},
) {
  const updateSpy = jest.fn().mockResolvedValue(undefined)
  const addSpy = jest.fn().mockResolvedValue({ id: 'new-id' })

  mockOrgGet.mockResolvedValue({ exists: true, data: () => ({ settings }) })

  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') {
      return { doc: () => ({ get: mockOrgGet }) }
    }

    const docs = collections[name] ?? []

    return {
      where: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({
          docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
        }),
      }),
      doc: (id: string) => {
        const found = docs.find((d) => d.id === id)
        return {
          get: jest.fn().mockResolvedValue({
            exists: Boolean(found),
            data: () => found?.data ?? {},
          }),
          update: (patch: Record<string, unknown>) => {
            updateSpy(name, id, patch)
            return Promise.resolve()
          },
        }
      },
      add: (data: Record<string, unknown>) => {
        addSpy(name, data)
        return Promise.resolve({ id: 'new-id' })
      },
    }
  })

  return { updateSpy, addSpy }
}

const ENABLED_SETTINGS = { portalModules: { bookStudio: true } }

describe('portal Book Studio resource routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('lists projects with visibility', async () => {
    stageFirestore(ENABLED_SETTINGS, {
      book_studio_projects: [
        { id: 'proj-1', data: { orgId: 'org-1', title: 'My Book', status: 'draft' } },
      ],
    })

    const { GET } = await import('@/app/api/v1/portal/book-studio/[resource]/route')
    const res = await GET(
      new NextRequest('http://localhost/api/v1/portal/book-studio/projects'),
      { params: Promise.resolve({ resource: 'projects' }) },
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.records).toHaveLength(1)
    expect(body.data.records[0]).toMatchObject({ id: 'proj-1', title: 'My Book' })
  })

  it('creates a project when create allowed', async () => {
    stageFirestore({
      portalModules: { bookStudio: true },
      modulePolicies: {
        bookStudio: {
          actions: {
            create: { owner: true, admin: true, member: true },
          },
        },
      },
    }, {
      book_studio_projects: [],
    })

    const { POST } = await import('@/app/api/v1/portal/book-studio/[resource]/route')
    const req = new NextRequest('http://localhost/api/v1/portal/book-studio/projects', {
      method: 'POST',
      body: JSON.stringify({ title: 'New Book' }),
    })
    const res = await POST(req, { params: Promise.resolve({ resource: 'projects' }) })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data).toMatchObject({ resource: 'projects' })
  })

  it('403s create when member create toggle is off', async () => {
    stageFirestore({
      portalModules: { bookStudio: true },
      modulePolicies: {
        bookStudio: {
          actions: {
            create: { owner: true, admin: true, member: false },
          },
        },
      },
    }, {
      book_studio_projects: [],
    })

    const { POST } = await import('@/app/api/v1/portal/book-studio/[resource]/route')
    const req = new NextRequest('http://localhost/api/v1/portal/book-studio/projects', {
      method: 'POST',
      body: JSON.stringify({ title: 'New Book' }),
    })
    const res = await POST(req, { params: Promise.resolve({ resource: 'projects' }) })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.success).toBe(false)
  })

  it('patches a chapter body with edit', async () => {
    stageFirestore({
      portalModules: { bookStudio: true },
      modulePolicies: {
        bookStudio: {
          actions: {
            edit: { owner: true, admin: true, member: true },
          },
        },
      },
    }, {
      book_studio_projects: [
        { id: 'proj-1', data: { orgId: 'org-1', title: 'My Book' } },
      ],
      book_studio_chapters: [
        { id: 'chap-1', data: { orgId: 'org-1', projectId: 'proj-1', title: 'Chapter 1', body: 'Old body' } },
      ],
    })

    const { PATCH } = await import('@/app/api/v1/portal/book-studio/[resource]/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/portal/book-studio/chapters/chap-1', {
      method: 'PATCH',
      body: JSON.stringify({ body: 'New body content' }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ resource: 'chapters', id: 'chap-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toMatchObject({ id: 'chap-1', resource: 'chapters', updated: true })
  })

  it('403s status:"approved" patch without approvalGates', async () => {
    stageFirestore({
      portalModules: { bookStudio: true },
      modulePolicies: {
        bookStudio: {
          actions: {
            edit: { owner: true, admin: true, member: true },
            approvalGates: { owner: true, admin: true, member: false },
          },
        },
      },
    }, {
      book_studio_projects: [
        { id: 'proj-1', data: { orgId: 'org-1', title: 'My Book', status: 'draft' } },
      ],
    })

    const { PATCH } = await import('@/app/api/v1/portal/book-studio/[resource]/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/portal/book-studio/projects/proj-1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'approved' }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ resource: 'projects', id: 'proj-1' }) })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.success).toBe(false)
  })

  it('403s deleted:true patch without archiveDelete', async () => {
    stageFirestore({
      portalModules: { bookStudio: true },
      modulePolicies: {
        bookStudio: {
          actions: {
            edit: { owner: true, admin: true, member: true },
            archiveDelete: { owner: true, admin: true, member: false },
          },
        },
      },
    }, {
      book_studio_projects: [
        { id: 'proj-1', data: { orgId: 'org-1', title: 'My Book', status: 'draft' } },
      ],
    })

    const { PATCH } = await import('@/app/api/v1/portal/book-studio/[resource]/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/portal/book-studio/projects/proj-1', {
      method: 'PATCH',
      body: JSON.stringify({ deleted: true }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ resource: 'projects', id: 'proj-1' }) })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.success).toBe(false)
  })

  it('404s GET decision-logs (operator-only)', async () => {
    stageFirestore(ENABLED_SETTINGS, {})

    const { GET } = await import('@/app/api/v1/portal/book-studio/[resource]/route')
    const res = await GET(
      new NextRequest('http://localhost/api/v1/portal/book-studio/decision-logs'),
      { params: Promise.resolve({ resource: 'decision-logs' }) },
    )
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.success).toBe(false)
  })

  it('403s + moduleDisabled:true when portalModules.bookStudio is false', async () => {
    stageFirestore({ portalModules: { bookStudio: false } }, {
      book_studio_projects: [],
    })

    const { GET } = await import('@/app/api/v1/portal/book-studio/[resource]/route')
    const res = await GET(
      new NextRequest('http://localhost/api/v1/portal/book-studio/projects'),
      { params: Promise.resolve({ resource: 'projects' }) },
    )
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toMatchObject({ success: false, moduleDisabled: true, module: 'bookStudio' })
  })
})
