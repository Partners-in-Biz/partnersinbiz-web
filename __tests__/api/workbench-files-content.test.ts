import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin' | 'client' | 'ai'; orgId: string }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockGetConversation = jest.fn()
const mockResolveWorkbenchSyncManifest = jest.fn()
const mockDownload = jest.fn()
const mockFile = jest.fn(() => ({ download: mockDownload }))
const mockBucket = jest.fn(() => ({ file: mockFile }))

let mockUser: MockUser = { uid: 'client-1', role: 'client', orgId: 'org-1' }
let mockCanAccess = true

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: mockGetConversation,
}))

jest.mock('@/lib/conversations/access', () => ({
  canAccessConversation: () => mockCanAccess,
  authorizeConversationProject: async () => ({ ok: true, projectId: 'proj-1' }),
}))

jest.mock('@/lib/messages/workbench/resolve-sync', () => ({
  resolveWorkbenchSyncManifest: mockResolveWorkbenchSyncManifest,
}))

jest.mock('firebase-admin/storage', () => ({
  getStorage: jest.fn(() => ({ bucket: mockBucket })),
}))

jest.mock('@/lib/firebase/admin', () => ({
  getAdminApp: jest.fn(() => ({})),
  adminDb: {},
}))

function baseConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv-1',
    orgId: 'org-1',
    participantUids: ['client-1'],
    participantAgentIds: ['pip'],
    workspaceContext: { projectId: 'proj-1' },
    ...overrides,
  }
}

const FILE_ENTRY = { type: 'file' as const, path: 'src/index.ts', sha256: 'a'.repeat(64), size: 42 }

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockUser = { uid: 'client-1', role: 'client', orgId: 'org-1' }
  mockCanAccess = true
  mockGetConversation.mockResolvedValue(baseConversation())
  mockResolveWorkbenchSyncManifest.mockResolvedValue({
    source: 'sync',
    manifest: { version: 1, projectId: 'proj-1', entries: [FILE_ENTRY], entryCount: 1, totalBytes: 42, revision: 'rev-1' },
  })
  mockDownload.mockResolvedValue([Buffer.from('export const x = 1\n', 'utf8')])
})

function request(path: string) {
  return new NextRequest(`http://localhost/api/v1/conversations/conv-1/workbench/files/content?path=${encodeURIComponent(path)}`)
}

describe('GET /api/v1/conversations/[convId]/workbench/files/content', () => {
  it('requires a valid path parameter', async () => {
    const { GET } = await import('@/app/api/v1/conversations/[convId]/workbench/files/content/route')
    const res = await GET(request('../escape.txt'), { params: Promise.resolve({ convId: 'conv-1' }) })
    expect(res.status).toBe(400)
  })

  it('404s when there is no synced manifest', async () => {
    mockResolveWorkbenchSyncManifest.mockResolvedValue({ source: 'none', manifest: null })
    const { GET } = await import('@/app/api/v1/conversations/[convId]/workbench/files/content/route')
    const res = await GET(request('src/index.ts'), { params: Promise.resolve({ convId: 'conv-1' }) })
    expect(res.status).toBe(404)
  })

  it('404s when the file is not present in the manifest', async () => {
    const { GET } = await import('@/app/api/v1/conversations/[convId]/workbench/files/content/route')
    const res = await GET(request('does/not/exist.ts'), { params: Promise.resolve({ convId: 'conv-1' }) })
    expect(res.status).toBe(404)
  })

  it('returns text content for a known file', async () => {
    const { GET } = await import('@/app/api/v1/conversations/[convId]/workbench/files/content/route')
    const res = await GET(request('src/index.ts'), { params: Promise.resolve({ convId: 'conv-1' }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toMatch(/text\/plain/)
    expect(await res.text()).toBe('export const x = 1\n')
  })

  it('415s when the object content looks binary', async () => {
    mockDownload.mockResolvedValue([Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe])])
    const { GET } = await import('@/app/api/v1/conversations/[convId]/workbench/files/content/route')
    const res = await GET(request('src/index.ts'), { params: Promise.resolve({ convId: 'conv-1' }) })
    expect(res.status).toBe(415)
  })

  it('413s when the manifest entry exceeds the preview size cap', async () => {
    mockResolveWorkbenchSyncManifest.mockResolvedValue({
      source: 'sync',
      manifest: {
        version: 1,
        projectId: 'proj-1',
        entries: [{ ...FILE_ENTRY, size: 10 * 1024 * 1024 }],
        entryCount: 1,
        totalBytes: 10 * 1024 * 1024,
        revision: 'rev-1',
      },
    })
    const { GET } = await import('@/app/api/v1/conversations/[convId]/workbench/files/content/route')
    const res = await GET(request('src/index.ts'), { params: Promise.resolve({ convId: 'conv-1' }) })
    expect(res.status).toBe(413)
  })

  it('403s for a non-participant', async () => {
    mockCanAccess = false
    const { GET } = await import('@/app/api/v1/conversations/[convId]/workbench/files/content/route')
    const res = await GET(request('src/index.ts'), { params: Promise.resolve({ convId: 'conv-1' }) })
    expect(res.status).toBe(403)
  })
})
