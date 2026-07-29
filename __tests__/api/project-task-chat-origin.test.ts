import { NextRequest } from 'next/server'

const mockGetProjectForUser = jest.fn()
const mockGetConversation = jest.fn()
const mockResolveContextReferences = jest.fn()
const mockCollection = jest.fn()
const mockProjectDoc = jest.fn()
const mockTaskCollection = jest.fn()
const mockTaskWhere = jest.fn()
const mockTaskAdd = jest.fn()
const mockDuplicateGet = jest.fn()

const mockUser = { uid: 'ai-agent', role: 'ai' as const, orgId: 'org-1' }

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
    runTransaction: jest.fn(async (callback: (tx: {
      get: (ref: { get: () => unknown }) => unknown
      set: (ref: { set: (value: unknown) => unknown }, value: unknown) => unknown
    }) => unknown) => callback({
      get: (ref) => ref.get(),
      set: (ref, value) => ref.set(value),
    })),
  },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('@/lib/projects/access', () => ({
  getProjectForUser: (...args: unknown[]) => mockGetProjectForUser(...args),
}))

jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: (...args: unknown[]) => mockGetConversation(...args),
}))

jest.mock('@/lib/context-references/registry', () => ({
  resolveContextReferences: (...args: unknown[]) => mockResolveContextReferences(...args),
}))

jest.mock('@/lib/activity/log', () => ({ logActivity: jest.fn(() => Promise.resolve()) }))
jest.mock('@/lib/llm-providers/store', () => ({
  listLlmProviderConnections: jest.fn(async () => []),
}))
jest.mock('@/lib/llm-providers/sync-hermes', () => ({
  syncLlmConnectionToHermes: jest.fn(),
}))

jest.mock('@/lib/projects/planningDiscovery', () => ({
  planningMutationBlocker: jest.fn(() => null),
}))
jest.mock('@/lib/projects/planningDiscoveryStore', () => ({
  planningContextMutationTransition: jest.fn(() => ({
    allowed: true,
    state: null,
    event: null,
  })),
}))

const chatOrigin = {
  conversationId: 'conv-1',
  requestMessageId: 'user-message-1',
  responseMessageId: 'assistant-message-1',
  bundleId: 'launch-chain',
  sequence: 0,
}

function request(origin = chatOrigin, extra: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/v1/projects/project-1/tasks', {
    method: 'POST',
    headers: { 'x-org-id': 'org-1' },
    body: JSON.stringify({ title: 'Draft campaign copy', chatOrigin: origin, ...extra }),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetProjectForUser.mockResolvedValue({
    ok: true,
    doc: { id: 'project-1', data: () => ({ orgId: 'org-1', name: 'Launch' }) },
    projectAccess: { role: 'manager', source: 'owner_org', canViewInternal: true },
  })
  mockGetConversation.mockResolvedValue({
    id: 'conv-1',
    orgId: 'org-1',
    scope: 'general',
    contextRefs: [{ type: 'project', id: 'project-1', orgId: 'org-1', label: 'Launch', origin: 'mention' }],
    workspaceContext: { runtimeTarget: 'linked-device:mac-1' },
  })
  mockResolveContextReferences.mockResolvedValue([])
  mockDuplicateGet.mockResolvedValue({ empty: true, docs: [] })
  const secondWhere = jest.fn(() => ({ limit: () => ({ get: mockDuplicateGet }) }))
  mockTaskWhere.mockReturnValue({ where: secondWhere })
  mockTaskAdd.mockResolvedValue({ id: 'task-new' })
  mockTaskCollection.mockReturnValue({
    where: mockTaskWhere,
    add: mockTaskAdd,
    doc: jest.fn(() => ({ id: 'task-new', set: mockTaskAdd })),
  })
  mockProjectDoc.mockReturnValue({
    collection: mockTaskCollection,
    get: jest.fn(async () => ({
      exists: true,
      data: () => ({ orgId: 'org-1', name: 'Launch' }),
    })),
  })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'projects') return { doc: mockProjectDoc }
    if (name === 'notifications') return { add: jest.fn() }
    throw new Error(`Unexpected collection ${name}`)
  })
})

describe('project task chat origin', () => {
  it('rejects chat lineage from another organisation', async () => {
    mockGetConversation.mockResolvedValueOnce({
      id: 'conv-1', orgId: 'other-org', contextRefs: [{ type: 'project', id: 'project-1' }],
    })
    const { POST } = await import('@/app/api/v1/projects/[projectId]/tasks/route')
    const res = await POST(request(), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(res.status).toBe(400)
    expect(mockTaskAdd).not.toHaveBeenCalled()
  })

  it('returns the existing task for a retried bundle sequence', async () => {
    mockDuplicateGet.mockResolvedValueOnce({ empty: false, docs: [{ id: 'task-existing' }] })
    const { POST } = await import('@/app/api/v1/projects/[projectId]/tasks/route')
    const res = await POST(request(), { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({ id: 'task-existing', deduplicated: true })
    expect(mockTaskAdd).not.toHaveBeenCalled()
  })

  it('stores validated chat lineage for a new task', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/tasks/route')
    const res = await POST(request(), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(res.status).toBe(201)
    expect(mockTaskAdd).toHaveBeenCalledWith(expect.objectContaining({
      chatOrigin,
      agentRuntimeTargetId: 'linked-device:mac-1',
    }))
  })

  it('requires explicit matching agent organisation scope', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/tasks/route')
    const missing = await POST(new NextRequest('http://localhost/api/v1/projects/project-1/tasks', {
      method: 'POST', body: JSON.stringify({ title: 'Unsafe' }),
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const mismatch = await POST(new NextRequest('http://localhost/api/v1/projects/project-1/tasks', {
      method: 'POST', headers: { 'x-org-id': 'other-org' }, body: JSON.stringify({ title: 'Unsafe' }),
    }), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(missing.status).toBe(400)
    expect(mismatch.status).toBe(403)
    expect(mockTaskAdd).not.toHaveBeenCalled()
  })

  it('derives task orgId from the authoritative project instead of the body', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/tasks/route')
    const res = await POST(request(chatOrigin, { orgId: 'other-org' }), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(res.status).toBe(201)
    expect(mockGetProjectForUser).toHaveBeenCalledWith('project-1', mockUser, 'org-1')
    expect(mockTaskAdd).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1' }))
    expect(mockTaskAdd).not.toHaveBeenCalledWith(expect.objectContaining({ orgId: 'other-org' }))
  })

  it('requires contributor write permission before creating a task', async () => {
    mockGetProjectForUser.mockResolvedValueOnce({
      ok: true,
      doc: { id: 'project-1', data: () => ({ orgId: 'org-1' }) },
      projectAccess: { role: 'viewer', source: 'project_organization', canViewInternal: false },
    })
    const { POST } = await import('@/app/api/v1/projects/[projectId]/tasks/route')
    const res = await POST(request(), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(res.status).toBe(403)
    expect(mockTaskAdd).not.toHaveBeenCalled()
  })
})
