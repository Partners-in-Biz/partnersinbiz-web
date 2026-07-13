import { NextRequest } from 'next/server'

const mockGetProjectForUser = jest.fn()
const mockCollection = jest.fn()
const mockProjectDoc = jest.fn()
const mockTaskCollection = jest.fn()
const mockTaskGet = jest.fn()
const mockWithAuth = jest.fn((_role: string, handler: any) => async (req: NextRequest, ctx?: unknown) => handler(req, mockUser, ctx))
const mockUser = { uid: 'client-1', role: 'client' as const, orgId: 'client-org' }

jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: mockCollection } }))
jest.mock('@/lib/api/auth', () => ({
  withAuth: (...args: any[]) => mockWithAuth(...args),
}))
jest.mock('@/lib/projects/access', () => ({
  getProjectForUser: (...args: unknown[]) => mockGetProjectForUser(...args),
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockGetProjectForUser.mockResolvedValue({
    ok: true,
    doc: { id: 'project-1', data: () => ({ name: 'Launch', orgId: 'owner-org', status: 'active' }) },
    projectAccess: { role: 'contributor', source: 'project_organization', canViewInternal: false },
  })
  mockTaskGet.mockResolvedValue({ docs: [
    { id: 'done', data: () => ({ title: 'Draft', columnId: 'done' }) },
    { id: 'ready', data: () => ({ title: 'Publish', columnId: 'todo' }) },
    { id: 'secret', data: () => ({ title: 'Provider token', columnId: 'todo', internalOnly: true, providerCredential: 'never-return' }) },
  ] })
  mockTaskCollection.mockReturnValue({ get: mockTaskGet })
  mockProjectDoc.mockReturnValue({ collection: mockTaskCollection })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'projects') return { doc: mockProjectDoc }
    throw new Error(`Unexpected collection ${name}`)
  })
})

async function get(kind: string, id: string) {
  const { GET } = await import('@/app/api/v1/chat-context/[kind]/[id]/route')
  return GET(new NextRequest(`http://localhost/api/v1/chat-context/${kind}/${id}`), {
    params: Promise.resolve({ kind, id }),
  })
}

describe('chat context read-model API', () => {
  it('returns a normalized project model with counts after access filtering', async () => {
    const res = await get('project', 'project-1')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.context).toEqual(expect.objectContaining({ kind: 'project', id: 'project-1', label: 'Launch' }))
    expect(body.data.pulse.progress).toEqual({ complete: 1, total: 2 })
    expect(body.data.groups[0].items.map((item: { id: string }) => item.id)).toEqual(['done', 'ready'])
    expect(JSON.stringify(body)).not.toContain('never-return')
    expect(body.data.asOf).toEqual(expect.any(String))
  })

  it('returns project access failures without reading child records', async () => {
    mockGetProjectForUser.mockResolvedValueOnce({ ok: false, error: 'Forbidden', status: 403 })
    const res = await get('project', 'project-1')

    expect(res.status).toBe(404)
    expect(mockTaskGet).not.toHaveBeenCalled()
  })

  it('does not disclose whether a forbidden or missing project exists', async () => {
    mockGetProjectForUser.mockResolvedValueOnce({ ok: false, error: 'Forbidden', status: 403 })
    const forbidden = await get('project', 'private-project')
    mockGetProjectForUser.mockResolvedValueOnce({ ok: false, error: 'Project not found', status: 404 })
    const missing = await get('project', 'missing-project')

    expect(forbidden.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(await forbidden.json()).toEqual(await missing.json())
  })

  it('normalizes malformed legacy task fields before classification', async () => {
    mockTaskGet.mockResolvedValueOnce({ docs: [
      { id: 'legacy', data: () => ({ title: 42, columnId: 'todo', dependsOn: 'done', labels: [1, ' safe ', null] }) },
    ] })

    const res = await get('project', 'project-1')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.groups[0].items).toEqual([
      expect.objectContaining({ id: 'legacy', label: 'Untitled task', state: 'ready' }),
    ])
  })

  it('uses the canonical Firestore document id instead of a stored id field', async () => {
    mockTaskGet.mockResolvedValueOnce({ docs: [
      { id: 'canonical-id', data: () => ({ id: 'spoofed-id', title: 'Canonical task', columnId: 'todo' }) },
    ] })

    const res = await get('project', 'project-1')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.groups[0].items).toEqual([
      expect.objectContaining({ id: 'canonical-id', label: 'Canonical task' }),
    ])
  })

  it('omits an invalid task date without failing the read model', async () => {
    mockTaskGet.mockResolvedValueOnce({ docs: [
      { id: 'legacy-date', data: () => ({ title: 'Legacy date', columnId: 'todo', updatedAt: new Date('invalid') }) },
    ] })

    const res = await get('project', 'project-1')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.groups[0].items[0]).toEqual(expect.objectContaining({ id: 'legacy-date' }))
    expect(body.data.groups[0].items[0]).not.toHaveProperty('updatedAt')
  })

  it.each([
    ['unknown', 'id', 400],
    ['project', '', 400],
    ['project', 'bad/id', 400],
  ])('rejects invalid kind or opaque id (%s, %s)', async (kind, id, status) => {
    const res = await get(kind, id)
    expect(res.status).toBe(status)
    expect(mockGetProjectForUser).not.toHaveBeenCalled()
  })

  it('does not disclose whether a disabled Studio object exists', async () => {
    const first = await get('studio', 'exists')
    const second = await get('studio', 'does-not-exist')

    expect(first.status).toBe(404)
    expect(await first.json()).toEqual(await second.json())
  })

  it('is client-authenticated and exports GET only', async () => {
    jest.resetModules()
    const route = await import('@/app/api/v1/chat-context/[kind]/[id]/route')
    expect(mockWithAuth).toHaveBeenCalledWith('client', expect.any(Function))
    expect((route as { POST?: unknown }).POST).toBeUndefined()
  })
})
