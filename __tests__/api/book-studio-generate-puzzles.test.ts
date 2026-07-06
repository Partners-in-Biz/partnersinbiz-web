import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockGet = jest.fn()
const mockAdd = jest.fn()
const mockDoc = jest.fn()
const mockOrgGet = jest.fn()
const mockCanAccessOrg = jest.fn()
let mockUser = { uid: 'agent-pip', role: 'ai', orgId: 'pib-platform-owner' } as { uid: string; role: string; orgId?: string }

type AuthHandler = (req: NextRequest, user: typeof mockUser, context?: unknown) => Promise<Response> | Response

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
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

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}))

let addedPages: Array<Record<string, unknown>> = []

function stageFirestore({
  orgSettings = { portalModules: { bookStudio: true } },
  pageDocs = [],
  linkedDocs = {},
}: {
  orgSettings?: Record<string, unknown>
  pageDocs?: Array<{ id: string; data: () => Record<string, unknown> }>
  linkedDocs?: Record<string, Record<string, unknown> | null>
} = {}) {
  addedPages = []
  mockCanAccessOrg.mockReturnValue(true)
  mockOrgGet.mockResolvedValue({ exists: true, data: () => ({ settings: orgSettings }) })
  mockGet.mockResolvedValue({ docs: pageDocs })
  mockAdd.mockImplementation(async (payload: Record<string, unknown>) => {
    addedPages.push(payload)
    return { id: `new-page-${addedPages.length}` }
  })
  mockWhere.mockReturnValue({ get: mockGet })
  mockDoc.mockImplementation((id: string) => {
    if (linkedDocs[id] !== undefined) {
      const data = linkedDocs[id]
      return { get: jest.fn().mockResolvedValue({ exists: data !== null, data: () => data }) }
    }
    return { get: mockOrgGet }
  })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') return { doc: mockDoc }
    return { where: mockWhere, add: mockAdd, doc: mockDoc }
  })
}

