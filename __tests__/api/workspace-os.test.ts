import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin' | 'client' | 'ai'; orgId?: string; orgIds?: string[]; agentId?: string; authKind?: 'session' | 'legacy_ai_key' | 'agent_api_key'; allowedOrgIds?: string[] }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

let mockUser: MockUser = { uid: 'admin-1', role: 'admin' }
const mockAdd = jest.fn()
const mockGet = jest.fn()
const mockWhere = jest.fn()
const mockDoc = jest.fn()
const mockUpdate = jest.fn()
const mockCollection = jest.fn()
const mockServerTimestamp = jest.fn(() => 'SERVER_TIMESTAMP')

jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: mockCollection } }))
jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) => handler(req, mockUser, ctx),
}))
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: mockServerTimestamp } }))
jest.mock('@/lib/activity/log', () => ({ logActivity: jest.fn(() => Promise.resolve()) }))

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockUser = { uid: 'admin-1', role: 'admin' }
  const query = { where: mockWhere, get: mockGet }
  mockWhere.mockReturnValue(query)
  mockDoc.mockReturnValue({ get: mockGet, update: mockUpdate })
  mockCollection.mockImplementation((name: string) => {
    if (!['workspace_connections', 'workspace_artifacts', 'workspace_broker_jobs', 'workspace_artifact_events'].includes(name)) {
      throw new Error(`Unexpected collection: ${name}`)
    }
    return { add: mockAdd, where: mockWhere, get: mockGet, doc: mockDoc }
  })
})

describe('workspace connection API routes', () => {
  it('creates org-scoped connection records without raw secrets', async () => {
    mockAdd.mockResolvedValue({ id: 'conn-1' })
    const { POST } = await import('@/app/api/v1/workspace-connections/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/workspace-connections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-1', displayName: 'Drive broker', credentialRef: { secretName: 'workspace/broker' }, capabilities: { driveRead: true } }),
    }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data).toEqual({ id: 'conn-1' })
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', displayName: 'Drive broker', createdAt: 'SERVER_TIMESTAMP' }))
  })

  it('rejects body/header org mismatches and restricted admin boundaries', async () => {
    mockUser = { uid: 'admin-2', role: 'admin', allowedOrgIds: ['org-allowed'] }
    const { POST } = await import('@/app/api/v1/workspace-connections/route')
    const mismatch = await POST(new NextRequest('http://localhost/api/v1/workspace-connections', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-org-id': 'org-1' }, body: JSON.stringify({ orgId: 'org-2', displayName: 'Drive broker' }),
    }))
    const forbidden = await POST(new NextRequest('http://localhost/api/v1/workspace-connections', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orgId: 'org-denied', displayName: 'Drive broker' }),
    }))

    expect(mismatch.status).toBe(400)
    expect(forbidden.status).toBe(403)
    expect(mockAdd).not.toHaveBeenCalled()
  })
})

describe('workspace artifact API routes', () => {
  it('links existing Google artifacts idempotently as PiB metadata only', async () => {
    mockAdd.mockResolvedValue({ id: 'artifact-1' })
    const { POST } = await import('@/app/api/v1/workspace-artifacts/link-existing/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/workspace-artifacts/link-existing', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-1', title: 'Plan', artifactType: 'google_doc', googleUrl: 'https://docs.google.com/document/d/doc-1/edit', projectId: 'project-1', visibility: 'admin_agents' }),
    }))

    expect(res.status).toBe(201)
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      title: 'Plan',
      artifactType: 'google_doc',
      google: expect.objectContaining({ fileId: 'doc-1' }),
      projectId: 'project-1',
    }))
  })

  it('agent artifact lookup filters by visibility and resource', async () => {
    mockUser = { uid: 'agent:theo', role: 'ai', agentId: 'theo' }
    mockGet.mockResolvedValue({ docs: [
      { id: 'a1', data: () => ({ orgId: 'org-1', title: 'Plan', artifactType: 'google_doc', projectId: 'project-1', visibility: 'admin_agents', lifecycleStatus: 'draft', permissions: {}, deleted: false }) },
      { id: 'a2', data: () => ({ orgId: 'org-1', title: 'Private', artifactType: 'google_doc', projectId: 'project-1', visibility: 'admin_only', lifecycleStatus: 'draft', permissions: {}, deleted: false }) },
      { id: 'a3', data: () => ({ orgId: 'org-1', title: 'Other', artifactType: 'google_sheet', projectId: 'project-2', visibility: 'admin_agents', lifecycleStatus: 'draft', permissions: {}, deleted: false }) },
    ] })
    const { GET } = await import('@/app/api/v1/agent/workspace-artifacts/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/agent/workspace-artifacts?orgId=org-1&projectId=project-1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.artifacts.map((item: { id: string }) => item.id)).toEqual(['a1'])
  })
})

describe('workspace broker API routes', () => {
  it('queues gated Docs/Sheets create jobs without making Google API calls', async () => {
    mockAdd.mockResolvedValue({ id: 'job-1' })
    const { POST } = await import('@/app/api/v1/workspace-broker/docs/create/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/workspace-broker/docs/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-1' },
      body: JSON.stringify({ orgId: 'org-1', title: 'Client-facing brief', visibility: 'admin_agents_clients', projectId: 'project-1' }),
    }))
    const body = await res.json()

    expect(res.status).toBe(202)
    expect(body.data).toMatchObject({ id: 'job-1', approvalRequired: true, googleMutationPerformed: false })
    expect(mockCollection).not.toHaveBeenCalledWith('googleapis')
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      operation: 'create_doc',
      status: 'awaiting_approval',
      requiredCapability: 'write',
      output: { googleMutationPerformed: false },
      idempotencyKey: 'idem-1',
    }))
  })

  it('archives broker delete requests as approval-gated metadata jobs only', async () => {
    mockAdd.mockResolvedValue({ id: 'job-delete' })
    mockGet.mockResolvedValue({ exists: true, id: 'artifact-1', data: () => ({ orgId: 'org-1', title: 'Plan', artifactType: 'google_doc', visibility: 'admin_agents', deleted: false }) })
    const { POST } = await import('@/app/api/v1/workspace-broker/artifacts/[id]/request-delete/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/workspace-broker/artifacts/artifact-1/request-delete?orgId=org-1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'cleanup' }) }), { params: Promise.resolve({ id: 'artifact-1' }) })

    expect(res.status).toBe(202)
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ operation: 'request_delete', status: 'awaiting_approval', output: { googleMutationPerformed: false } }))
  })
})
