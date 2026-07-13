import { NextRequest } from 'next/server'

const mockGetCreativeCanvas = jest.fn()
const mockListCreativeCanvases = jest.fn()
const mockListRuns = jest.fn()
const mockListVersions = jest.fn()
const mockGetCredits = jest.fn()
const mockCollection = jest.fn()
const mockResolveContextReferences = jest.fn()
let mockAuthUser: Record<string, unknown>
const mockWithAuth = jest.fn((_role: string, handler: any) => async (req: NextRequest, ctx?: unknown) => handler(req, mockAuthUser, ctx))

jest.mock('@/lib/api/auth', () => ({ withAuth: (role: string, handler: unknown) => mockWithAuth(role, handler) }))
jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: (...args: unknown[]) => mockCollection(...args) } }))
jest.mock('@/lib/context-references/registry', () => ({ resolveContextReferences: (...args: unknown[]) => mockResolveContextReferences(...args) }))
jest.mock('@/lib/creative-canvas/store', () => ({
  getCreativeCanvas: (...args: unknown[]) => mockGetCreativeCanvas(...args),
  listCreativeCanvases: (...args: unknown[]) => mockListCreativeCanvases(...args),
}))
jest.mock('@/lib/creative-canvas/runs', () => ({ listCreativeCanvasRuns: (...args: unknown[]) => mockListRuns(...args) }))
jest.mock('@/lib/creative-canvas/collaboration', () => ({ listCreativeCanvasVersions: (...args: unknown[]) => mockListVersions(...args) }))
jest.mock('@/lib/creative-canvas/credits', () => ({ getCanvasCredits: (...args: unknown[]) => mockGetCredits(...args) }))

beforeEach(() => {
  jest.clearAllMocks()
  mockAuthUser = { uid: 'client-1', role: 'client', orgId: 'org-1', activeOrgId: 'org-1', orgIds: ['org-1', 'org-2'] }
  mockGetCreativeCanvas.mockImplementation(async (_canvasId: string, orgId: string) => orgId === 'org-1' ? { id: 'canvas-1', orgId: 'org-1', title: 'Launch', purpose: '', status: 'draft', activeVersion: 1, visibility: 'admin_agents_clients', linked: {}, nodes: [], edges: [], deleted: false, createdBy: 'u', createdByType: 'user', updatedBy: 'u', updatedByType: 'user' } : null)
  mockListRuns.mockResolvedValue([])
  mockListVersions.mockResolvedValue([])
  mockGetCredits.mockResolvedValue({ orgId: 'org-1', used: 0, limit: null })
  mockListCreativeCanvases.mockResolvedValue([])
  mockResolveContextReferences.mockImplementation(async (refs: Array<{ id: string; orgId?: string }>) => refs.map((ref) => ({ type: 'studio', id: ref.id, orgId: ref.orgId ?? ref.id.split(':')[1], label: 'Marketing Studio', href: '/portal/creative-canvas' })))
  mockCollection.mockReturnValue({ where: () => ({ where: () => ({ get: async () => ({ docs: [] }) }) }) })
})

async function get(kind: string, id: string) {
  const { GET } = await import('@/app/api/v1/chat-context/[kind]/[id]/route')
  return GET(new NextRequest(`http://localhost/api/v1/chat-context/${kind}/${id}`), { params: Promise.resolve({ kind, id }) })
}