function jsonPost(projectId: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/v1/book-studio/projects/${projectId}/pages/generate-puzzles`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'pib-platform-owner' },
    body: JSON.stringify(body),
  })
}

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) }
}

const SUDOKU_PROJECT = { 'book-sudoku': { orgId: 'pib-platform-owner', title: 'Sudoku Vol 1', format: 'puzzle_sudoku', deleted: false } }
const MIXED_PROJECT = { 'book-mixed': { orgId: 'pib-platform-owner', title: 'Activity Mix', format: 'puzzle_mixed', deleted: false } }
const COLOURING_PROJECT = { 'book-colouring': { orgId: 'pib-platform-owner', title: 'Colour Me', format: 'colouring', deleted: false } }
const FOREIGN_PROJECT = { 'book-foreign': { orgId: 'other-org', title: 'Foreign', format: 'puzzle_sudoku', deleted: false } }

async function loadRoute() {
  return import('@/app/api/v1/book-studio/projects/[id]/pages/generate-puzzles/route')
}

describe('POST /api/v1/book-studio/projects/[id]/pages/generate-puzzles', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    mockUser = { uid: 'agent-pip', role: 'ai', orgId: 'pib-platform-owner' }
    stageFirestore()
  })

  it('creates 3 sudoku pages with sequential orders continuing from the existing max and distinct seeds', async () => {
    stageFirestore({
      linkedDocs: SUDOKU_PROJECT,
      pageDocs: [
        { id: 'p1', data: () => ({ orgId: 'pib-platform-owner', projectId: 'book-sudoku', order: 4, deleted: false }) },
        { id: 'p2', data: () => ({ orgId: 'pib-platform-owner', projectId: 'book-sudoku', order: 9, deleted: false }) },
        // deleted + other-project pages must not influence the max order
        { id: 'p3', data: () => ({ orgId: 'pib-platform-owner', projectId: 'book-sudoku', order: 50, deleted: true }) },
        { id: 'p4', data: () => ({ orgId: 'pib-platform-owner', projectId: 'other-book', order: 99, deleted: false }) },
      ],
    })
    const { POST } = await loadRoute()

    const res = await POST(jsonPost('book-sudoku', {
      kind: 'sudoku',
      count: 3,
      difficulty: 'medium',
      junkKey: 'ignored',
    }), routeContext('book-sudoku'))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.success).toBe(true)
    expect(body.data.pages).toHaveLength(3)
    expect(mockAdd).toHaveBeenCalledTimes(3)

    expect(addedPages.map((page) => page.order)).toEqual([10, 11, 12])
    addedPages.forEach((page, index) => {
      expect(page).toMatchObject({
        orgId: 'pib-platform-owner',
        projectId: 'book-sudoku',
        kind: 'puzzle',
        status: 'generated',
        title: `Sudoku — medium #${11 + index}`,
        createdBy: 'agent-pip',
        createdByType: 'agent',
      })
      const puzzle = page.puzzle as Record<string, unknown>
      expect(puzzle.kind).toBe('sudoku')
      expect(puzzle.difficulty).toBe('medium')
      expect(typeof puzzle.seed).toBe('number')
    })

    const seeds = addedPages.map((page) => (page.puzzle as Record<string, unknown>).seed)
    expect(new Set(seeds).size).toBe(3)
    expect(seeds[1]).toBe((seeds[0] as number) + 1)
  })

  it('respects startOrder instead of querying existing pages', async () => {
    stageFirestore({ linkedDocs: SUDOKU_PROJECT })
    const { POST } = await loadRoute()

    const res = await POST(jsonPost('book-sudoku', {
      kind: 'sudoku',
      count: 2,
      difficulty: 'easy',
      startOrder: 0,
    }), routeContext('book-sudoku'))

    expect(res.status).toBe(201)
    expect(addedPages.map((page) => page.order)).toEqual([0, 1])
    expect(addedPages[0].title).toBe('Sudoku — easy #1')
    // startOrder short-circuits the max-order lookup
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('rejects a non-puzzle project format with 400 and zero writes', async () => {
    stageFirestore({ linkedDocs: COLOURING_PROJECT })
    const { POST } = await loadRoute()

    const res = await POST(jsonPost('book-colouring', {
      kind: 'sudoku',
      count: 2,
      difficulty: 'easy',
    }), routeContext('book-colouring'))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('project format does not take puzzle pages')
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('rejects a kind that does not match the project format puzzleKind', async () => {
    stageFirestore({ linkedDocs: SUDOKU_PROJECT })
    const { POST } = await loadRoute()

    const res = await POST(jsonPost('book-sudoku', {
      kind: 'word_search',
      count: 1,
      difficulty: 'easy',
      params: { words: ['alpha', 'beta', 'gamma'] },
    }), routeContext('book-sudoku'))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain('does not match')
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('accepts multiple kinds on a puzzle_mixed project', async () => {
    const { POST } = await loadRoute()

    stageFirestore({ linkedDocs: MIXED_PROJECT })
    const sudoku = await POST(jsonPost('book-mixed', {
      kind: 'sudoku',
      count: 1,
      difficulty: 'hard',
    }), routeContext('book-mixed'))
    expect(sudoku.status).toBe(201)

    stageFirestore({ linkedDocs: MIXED_PROJECT })
    const maze = await POST(jsonPost('book-mixed', {
      kind: 'maze',
      count: 1,
      difficulty: 'easy',
    }), routeContext('book-mixed'))
    expect(maze.status).toBe(201)

    stageFirestore({ linkedDocs: MIXED_PROJECT })
    const wordSearch = await POST(jsonPost('book-mixed', {
      kind: 'word_search',
      count: 1,
      difficulty: 'medium',
      params: { words: ['alpha', 'beta', 'gamma'] },
    }), routeContext('book-mixed'))
    expect(wordSearch.status).toBe(201)
    expect((addedPages[0].puzzle as Record<string, unknown>).params).toEqual({ words: ['alpha', 'beta', 'gamma'] })
  })

  it('rejects invalid word_search params with the generator message and writes ZERO pages', async () => {
    stageFirestore({ linkedDocs: MIXED_PROJECT })
    const { POST } = await loadRoute()

    const res = await POST(jsonPost('book-mixed', {
      kind: 'word_search',
      count: 5,
      difficulty: 'easy',
      params: { words: [] },
    }), routeContext('book-mixed'))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain('word_search requires params.words')
    expect(mockAdd).not.toHaveBeenCalled()
    expect(addedPages).toHaveLength(0)
  })

  it('rejects count 0, count 101, non-integer count, and bad difficulty with 400', async () => {
    stageFirestore({ linkedDocs: SUDOKU_PROJECT })
    const { POST } = await loadRoute()

    for (const count of [0, 101, 2.5, 'three']) {
      const res = await POST(jsonPost('book-sudoku', {
        kind: 'sudoku',
        count,
        difficulty: 'easy',
      }), routeContext('book-sudoku'))
      expect(res.status).toBe(400)
    }

    const badDifficulty = await POST(jsonPost('book-sudoku', {
      kind: 'sudoku',
      count: 1,
      difficulty: 'brutal',
    }), routeContext('book-sudoku'))
    expect(badDifficulty.status).toBe(400)

    const badKind = await POST(jsonPost('book-sudoku', {
      kind: 'jigsaw',
      count: 1,
      difficulty: 'easy',
    }), routeContext('book-sudoku'))
    expect(badKind.status).toBe(400)

    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('returns 404 for cross-org, missing, and deleted projects', async () => {
    stageFirestore({
      linkedDocs: {
        ...FOREIGN_PROJECT,
        'book-gone': null,
        'book-deleted': { orgId: 'pib-platform-owner', format: 'puzzle_sudoku', deleted: true },
      },
    })
    const { POST } = await loadRoute()

    for (const id of ['book-foreign', 'book-gone', 'book-deleted']) {
      const res = await POST(jsonPost(id, {
        kind: 'sudoku',
        count: 1,
        difficulty: 'easy',
      }), routeContext(id))
      expect(res.status).toBe(404)
    }
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('returns 403 for client-role callers (admin-only route)', async () => {
    stageFirestore({ linkedDocs: SUDOKU_PROJECT })
    mockUser = { uid: 'portal-client-1', role: 'client', orgId: 'pib-platform-owner' }
    const { POST } = await loadRoute()

    const res = await POST(jsonPost('book-sudoku', {
      kind: 'sudoku',
      count: 1,
      difficulty: 'easy',
    }), routeContext('book-sudoku'))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.success).toBe(false)
    expect(mockAdd).not.toHaveBeenCalled()
  })
})
