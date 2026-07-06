import { NextRequest } from 'next/server'

jest.setTimeout(120000)

const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockGet = jest.fn()
const mockAdd = jest.fn()
const mockDoc = jest.fn()
const mockUpdate = jest.fn()
const mockOrgGet = jest.fn()
const mockCanAccessOrg = jest.fn()
const mockUploadBookFileToStorage = jest.fn()

let mockUser = { uid: 'agent-pip', role: 'ai', orgId: 'pib-platform-owner' } as { uid: string; role: string; orgId?: string }

type AuthHandler = (req: NextRequest, user: typeof mockUser, context?: unknown) => Promise<Response> | Response

// Tiny valid 1x1 PNG; sharp normalizes it to JPEG inside the assembly engines.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
  getAdminApp: () => ({}),
}))

jest.mock('firebase-admin/storage', () => ({
  getStorage: () => ({ bucket: () => ({ name: 'test-bucket', file: () => ({}) }) }),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}))

// Mirrors the real withAuth role gate: ai/admin satisfy any required role,
// client only satisfies 'client' — so admin-only routes 403 portal clients.
jest.mock('@/lib/api/auth', () => ({
  withAuth: (requiredRole: string, handler: AuthHandler) => (req: NextRequest, context?: unknown) => {
    const roleOk =
      mockUser.role === 'ai' ||
      mockUser.role === 'admin' ||
      (requiredRole === 'client' && mockUser.role === 'client')
    if (!roleOk) {
      return Promise.resolve(Response.json({ success: false, error: 'Forbidden' }, { status: 403 }))
    }
    return handler(req, mockUser, context)
  },
}))

jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: (...args: unknown[]) => mockCanAccessOrg(...args),
}))

jest.mock('@/lib/book-studio/storage', () => ({
  uploadBookFileToStorage: (...args: unknown[]) => mockUploadBookFileToStorage(...args),
}))

let uploadCounter = 0

type Doc = Record<string, unknown>

function stageFirestore({
  orgSettings = { portalModules: { bookStudio: true } },
  project,
  chapterDocs = [],
  pageDocs = [],
}: {
  orgSettings?: Record<string, unknown>
  project: Doc | null
  chapterDocs?: Array<{ id: string; data: () => Doc }>
  pageDocs?: Array<{ id: string; data: () => Doc }>
} = { project: null }) {
  uploadCounter = 0
  mockCanAccessOrg.mockReturnValue(true)
  mockOrgGet.mockResolvedValue({ exists: true, data: () => ({ settings: orgSettings }) })
  mockUpdate.mockResolvedValue(undefined)
  mockAdd.mockImplementation(async (payload: Doc) => ({ id: 'decision-log-1', ...payload }))

  mockUploadBookFileToStorage.mockImplementation(async (buffer: Buffer, mimeType: string, orgId: string, projectId: string, filename: string) => {
    uploadCounter += 1
    return {
      publicUrl: `https://firebasestorage.googleapis.com/v0/b/test-bucket/o/book-studio%2F${orgId}%2F${projectId}%2F${filename}?alt=media&token=tok-${uploadCounter}`,
      storagePath: `book-studio/${orgId}/${projectId}/hash${uploadCounter}-${filename}`,
    }
  })

  const projectDocRef = {
    get: jest.fn().mockResolvedValue({ exists: project !== null, data: () => project }),
    update: mockUpdate,
  }

  mockWhere.mockImplementation(() => ({
    where: mockWhere,
    get: mockGet,
  }))

  mockGet.mockImplementation(() => {
    // Distinguish chapters vs pages calls by tracking the last collection name.
    return Promise.resolve({ docs: lastCollectionCall === 'book_studio_chapters' ? chapterDocs : pageDocs })
  })

  let lastCollectionCall = ''

  mockDoc.mockImplementation((id: string) => {
    if (id === 'organizations-doc') return mockOrgGet
    return projectDocRef
  })

  mockCollection.mockImplementation((name: string) => {
    lastCollectionCall = name
    if (name === 'organizations') return { doc: () => ({ get: mockOrgGet }) }
    if (name === 'book_studio_projects') return { doc: () => projectDocRef }
    if (name === 'book_studio_chapters') {
      return {
        where: (..._args: unknown[]) => ({
          where: (..._args2: unknown[]) => ({
            get: async () => ({ docs: chapterDocs }),
          }),
        }),
      }
    }
    if (name === 'book_studio_pages') {
      return {
        where: (..._args: unknown[]) => ({
          where: (..._args2: unknown[]) => ({
            get: async () => ({ docs: pageDocs }),
          }),
        }),
      }
    }
    if (name === 'book_studio_decision_logs') return { add: mockAdd }
    return { where: mockWhere, add: mockAdd, doc: mockDoc }
  })

  return { projectDocRef }
}

