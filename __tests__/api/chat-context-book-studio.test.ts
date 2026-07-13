import { NextRequest } from 'next/server'

const mockResolveContextReferences = jest.fn()
const mockCollection = jest.fn()
const mockLimit = jest.fn()
let mockAuthUser: Record<string, unknown>

jest.mock('@/lib/api/auth', () => ({ withAuth: (_role: string, handler: any) => async (req: NextRequest, ctx?: unknown) => handler(req, mockAuthUser, ctx) }))
jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: (...args: unknown[]) => mockCollection(...args) } }))
jest.mock('@/lib/context-references/registry', () => ({ resolveContextReferences: (...args: unknown[]) => mockResolveContextReferences(...args) }))
jest.mock('@/lib/book-studio/capabilities', () => ({
  resolveBookStudioCapabilities: (_settings: unknown, role: string) => role === 'client'
    ? { canView: true, canCreate: false, canEdit: false, canEvidenceRights: false, canApprovalGates: false, canPublishingPackets: false, canArchiveDelete: false, isOperator: false }
    : { canView: true, canCreate: true, canEdit: true, canEvidenceRights: true, canApprovalGates: true, canPublishingPackets: true, canArchiveDelete: true, isOperator: true },
}))
jest.mock('@/lib/creative-canvas/store', () => ({ listCreativeCanvases: jest.fn(), getCreativeCanvas: jest.fn() }))
jest.mock('@/lib/creative-canvas/runs', () => ({ listCreativeCanvasRuns: jest.fn() }))
jest.mock('@/lib/creative-canvas/collaboration', () => ({ listCreativeCanvasVersions: jest.fn() }))
jest.mock('@/lib/creative-canvas/credits', () => ({ getCanvasCredits: jest.fn() }))

function query(docs: Array<{ id: string; data: () => Record<string, unknown> }>) {
  const value = { where: () => value, limit: (n: number) => { mockLimit(n); return value }, get: async () => ({ docs }) }
  return value
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuthUser = { uid: 'client-1', role: 'client', orgId: 'org-1', memberAccessPolicy: { mode: 'full' } }
  mockResolveContextReferences.mockResolvedValue([{ type: 'studio_artifact', id: 'book_studio:project:book-1', orgId: 'org-1', label: 'A Better Book', href: '/portal/book-studio/book-1' }])
  mockCollection.mockImplementation((name: string) => {
    if (name === 'book_studio_projects') return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ orgId: 'org-1', title: 'A Better Book', lifecycleState: 'content_complete', deleted: false, rightsLedger: { status: 'cleared', source: 'private-rights-source' }, gates: [{ id: 'private-gate', label: 'Private release gate', status: 'block' }], reviewStatus: 'client_review', reviewPackets: [{ id: 'private-packet', title: 'Private publishing packet' }], packageManifest: { status: 'generated', files: [{ role: 'cover_pdf', href: 'https://private.test/cover.pdf' }] } }) }) }) }
    if (name === 'organizations') return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ settings: {} }) }) }) }
    if (name === 'book_studio_chapters') return query([{ id: 'ch-1', data: () => ({ orgId: 'org-1', projectId: 'book-1', title: 'Chapter one', status: 'edited' }) }])
    if (name === 'book_studio_pages') return query([{ id: 'foreign', data: () => ({ orgId: 'org-2', projectId: 'book-1', title: 'Secret', status: 'approved' }) }])
    throw new Error(`unexpected collection ${name}`)
  })
})

async function get(id = 'book_studio:project:book-1') {
  const { GET } = await import('@/app/api/v1/chat-context/[kind]/[id]/route')
  return GET(new NextRequest(`http://localhost/api/v1/chat-context/studio_artifact/${id}`), { params: Promise.resolve({ kind: 'studio_artifact', id }) })
}

describe('Book Studio chat context API', () => {
  it('returns a bounded portal-governed projection through the Book Studio namespace', async () => {
    const response = await get()
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data.context).toEqual(expect.objectContaining({ id: 'book_studio:project:book-1', href: '/portal/book-studio/book-1' }))
    expect(body.data.groups.find((group: { id: string }) => group.id === 'chapters').items).toHaveLength(1)
    expect(body.data.groups.find((group: { id: string }) => group.id === 'pages').items).toHaveLength(0)
    expect(body.data.capabilities).toEqual(['view'])
    expect(body.data.artifacts.flatMap((item: { actions: Array<{ method?: string }> }) => item.actions).every((action: { method?: string }) => !action.method)).toBe(true)
    expect(JSON.stringify(body.data)).not.toContain('private-rights-source')
    expect(JSON.stringify(body.data)).not.toContain('Private release gate')
    expect(JSON.stringify(body.data)).not.toContain('client_review')
    expect(JSON.stringify(body.data)).not.toContain('Private publishing packet')
    expect(JSON.stringify(body.data)).not.toContain('private.test')
    expect(mockLimit).toHaveBeenCalledWith(50)
    expect(mockCollection).not.toHaveBeenCalledWith('book_studio_rights_ledgers')
    expect(mockCollection).not.toHaveBeenCalledWith('book_studio_publishing_packets')
  })

  it('returns an indistinguishable 404 before record reads when canonical access fails', async () => {
    mockResolveContextReferences.mockResolvedValueOnce([])
    const response = await get('book_studio:project:private')
    expect(response.status).toBe(404)
    expect(mockCollection).not.toHaveBeenCalledWith('book_studio_projects')
  })
})
