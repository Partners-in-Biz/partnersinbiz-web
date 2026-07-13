import { NextRequest } from 'next/server'

const mockResolveContextReferences = jest.fn()
const mockCollection = jest.fn()
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

beforeEach(() => {
  jest.clearAllMocks()
  mockAuthUser = { uid: 'client-1', role: 'client', orgId: 'org-1', memberAccessPolicy: { mode: 'full' } }
  mockResolveContextReferences.mockResolvedValue([{ type: 'studio_artifact', id: 'video_editor:project:project-1', orgId: 'org-1', label: 'Launch cut', href: '/portal/video-editor?projectId=project-1' }])
  mockCollection.mockImplementation((name: string) => {
    if (name === 'video_editor_projects') return { doc: () => ({ get: async () => ({ exists: true, data: () => project }) }) }
    if (name === 'video_editor_render_jobs') return { where: () => ({ get: async () => ({ docs: [{ id: 'render-1', data: () => ({ orgId: 'org-1', projectId: 'project-1', status: 'rendered', output: { url: 'https://cdn.test/render.mp4', storagePath: 'render.mp4' }, credits: { estimated: 1, charged: 1, refunded: 0 }, deleted: false }) }] }) }) }
    if (name === 'video_editor_transcripts') return { where: () => ({ get: async () => ({ docs: [] }) }) }
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
      return { where: () => ({ get: async () => ({ docs: [{ id: 'foreign', data: () => ({ orgId: 'org-2', projectId: 'project-1', status: 'failed', deleted: false, credits: {} }) }] }) }) }
    })
    const response = await get('video_editor:project:project-1')
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data.artifacts.some((item: { resourceId: string }) => item.resourceId === 'foreign')).toBe(false)
    expect(body.data.attention).toEqual([])
  })
})