function jsonPost(projectId: string, orgId = 'pib-platform-owner') {
  return new NextRequest(`http://localhost/api/v1/book-studio/projects/${projectId}/assemble`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': orgId },
    body: JSON.stringify({}),
  })
}

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) }
}

async function loadRoute() {
  return import('@/app/api/v1/book-studio/projects/[id]/assemble/route')
}

async function loadSetFetchImage() {
  const mod = await import('@/lib/book-studio/assembly/assemble')
  mod.setFetchImageForAssembly(async () => PNG_1X1)
}

const SUDOKU_PROJECT: Doc = {
  orgId: 'pib-platform-owner',
  title: 'Sudoku Vol 1',
  format: 'puzzle_sudoku',
  deleted: false,
}

const STORY_PROJECT: Doc = {
  orgId: 'pib-platform-owner',
  title: 'The Long Way Home',
  format: 'story',
  metadata: { authorName: 'Pip Press' },
  deleted: false,
}

const COLOURING_PROJECT: Doc = {
  orgId: 'pib-platform-owner',
  title: 'Colour Me Happy',
  format: 'colouring',
  deleted: false,
}

function sudokuPageDocs(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `page-${i + 1}`,
    data: () => ({
      orgId: 'pib-platform-owner',
      projectId: 'book-sudoku',
      order: i + 1,
      kind: 'puzzle',
      status: 'generated',
      puzzle: { kind: 'sudoku', seed: 1000 + i, difficulty: 'easy' },
      deleted: false,
    }),
  }))
}

function colouringPageDocs() {
  return [
    { id: 'p1', data: () => ({ orgId: 'pib-platform-owner', projectId: 'book-colouring', order: 1, kind: 'colouring', imageUrl: 'https://img/1.png', deleted: false }) },
    { id: 'p2', data: () => ({ orgId: 'pib-platform-owner', projectId: 'book-colouring', order: 2, kind: 'colouring', deleted: false }) },
    { id: 'p3', data: () => ({ orgId: 'pib-platform-owner', projectId: 'book-colouring', order: 3, kind: 'colouring', deleted: false }) },
    { id: 'p4', data: () => ({ orgId: 'pib-platform-owner', projectId: 'book-colouring', order: 4, kind: 'colouring', imageUrl: 'https://img/4.png', deleted: false }) },
  ]
}

function storyChapterDocs() {
  return [
    { id: 'c1', data: () => ({ orgId: 'pib-platform-owner', projectId: 'book-story', order: 1, title: 'Chapter One', body: 'It was a dark and stormy night in the harbour town.', deleted: false }) },
    { id: 'c2', data: () => ({ orgId: 'pib-platform-owner', projectId: 'book-story', order: 2, title: 'Chapter Two', body: 'The morning came slow and grey over the water.', deleted: false }) },
  ]
}

