import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockGet = jest.fn()
const mockAdd = jest.fn()
const mockDoc = jest.fn()
const mockSet = jest.fn()
const mockUpdate = jest.fn()
const mockOrgGet = jest.fn()
const mockCanAccessOrg = jest.fn()
let mockUser = { uid: 'agent-pip', role: 'ai', orgId: 'pib-platform-owner' } as { uid: string; role: string; orgId?: string }

type AuthHandler = (req: NextRequest, user: typeof mockUser, context?: unknown) => Promise<Response> | Response

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string | string[], handler: AuthHandler) => (req: NextRequest, context?: unknown) =>
    handler(req, mockUser, context),
}))

jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: (...args: unknown[]) => mockCanAccessOrg(...args),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS', delete: () => 'DELETE_FIELD' },
}))

function stageFirestore({
  orgSettings = { portalModules: { bookStudio: true } },
  docs = [],
  linkedDocs = {},
}: {
  orgSettings?: Record<string, unknown>
  docs?: Array<{ id: string; data: () => Record<string, unknown> }>
  linkedDocs?: Record<string, Record<string, unknown> | null>
} = {}) {
  mockCanAccessOrg.mockReturnValue(true)
  mockOrgGet.mockResolvedValue({ exists: true, data: () => ({ settings: orgSettings }) })
  mockGet.mockResolvedValue({ docs })
  mockAdd.mockResolvedValue({ id: 'new-record-1' })
  mockSet.mockResolvedValue(undefined)
  mockUpdate.mockResolvedValue(undefined)
  mockWhere.mockReturnValue({ get: mockGet })
  mockDoc.mockImplementation((id: string) => {
    if (linkedDocs[id] !== undefined) {
      const data = linkedDocs[id]
      return {
        get: jest.fn().mockResolvedValue({ exists: data !== null, data: () => data }),
        set: mockSet,
        update: mockUpdate,
      }
    }
    return { get: mockOrgGet, set: mockSet, update: mockUpdate }
  })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') return { doc: mockDoc }
    return { where: mockWhere, add: mockAdd, doc: mockDoc }
  })
}

function jsonPost(url: string, body: Record<string, unknown>) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'pib-platform-owner' },
    body: JSON.stringify(body),
  })
}

function jsonPatch(url: string, body: Record<string, unknown>) {
  return new NextRequest(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-org-id': 'pib-platform-owner' },
    body: JSON.stringify(body),
  })
}

function patchContext(resource: string, id: string) {
  return { params: Promise.resolve({ resource, id }) }
}

const OWN_PROJECT = { 'book-1': { orgId: 'pib-platform-owner', title: 'Book A', deleted: false } }

