import { NextRequest } from 'next/server'

const mockResolveContextReferences = jest.fn()
const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockOrderBy = jest.fn()
const mockLimit = jest.fn()
let mockAuthUser: Record<string, unknown>
const mockWithAuth = jest.fn((_role: string, handler: any) => async (req: NextRequest, ctx?: unknown) => handler(req, mockAuthUser, ctx))

jest.mock('@/lib/api/auth', () => ({ withAuth: (role: string, handler: unknown) => mockWithAuth(role, handler) }))
jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: (...args: unknown[]) => mockCollection(...args) } }))
jest.mock('@/lib/context-references/registry', () => ({ resolveContextReferences: (...args: unknown[]) => mockResolveContextReferences(...args) }))
jest.mock('@/lib/creative-canvas/store', () => ({ listCreativeCanvases: jest.fn(), getCreativeCanvas: jest.fn() }))
jest.mock('@/lib/creative-canvas/runs', () => ({ listCreativeCanvasRuns: jest.fn() }))
jest.mock('@/lib/creative-canvas/collaboration', () => ({ listCreativeCanvasVersions: jest.fn() }))
jest.mock('@/lib/creative-canvas/credits', () => ({ getCanvasCredits: jest.fn() }))

const project = {
  orgId: 'org-1', title: 'Launch cut', status: 'rendered', deleted: false,
  settings: { width: 1920, height: 1080, fps: 30, aspect: '16:9', background: '#000' }, timeline: { version: 1, tracks: [] },
}

function childQuery(docs: Array<{ id: string; data: () => Record<string, unknown> }>) {
  const query = {
    doc: (id: string) => ({ get: async () => {
      const match = docs.find((doc) => doc.id === id)
      return { exists: Boolean(match), data: () => match?.data() }
    } }),
    where: (...args: unknown[]) => { mockWhere(...args); return query },
    orderBy: (...args: unknown[]) => { mockOrderBy(...args); return query },
    limit: (...args: unknown[]) => { mockLimit(...args); return query },
    get: async () => ({ docs }),
  }
  return query
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuthUser = { uid: 'client-1', role: 'client', orgId: 'org-1', memberAccessPolicy: { mode: 'full' } }
  mockResolveContextReferences.mockResolvedValue([{ type: 'studio_artifact', id: 'video_editor:project:project-1', orgId: 'org-1', label: 'Launch cut', href: '/portal/video-editor?projectId=project-1' }])
  mockCollection.mockImplementation((name: string) => {
    if (name === 'video_editor_projects') return { doc: () => ({ get: async () => ({ exists: true, data: () => project }) }) }
    if (name === 'video_editor_render_jobs') return childQuery([{ id: 'render-1', data: () => ({ orgId: 'org-1', projectId: 'project-1', status: 'rendered', output: { url: 'https://cdn.test/render.mp4', storagePath: 'render.mp4' }, credits: { estimated: 1, charged: 1, refunded: 0 }, deleted: false }) }])
    if (name === 'video_editor_transcripts') return childQuery([])
    throw new Error(`unexpected collection ${name}`)
  })
})

async function get(id: string) {
  const { GET } = await import('@/app/api/v1/chat-context/[kind]/[id]/route')
  return GET(new NextRequest(`http://localhost/api/v1/chat-context/studio_artifact/${id}`), { params: Promise.resolve({ kind: 'studio_artifact', id }) })
}