describe('POST /api/v1/book-studio/projects/[id]/assemble', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    jest.resetModules()
    mockUser = { uid: 'agent-pip', role: 'ai', orgId: 'pib-platform-owner' }
    await loadSetFetchImage()
  })

  it('assembles a sudoku project end-to-end with interior + cover files, real checksums, version 1 then 2', async () => {
    stageFirestore({ project: SUDOKU_PROJECT, pageDocs: sudokuPageDocs(6) })
    const { POST } = await loadRoute()

    const res = await POST(jsonPost('book-sudoku'), routeContext('book-sudoku'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    const manifest = body.data.manifest
    expect(manifest.status).toBe('generated')
    expect(manifest.version).toBe(1)
    expect(manifest.qaStatus).toBe('pending_review')
    expect(typeof manifest.generatedAt).toBe('string')

    const roles = manifest.files.map((f: { role: string }) => f.role)
    expect(roles).toEqual(expect.arrayContaining(['interior_pdf', 'cover_pdf']))
    expect(roles).not.toContain('epub')

    for (const file of manifest.files) {
      expect(file.checksum).toMatch(/^[a-f0-9]{64}$/)
      expect(typeof file.bytes).toBe('number')
      expect(file.bytes).toBeGreaterThan(0)
      expect(typeof file.href).toBe('string')
      expect(typeof file.storagePath).toBe('string')
    }
    const interiorFile = manifest.files.find((f: { role: string }) => f.role === 'interior_pdf')
    expect(interiorFile.pageCount).toBeGreaterThan(0)
    expect(manifest.checksum).toBe(interiorFile.checksum)

    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate.mock.calls[0][0].packageManifest.version).toBe(1)
    expect(mockAdd).toHaveBeenCalledTimes(1)
    expect(mockAdd.mock.calls[0][0]).toMatchObject({
      orgId: 'pib-platform-owner',
      projectId: 'book-sudoku',
      decision: 'package_assembled',
    })

    // --- second run: version increments to 2, based on the persisted manifest ---
    const secondStage = stageFirestore({
      project: { ...SUDOKU_PROJECT, packageManifest: { ...manifest } },
      pageDocs: sudokuPageDocs(6),
    })
    void secondStage
    const res2 = await POST(jsonPost('book-sudoku'), routeContext('book-sudoku'))
    const body2 = await res2.json()
    expect(res2.status).toBe(200)
    expect(body2.data.manifest.version).toBe(2)
  })

  it('assembles a story project (2 chapters) and includes an epub file', async () => {
    stageFirestore({ project: STORY_PROJECT, chapterDocs: storyChapterDocs() })
    const { POST } = await loadRoute()

    const res = await POST(jsonPost('book-story'), routeContext('book-story'))
    const body = await res.json()

    expect(res.status).toBe(200)
    const manifest = body.data.manifest
    const roles = manifest.files.map((f: { role: string }) => f.role)
    expect(roles).toEqual(expect.arrayContaining(['interior_pdf', 'cover_pdf', 'epub']))
    const epubFile = manifest.files.find((f: { role: string }) => f.role === 'epub')
    expect(epubFile.checksum).toMatch(/^[a-f0-9]{64}$/)
    expect(epubFile.pageCount).toBeUndefined()
  })

  it('returns 422 listing missing page orders for a colouring project with 2 of 4 pages missing imageUrl, and writes NO manifest', async () => {
    stageFirestore({ project: COLOURING_PROJECT, pageDocs: colouringPageDocs() })
    const { POST } = await loadRoute()

    const res = await POST(jsonPost('book-colouring'), routeContext('book-colouring'))
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.success).toBe(false)
    expect(body.missing).toEqual([2, 3])
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('returns 404 for a cross-org project', async () => {
    stageFirestore({ project: { ...SUDOKU_PROJECT, orgId: 'other-org' }, pageDocs: sudokuPageDocs(6) })
    const { POST } = await loadRoute()

    const res = await POST(jsonPost('book-sudoku'), routeContext('book-sudoku'))
    expect(res.status).toBe(404)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 404 for a missing project', async () => {
    stageFirestore({ project: null })
    const { POST } = await loadRoute()

    const res = await POST(jsonPost('book-gone'), routeContext('book-gone'))
    expect(res.status).toBe(404)
  })

  it('returns 404 for a deleted project', async () => {
    stageFirestore({ project: { ...SUDOKU_PROJECT, deleted: true } })
    const { POST } = await loadRoute()

    const res = await POST(jsonPost('book-sudoku'), routeContext('book-sudoku'))
    expect(res.status).toBe(404)
  })

  it('returns 403 for client-role callers (admin-only route)', async () => {
    stageFirestore({ project: SUDOKU_PROJECT, pageDocs: sudokuPageDocs(6) })
    mockUser = { uid: 'portal-client-1', role: 'client', orgId: 'pib-platform-owner' }
    const { POST } = await loadRoute()

    const res = await POST(jsonPost('book-sudoku'), routeContext('book-sudoku'))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.success).toBe(false)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 400 for an unknown book format', async () => {
    stageFirestore({ project: { ...SUDOKU_PROJECT, format: 'not_a_real_format' } })
    const { POST } = await loadRoute()

    const res = await POST(jsonPost('book-sudoku'), routeContext('book-sudoku'))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('unknown book format')
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