describe('Book Studio content model (chapters, pages, format/trim/series, PATCH)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    mockUser = { uid: 'agent-pip', role: 'ai', orgId: 'pib-platform-owner' }
    stageFirestore()
  })

  it('creates a chapter with a server-computed wordCount and ignores client wordCount', async () => {
    stageFirestore({ linkedDocs: OWN_PROJECT })
    const { POST } = await import('@/app/api/v1/book-studio/chapters/route')

    const res = await POST(jsonPost('http://localhost/api/v1/book-studio/chapters', {
      projectId: 'book-1',
      title: 'Chapter One',
      order: 3.9,
      body: 'One  two\nthree   four five.',
      wordCount: 999999,
      status: 'generated',
      canvasRunId: 'run-1',
      accessToken: 'hide-me',
      publishNow: true,
      internalNotes: 'operator-only',
    }))
    expect(res.status).toBe(201)
    expect(mockCollection).toHaveBeenCalledWith('book_studio_chapters')
    expect(mockAdd).toHaveBeenCalledTimes(1)
    const [payload] = mockAdd.mock.calls[0]
    expect(payload).toMatchObject({
      orgId: 'pib-platform-owner',
      projectId: 'book-1',
      title: 'Chapter One',
      order: 3,
      body: 'One  two\nthree   four five.',
      wordCount: 5,
      status: 'generated',
      canvasRunId: 'run-1',
      createdBy: 'agent-pip',
      createdByType: 'agent',
    })
    expect(payload.stage).toBeUndefined()
    expect(payload.channel).toBeUndefined()
    expect(JSON.stringify(payload)).not.toContain('accessToken')
    expect(JSON.stringify(payload)).not.toContain('publishNow')
    expect(JSON.stringify(payload)).not.toContain('internalNotes')
    expect(JSON.stringify(payload)).not.toContain('999999')
  })

  it('rejects a chapter body over the 900k character cap with a 400', async () => {
    stageFirestore({ linkedDocs: OWN_PROJECT })
    const { POST } = await import('@/app/api/v1/book-studio/chapters/route')

    const res = await POST(jsonPost('http://localhost/api/v1/book-studio/chapters', {
      projectId: 'book-1',
      title: 'Too big',
      body: 'x'.repeat(900_001),
    }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toContain('900000')
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('creates a page whose puzzle object round-trips typed fields and drops junk, and strips javascript: imageUrl', async () => {
    stageFirestore({ linkedDocs: OWN_PROJECT })
    const { POST } = await import('@/app/api/v1/book-studio/pages/route')

    const res = await POST(jsonPost('http://localhost/api/v1/book-studio/pages', {
      projectId: 'book-1',
      title: 'Puzzle page',
      kind: 'puzzle',
      order: 12,
      imageUrl: 'javascript:alert(1)',
      imageStoragePath: 'book-studio/org/book-1/page-12.png',
      caption: 'Solve me',
      prompt: 'sudoku grid',
      puzzle: {
        kind: 'sudoku',
        seed: 42.7,
        difficulty: 'hard',
        params: {
          holes: 52,
          theme: 'classic',
          words: ['alpha', 'beta'],
          nested: { evil: true },
          accessToken: 'hide',
          fn: null,
        },
        solutionRef: 'page-99',
        junkKey: 'drop-me',
      },
    }))
    expect(res.status).toBe(201)
    expect(mockCollection).toHaveBeenCalledWith('book_studio_pages')
    const [payload] = mockAdd.mock.calls[0]
    expect(payload).toMatchObject({
      orgId: 'pib-platform-owner',
      projectId: 'book-1',
      kind: 'puzzle',
      order: 12,
      imageStoragePath: 'book-studio/org/book-1/page-12.png',
      caption: 'Solve me',
      prompt: 'sudoku grid',
      status: 'draft',
    })
    expect(payload.puzzle).toEqual({
      kind: 'sudoku',
      seed: 42,
      difficulty: 'hard',
      params: { holes: 52, theme: 'classic', words: ['alpha', 'beta'] },
      solutionRef: 'page-99',
    })
    expect(payload.imageUrl).toBeUndefined()
    expect(JSON.stringify(payload)).not.toContain('javascript:')
    expect(JSON.stringify(payload)).not.toContain('junkKey')
    expect(JSON.stringify(payload)).not.toContain('nested')
    expect(JSON.stringify(payload)).not.toContain('accessToken')
  })

  it('accepts a known book format and trim preset on projects and rejects unknown ones', async () => {
    stageFirestore()
    const { POST } = await import('@/app/api/v1/book-studio/projects/route')

    const ok = await POST(jsonPost('http://localhost/api/v1/book-studio/projects', {
      title: 'Colouring fun',
      format: 'colouring',
      trim: { presetId: '8.5x11', widthIn: 8.5, heightIn: 11, bleed: 0.125, evil: 'drop' },
      pageTarget: 48,
      stylePrompt: 'thick outlines, no shading',
      creativeCanvasId: 'canvas-1',
      seriesVolumeNumber: 2,
      coverImageUrl: 'https://example.com/cover.png',
    }))
    expect(ok.status).toBe(201)
    const [payload] = mockAdd.mock.calls[0]
    expect(payload).toMatchObject({
      format: 'colouring',
      trim: { presetId: '8.5x11', widthIn: 8.5, heightIn: 11, bleed: 0.125 },
      pageTarget: 48,
      stylePrompt: 'thick outlines, no shading',
      creativeCanvasId: 'canvas-1',
      seriesVolumeNumber: 2,
      coverImageUrl: 'https://example.com/cover.png',
    })
    expect(JSON.stringify(payload.trim)).not.toContain('evil')
    mockAdd.mockClear()

    const badFormat = await POST(jsonPost('http://localhost/api/v1/book-studio/projects', {
      title: 'Bad format',
      format: 'not_a_format',
    }))
    const badFormatBody = await badFormat.json()
    expect(badFormat.status).toBe(400)
    expect(badFormatBody.error).toContain('unknown book format')
    expect(mockAdd).not.toHaveBeenCalled()

    const badTrim = await POST(jsonPost('http://localhost/api/v1/book-studio/projects', {
      title: 'Bad trim',
      format: 'story',
      trim: { presetId: '11x17' },
    }))
    const badTrimBody = await badTrim.json()
    expect(badTrim.status).toBe(400)
    expect(badTrimBody.error).toContain('unknown trim preset')
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('whitelists series volumeOrder, sharedMetadata, and sharedStylePrompt', async () => {
    const { sanitizeBookStudioRecordInput } = await import('@/lib/book-studio/sanitize')

    const series = sanitizeBookStudioRecordInput('series', {
      name: 'Puzzle Masters',
      volumeOrder: ['book-1', 'book-2', ''],
      sharedMetadata: {
        authorName: 'P. Stander',
        imprint: 'PiB Press',
        keywords: ['sudoku', ''],
        categories: ['Games'],
        accessToken: 'hide',
        isbn: 'not-shared',
      },
      sharedStylePrompt: 'bold retro palette',
      publishNow: true,
      internalNotes: 'hide',
    }, 'pib-platform-owner')

    expect(series).toMatchObject({
      name: 'Puzzle Masters',
      volumeOrder: ['book-1', 'book-2'],
      sharedMetadata: {
        authorName: 'P. Stander',
        imprint: 'PiB Press',
        keywords: ['sudoku'],
        categories: ['Games'],
      },
      sharedStylePrompt: 'bold retro palette',
    })
    expect(JSON.stringify(series)).not.toContain('accessToken')
    expect(JSON.stringify(series)).not.toContain('publishNow')
    expect(JSON.stringify(series)).not.toContain('internalNotes')
    expect(JSON.stringify(series.sharedMetadata)).not.toContain('isbn')
  })

  it('whitelists extended packageManifest file fields (role, storagePath, bytes, pageCount)', async () => {
    const { sanitizeBookStudioRecordInput } = await import('@/lib/book-studio/sanitize')

    const manifest = sanitizeBookStudioRecordInput('package-manifests', {
      title: 'Manifest',
      packageManifest: {
        status: 'draft',
        version: '2',
        files: [
          {
            label: 'Interior',
            href: 'https://example.com/interior.pdf',
            role: 'interior_pdf',
            storagePath: 'book-studio/org/book-1/interior.pdf',
            bytes: 120345,
            pageCount: 48,
            checksum: 'sha256:abc',
            type: 'pdf',
            version: '2',
          },
          { label: 'Bad role', href: 'https://example.com/x.pdf', role: 'store_upload', bytes: -5 },
          { label: 'No href', role: 'epub' },
        ],
      },
    }, 'pib-platform-owner')

    const files = (manifest.packageManifest as { files: Array<Record<string, unknown>> }).files
    expect(files).toHaveLength(2)
    expect(files[0]).toEqual({
      label: 'Interior',
      href: 'https://example.com/interior.pdf',
      role: 'interior_pdf',
      storagePath: 'book-studio/org/book-1/interior.pdf',
      bytes: 120345,
      pageCount: 48,
      checksum: 'sha256:abc',
      type: 'pdf',
      version: '2',
    })
    expect(files[1]).toEqual({ label: 'Bad role', href: 'https://example.com/x.pdf' })
  })

  it('PATCHes a chapter without allowing org/project moves and recomputes wordCount', async () => {
    stageFirestore({
      linkedDocs: {
        'chap-1': { orgId: 'pib-platform-owner', projectId: 'book-1', title: 'Chapter One', body: 'old words', wordCount: 2, deleted: false },
      },
    })
    const { PATCH } = await import('@/app/api/v1/book-studio/[resource]/[id]/route')

    const res = await PATCH(jsonPatch('http://localhost/api/v1/book-studio/chapters/chap-1', {
      title: 'Chapter One (edited)',
      body: 'brand new body text',
      status: 'edited',
      orgId: 'pib-platform-owner',
      projectId: 'book-other',
    }), patchContext('chapters', 'chap-1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toMatchObject({ id: 'chap-1', resource: 'chapters', updated: true })
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockSet).not.toHaveBeenCalled()
    const [patchPayload] = mockUpdate.mock.calls[0]
    expect(patchPayload).toMatchObject({
      title: 'Chapter One (edited)',
      body: 'brand new body text',
      wordCount: 4,
      status: 'edited',
      updatedBy: 'agent-pip',
      updatedByType: 'agent',
      updatedAt: 'SERVER_TS',
    })
    expect(patchPayload.orgId).toBeUndefined()
    expect(patchPayload.projectId).toBeUndefined()
    expect(patchPayload.createdBy).toBeUndefined()
    expect(patchPayload.deleted).toBeUndefined()
  })

  it('PATCH only touches fields present in the body (no create defaults leak in)', async () => {
    stageFirestore({
      linkedDocs: {
        'page-1': { orgId: 'pib-platform-owner', projectId: 'book-1', title: 'Page', status: 'generated', deleted: false },
      },
    })
    const { PATCH } = await import('@/app/api/v1/book-studio/[resource]/[id]/route')

    const res = await PATCH(jsonPatch('http://localhost/api/v1/book-studio/pages/page-1', {
      caption: 'New caption',
    }), patchContext('pages', 'page-1'))
    expect(res.status).toBe(200)
    const [patchPayload] = mockUpdate.mock.calls[0]
    expect(patchPayload.caption).toBe('New caption')
    expect(patchPayload.status).toBeUndefined()
    expect(patchPayload.title).toBeUndefined()
    expect(patchPayload.kind).toBeUndefined()
  })

  it('PATCH can intentionally clear optional fields with empty strings or nulls', async () => {
    stageFirestore({
      linkedDocs: {
        'page-1': {
          orgId: 'pib-platform-owner',
          projectId: 'book-1',
          title: 'Page',
          imageUrl: 'https://cdn.example/old.png',
          caption: 'Old caption',
          prompt: 'Old prompt',
          puzzle: { kind: 'sudoku', seed: 10 },
          deleted: false,
        },
      },
    })
    const { PATCH } = await import('@/app/api/v1/book-studio/[resource]/[id]/route')

    const res = await PATCH(jsonPatch('http://localhost/api/v1/book-studio/pages/page-1', {
      projectId: null,
      imageUrl: '',
      caption: '',
      prompt: null,
      puzzle: null,
    }), patchContext('pages', 'page-1'))

    expect(res.status).toBe(200)
    const [patchPayload] = mockUpdate.mock.calls[0]
    expect(patchPayload).toMatchObject({
      imageUrl: 'DELETE_FIELD',
      caption: 'DELETE_FIELD',
      prompt: 'DELETE_FIELD',
      puzzle: 'DELETE_FIELD',
      updatedBy: 'agent-pip',
    })
    expect(patchPayload.projectId).toBeUndefined()
    expect(patchPayload.title).toBeUndefined()
    expect(patchPayload.status).toBeUndefined()
  })

  it('PATCH can clear a chapter body to an empty string and recomputes wordCount to zero', async () => {
    stageFirestore({
      linkedDocs: {
        'chap-1': { orgId: 'pib-platform-owner', projectId: 'book-1', title: 'Chapter', body: 'old body', wordCount: 2, deleted: false },
      },
    })
    const { PATCH } = await import('@/app/api/v1/book-studio/[resource]/[id]/route')

    const res = await PATCH(jsonPatch('http://localhost/api/v1/book-studio/chapters/chap-1', {
      body: '',
    }), patchContext('chapters', 'chap-1'))

    expect(res.status).toBe(200)
    const [patchPayload] = mockUpdate.mock.calls[0]
    expect(patchPayload.body).toBe('')
    expect(patchPayload.wordCount).toBe(0)
  })

  it('soft-deletes a record via PATCH { deleted: true }', async () => {
    stageFirestore({
      linkedDocs: {
        'chap-1': { orgId: 'pib-platform-owner', projectId: 'book-1', title: 'Chapter One', deleted: false },
      },
    })
    const { PATCH } = await import('@/app/api/v1/book-studio/[resource]/[id]/route')

    const res = await PATCH(jsonPatch('http://localhost/api/v1/book-studio/chapters/chap-1', {
      deleted: true,
    }), patchContext('chapters', 'chap-1'))
    expect(res.status).toBe(200)
    const [patchPayload] = mockUpdate.mock.calls[0]
    expect(patchPayload.deleted).toBe(true)
    expect(patchPayload.updatedBy).toBe('agent-pip')
  })

  it('returns 404 for cross-org, missing, deleted, and unknown-resource PATCH targets', async () => {
    stageFirestore({
      linkedDocs: {
        'chap-foreign': { orgId: 'other-org', projectId: 'book-x', title: 'Foreign chapter', deleted: false },
        'chap-gone': null,
        'chap-deleted': { orgId: 'pib-platform-owner', title: 'Deleted', deleted: true },
      },
    })
    const { PATCH } = await import('@/app/api/v1/book-studio/[resource]/[id]/route')

    const crossOrg = await PATCH(jsonPatch('http://localhost/api/v1/book-studio/chapters/chap-foreign', { title: 'Steal' }), patchContext('chapters', 'chap-foreign'))
    expect(crossOrg.status).toBe(404)

    const missing = await PATCH(jsonPatch('http://localhost/api/v1/book-studio/chapters/chap-gone', { title: 'Ghost' }), patchContext('chapters', 'chap-gone'))
    expect(missing.status).toBe(404)

    const deleted = await PATCH(jsonPatch('http://localhost/api/v1/book-studio/chapters/chap-deleted', { title: 'Zombie' }), patchContext('chapters', 'chap-deleted'))
    expect(deleted.status).toBe(404)

    const unknown = await PATCH(jsonPatch('http://localhost/api/v1/book-studio/not-a-resource/x', { title: 'Nope' }), patchContext('not-a-resource', 'x'))
    expect(unknown.status).toBe(404)

    expect(mockSet).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('keeps runtime-dispatch and forbidden-key guards on the new resources', async () => {
    stageFirestore({
      linkedDocs: {
        'book-1': { orgId: 'pib-platform-owner', title: 'Book A', deleted: false },
        'chap-1': { orgId: 'pib-platform-owner', projectId: 'book-1', title: 'Chapter One', deleted: false },
      },
    })
    const { POST } = await import('@/app/api/v1/book-studio/pages/route')
    const { PATCH } = await import('@/app/api/v1/book-studio/[resource]/[id]/route')

    const dispatch = await POST(jsonPost('http://localhost/api/v1/book-studio/pages', {
      projectId: 'book-1',
      title: 'Unsafe',
      runtimeDispatch: { tool: 'kdp.upload' },
    }))
    expect(dispatch.status).toBe(403)
    expect(mockAdd).not.toHaveBeenCalled()

    const patchDispatch = await PATCH(jsonPatch('http://localhost/api/v1/book-studio/chapters/chap-1', {
      executeHermesSkill: { skillKey: 'book-kdp-readiness-check' },
    }), patchContext('chapters', 'chap-1'))
    expect(patchDispatch.status).toBe(403)
    expect(mockSet).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()

    const patched = await PATCH(jsonPatch('http://localhost/api/v1/book-studio/chapters/chap-1', {
      title: 'Safe title',
      accessToken: 'hide',
      publishNow: true,
      internalNotes: 'hide',
    }), patchContext('chapters', 'chap-1'))
    expect(patched.status).toBe(200)
    const [patchPayload] = mockUpdate.mock.calls[0]
    expect(JSON.stringify(patchPayload)).not.toContain('accessToken')
    expect(JSON.stringify(patchPayload)).not.toContain('publishNow')
    expect(JSON.stringify(patchPayload)).not.toContain('internalNotes')
  })

  it('enforces cross-tenant project references on chapter and page creation', async () => {
    stageFirestore({
      linkedDocs: { 'book-foreign': { orgId: 'other-org', title: 'Foreign book', deleted: false } },
    })
    const { POST } = await import('@/app/api/v1/book-studio/chapters/route')

    const res = await POST(jsonPost('http://localhost/api/v1/book-studio/chapters', {
      projectId: 'book-foreign',
      title: 'Stolen chapter',
      body: 'text',
    }))
    expect(res.status).toBe(403)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('rejects PATCH chapter with an invalid status enum value and leaves the stored status untouched', async () => {
    stageFirestore({
      linkedDocs: {
        'chap-1': { orgId: 'pib-platform-owner', projectId: 'book-1', title: 'Chapter One', status: 'approved', deleted: false },
      },
    })
    const { PATCH } = await import('@/app/api/v1/book-studio/[resource]/[id]/route')

    const res = await PATCH(jsonPatch('http://localhost/api/v1/book-studio/chapters/chap-1', {
      status: 'internal_review',
    }), patchContext('chapters', 'chap-1'))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toContain('status')
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('rejects PATCH page with an invalid kind enum value', async () => {
    stageFirestore({
      linkedDocs: {
        'page-1': { orgId: 'pib-platform-owner', projectId: 'book-1', title: 'Page', kind: 'illustration', deleted: false },
      },
    })
    const { PATCH } = await import('@/app/api/v1/book-studio/[resource]/[id]/route')

    const res = await PATCH(jsonPatch('http://localhost/api/v1/book-studio/pages/page-1', {
      kind: 'bogus',
    }), patchContext('pages', 'page-1'))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toContain('kind')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('PATCH page puzzle replaces the whole object instead of deep-merging stale params/solutionRef', async () => {
    stageFirestore({
      linkedDocs: {
        'page-1': {
          orgId: 'pib-platform-owner',
          projectId: 'book-1',
          title: 'Page',
          deleted: false,
          puzzle: { kind: 'sudoku', seed: 1, difficulty: 'hard', params: { holes: 52 }, solutionRef: 'old-solution' },
        },
      },
    })
    const { PATCH } = await import('@/app/api/v1/book-studio/[resource]/[id]/route')

    const res = await PATCH(jsonPatch('http://localhost/api/v1/book-studio/pages/page-1', {
      puzzle: { kind: 'maze', seed: 5, difficulty: 'easy' },
    }), patchContext('pages', 'page-1'))
    expect(res.status).toBe(200)

    // Defect 2 regression guard: update() must be used (not set with merge:true)
    // so Firestore replaces the whole `puzzle` map instead of deep-merging it
    // with the previously stored sudoku puzzle.
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockSet).not.toHaveBeenCalled()
    const [patchPayload] = mockUpdate.mock.calls[0]
    expect(patchPayload.puzzle).toEqual({ kind: 'maze', seed: 5, difficulty: 'easy' })
    expect(patchPayload.puzzle.params).toBeUndefined()
    expect(patchPayload.puzzle.solutionRef).toBeUndefined()
  })

  it('PATCH project packageManifest without checksum does not leave a stale checksum surviving via deep-merge', async () => {
    stageFirestore({
      linkedDocs: {
        'book-1': {
          orgId: 'pib-platform-owner',
          title: 'Book A',
          deleted: false,
          packageManifest: { status: 'draft', version: '1', checksum: 'sha256:old-stale-checksum' },
        },
      },
    })
    const { PATCH } = await import('@/app/api/v1/book-studio/[resource]/[id]/route')

    const res = await PATCH(jsonPatch('http://localhost/api/v1/book-studio/projects/book-1', {
      packageManifest: { status: 'draft', version: '2' },
    }), patchContext('projects', 'book-1'))
    expect(res.status).toBe(200)

    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockSet).not.toHaveBeenCalled()
    const [patchPayload] = mockUpdate.mock.calls[0]
    expect(patchPayload.packageManifest).toEqual({ status: 'draft', version: '2', qaStatus: 'missing_evidence' })
    expect(patchPayload.packageManifest.checksum).toBeUndefined()
  })
})