describe('Video Editor chat context API', () => {
  it('routes the Video Editor namespace and returns only authoritative scoped records', async () => {
    const response = await get('video_editor:project:project-1')
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(mockResolveContextReferences).toHaveBeenCalledWith([{ type: 'studio_artifact', id: 'video_editor:project:project-1' }], mockAuthUser)
    expect(body.data.context).toEqual(expect.objectContaining({ id: 'video_editor:project:project-1', orgId: 'org-1' }))
    expect(body.data.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ resourceId: 'render-1', state: 'complete' })]))
    expect(mockWhere.mock.calls).toEqual(expect.arrayContaining([["orgId", "==", "org-1"], ["projectId", "==", "project-1"]]))
    expect(mockOrderBy).toHaveBeenCalledWith('updatedAt', 'desc')
    expect(mockLimit).toHaveBeenCalledWith(20)
  })

  it('returns only an exact child selected after authoritative parent access resolution', async () => {
    const { GET } = await import('@/app/api/v1/chat-context/[kind]/[id]/route')
    const id = 'video_editor:project:project-1'
    const response = await GET(new NextRequest(`http://localhost/api/v1/chat-context/studio_artifact/${id}?artifactId=video_editor%3Arender%3Arender-1`), { params: Promise.resolve({ kind: 'studio_artifact', id }) })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data.artifacts).toEqual([expect.objectContaining({ id: 'video_editor:render:render-1', resourceId: 'render-1' })])
    expect(body.data.context.id).toBe(id)
  })

  it('does not leak parent or sibling data when the selected child does not exist', async () => {
    const { GET } = await import('@/app/api/v1/chat-context/[kind]/[id]/route')
    const id = 'video_editor:project:project-1'
    const response = await GET(new NextRequest(`http://localhost/api/v1/chat-context/studio_artifact/${id}?artifactId=video_editor%3Arender%3Aother`), { params: Promise.resolve({ kind: 'studio_artifact', id }) })
    expect(response.status).toBe(404)
  })

  it('directly resolves an old render outside the bounded recent-child window', async () => {
    const docs = Array.from({ length: 21 }, (_, index) => ({
      id: index === 20 ? 'old-render' : `recent-${index}`,
      data: () => ({ orgId: 'org-1', projectId: 'project-1', status: 'rendered', deleted: false, credits: {}, updatedAt: `2026-07-${String(13 - Math.min(index, 12)).padStart(2, '0')}T00:00:00Z` }),
    }))
    mockCollection.mockImplementation((name: string) => {
      if (name === 'video_editor_projects') return { doc: () => ({ get: async () => ({ exists: true, data: () => project }) }) }
      if (name === 'video_editor_render_jobs') return childQuery(docs)
      if (name === 'video_editor_transcripts') return childQuery([])
      throw new Error(`unexpected collection ${name}`)
    })
    const { GET } = await import('@/app/api/v1/chat-context/[kind]/[id]/route')
    const id = 'video_editor:project:project-1'
    const response = await GET(new NextRequest(`http://localhost/api/v1/chat-context/studio_artifact/${id}?artifactId=video_editor%3Arender%3Aold-render`), { params: Promise.resolve({ kind: 'studio_artifact', id }) })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data.artifacts).toEqual([expect.objectContaining({ id: 'video_editor:render:old-render' })])
  })

  it('returns an indistinguishable 404 when canonical access resolution rejects the project', async () => {
    mockResolveContextReferences.mockResolvedValueOnce([])
    const response = await get('video_editor:project:private')
    expect(response.status).toBe(404)
    expect(mockCollection).not.toHaveBeenCalledWith('video_editor_render_jobs')
    expect(mockCollection).not.toHaveBeenCalledWith('video_editor_transcripts')
  })

  it('filters cross-organisation child records after project access is established', async () => {
    mockCollection.mockImplementation((name: string) => {
      if (name === 'video_editor_projects') return { doc: () => ({ get: async () => ({ exists: true, data: () => project }) }) }
      return childQuery([{ id: 'foreign', data: () => ({ orgId: 'org-2', projectId: 'project-1', status: 'failed', deleted: false, credits: {} }) }])
    })
    const response = await get('video_editor:project:project-1')
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data.artifacts.some((item: { resourceId: string }) => item.resourceId === 'foreign')).toBe(false)
    expect(body.data.attention).toEqual([])
  })

  it('returns an archived project as an archived read-only model', async () => {
    mockCollection.mockImplementation((name: string) => {
      if (name === 'video_editor_projects') return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ ...project, status: 'archived' }) }) }) }
      if (name === 'video_editor_render_jobs') return childQuery([{ id: 'failed-render', data: () => ({ orgId: 'org-1', projectId: 'project-1', status: 'failed', deleted: false, credits: {} }) }])
      if (name === 'video_editor_transcripts') return childQuery([])
      throw new Error(`unexpected collection ${name}`)
    })

    const response = await get('video_editor:project:project-1')
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data.artifacts.find((item: { resourceType: string }) => item.resourceType === 'project')).toEqual(expect.objectContaining({ state: 'archived' }))
    expect(body.data.artifacts.flatMap((item: { actions: Array<{ method?: string }> }) => item.actions).every((action: { method?: string }) => !action.method)).toBe(true)
    expect(body.data.capabilities).toEqual(['view', 'review_output'])
  })

  it('continues to reject a deleted project', async () => {
    mockCollection.mockImplementation((name: string) => {
      if (name === 'video_editor_projects') return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ ...project, deleted: true }) }) }) }
      throw new Error(`unexpected collection ${name}`)
    })

    const response = await get('video_editor:project:project-1')
    expect(response.status).toBe(404)
    expect(mockCollection).not.toHaveBeenCalledWith('video_editor_render_jobs')
    expect(mockCollection).not.toHaveBeenCalledWith('video_editor_transcripts')
  })

  it('bounds render artifacts even if the backing query returns more than its requested cap', async () => {
    mockCollection.mockImplementation((name: string) => {
      if (name === 'video_editor_projects') return { doc: () => ({ get: async () => ({ exists: true, data: () => project }) }) }
      if (name === 'video_editor_render_jobs') return childQuery(Array.from({ length: 25 }, (_, index) => ({
        id: `render-${index}`, data: () => ({ orgId: 'org-1', projectId: 'project-1', status: 'rendered', deleted: false, credits: {}, updatedAt: `2026-07-13T${String(index).padStart(2, '0')}:00:00Z` }),
      })))
      if (name === 'video_editor_transcripts') return childQuery([])
      throw new Error(`unexpected collection ${name}`)
    })

    const response = await get('video_editor:project:project-1')
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data.artifacts.filter((item: { resourceType: string }) => item.resourceType === 'render')).toHaveLength(20)
  })

  it.each(['client', 'admin', 'ai'] as const)('never returns persisted provider secrets to a %s caller', async (role) => {
    mockAuthUser = { ...mockAuthUser, role }
    mockCollection.mockImplementation((name: string) => {
      if (name === 'video_editor_projects') return { doc: () => ({ get: async () => ({ exists: true, data: () => project }) }) }
      if (name === 'video_editor_render_jobs') return childQuery([{ id: 'failed-render', data: () => ({
        orgId: 'org-1', projectId: 'project-1', status: 'failed', deleted: false, credits: {},
        error: { code: 'provider_auth', message: 'Runtime leaked sk-live-sensitive' },
      }) }])
      if (name === 'video_editor_transcripts') return childQuery([])
      throw new Error(`unexpected collection ${name}`)
    })

    const response = await get('video_editor:project:project-1')
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(JSON.stringify(body)).not.toContain('sk-live-sensitive')
    expect(body.data.attention[0].detail).toBe('The render could not be completed. Try again later.')
  })
})