describe('Marketing Studio chat context API', () => {
  it('resolves the canonical encoded canvas reference through existing domain reads', async () => {
    const res = await get('studio_artifact', 'marketing_studio:org:b3JnLTE:canvas:Y2FudmFzLTE')
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.context).toEqual(expect.objectContaining({ id: 'marketing_studio:org:b3JnLTE:canvas:Y2FudmFzLTE', href: '/portal/creative-canvas?canvasId=canvas-1&orgId=org-1' }))
    expect(mockGetCreativeCanvas).toHaveBeenCalledWith('canvas-1', 'org-1')
    expect(mockListRuns).toHaveBeenCalledWith('canvas-1', 'org-1')
  })

  it('resolves a canonical canvas in an allowed non-active organisation', async () => {
    mockGetCreativeCanvas.mockResolvedValueOnce({ id: 'canvas-2', orgId: 'org-2', title: 'Launch', purpose: '', status: 'draft', activeVersion: 1, visibility: 'admin_agents_clients', linked: {}, nodes: [], edges: [], deleted: false, createdBy: 'u', createdByType: 'user', updatedBy: 'u', updatedByType: 'user' })
    const res = await get('studio_artifact', 'marketing_studio:org:b3JnLTI:canvas:Y2FudmFzLTI')
    expect(res.status).toBe(200)
    expect(mockGetCreativeCanvas).toHaveBeenCalledWith('canvas-2', 'org-2')
  })

  it('keeps legacy canvas references working by resolving across trusted memberships', async () => {
    const res = await get('studio_artifact', 'marketing_studio:canvas:canvas-1')
    expect(res.status).toBe(200)
    expect(mockGetCreativeCanvas).toHaveBeenCalledWith('canvas-1', 'org-1')
  })

  it('does not let active organisation selection disambiguate a legacy id that exists in two memberships', async () => {
    mockGetCreativeCanvas.mockImplementation(async (canvasId: string, orgId: string) => ({ id: canvasId, orgId, title: 'Duplicate', purpose: '', status: 'draft', activeVersion: 1, visibility: 'admin_agents_clients', linked: {}, nodes: [], edges: [], deleted: false, createdBy: 'u', createdByType: 'user', updatedBy: 'u', updatedByType: 'user' }))
    const res = await get('studio_artifact', 'marketing_studio:canvas:duplicate')
    expect(res.status).toBe(404)
    expect(mockGetCreativeCanvas).toHaveBeenCalledWith('duplicate', 'org-1')
    expect(mockGetCreativeCanvas).toHaveBeenCalledWith('duplicate', 'org-2')
  })

  it('safely resolves a direct legacy reference for an unrestricted superadmin from the authoritative record org', async () => {
    mockAuthUser = { uid: 'admin-1', role: 'admin', authKind: 'session', orgId: 'admin-home', activeOrgId: 'admin-home' }
    mockCollection.mockReturnValueOnce({ doc: () => ({ get: async () => ({ exists: true, id: 'canvas-client', data: () => ({ orgId: 'client-org', deleted: false }) }) }) })
    mockGetCreativeCanvas.mockResolvedValueOnce({ id: 'canvas-client', orgId: 'client-org', title: 'Client canvas', purpose: '', status: 'draft', activeVersion: 1, visibility: 'admin_agents', linked: {}, nodes: [], edges: [], deleted: false, createdBy: 'u', createdByType: 'user', updatedBy: 'u', updatedByType: 'user' })
    const res = await get('studio_artifact', 'marketing_studio:canvas:canvas-client')
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(mockGetCreativeCanvas).toHaveBeenCalledWith('canvas-client', 'client-org')
    expect(body.data.context.id).toBe('marketing_studio:org:Y2xpZW50LW9yZw:canvas:Y2FudmFzLWNsaWVudA')
  })

  it('does not disclose a missing or cross-organisation canvas', async () => {
    mockGetCreativeCanvas.mockResolvedValueOnce(null)
    const res = await get('studio_artifact', 'marketing_studio:canvas:private')
    expect(res.status).toBe(404)
    expect(mockListRuns).not.toHaveBeenCalled()
  })

  it('does not disclose an admin-and-agent-only canvas to a client', async () => {
    mockGetCreativeCanvas.mockResolvedValueOnce({ ...await mockGetCreativeCanvas(), visibility: 'admin_agents' })
    const res = await get('studio_artifact', 'marketing_studio:canvas:canvas-1')
    expect(res.status).toBe(404)
    expect(mockListRuns).not.toHaveBeenCalled()
  })

  it('omits admin-and-agent-only canvases from the client Studio overview', async () => {
    mockListCreativeCanvases.mockResolvedValueOnce([
      { id: 'shared', title: 'Shared', status: 'draft', visibility: 'admin_agents_clients' },
      { id: 'private', title: 'Private', status: 'draft', visibility: 'admin_agents' },
    ])
    const res = await get('studio', 'marketing_studio:org-1')
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.groups[0].items).toEqual([expect.objectContaining({ id: 'shared' })])
    expect(body.data.context.href).toBe('/portal/creative-canvas?orgId=org-1')
    expect(body.data.groups[0].items[0].href).toBe('/portal/creative-canvas?canvasId=shared&orgId=org-1')
  })

  it('rejects another Studio namespace without reading Marketing Studio', async () => {
    const res = await get('studio_artifact', 'video_editor:project:video-1')
    expect(res.status).toBe(404)
    expect(mockGetCreativeCanvas).not.toHaveBeenCalled()
  })
})
