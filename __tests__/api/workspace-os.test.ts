import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin' | 'client' | 'ai'; orgId?: string; orgIds?: string[]; agentId?: string; authKind?: 'session' | 'legacy_ai_key' | 'agent_api_key'; allowedOrgIds?: string[] }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

let mockUser: MockUser = { uid: 'admin-1', role: 'admin' }
const mockAdd = jest.fn()
const mockGet = jest.fn()
const mockWhere = jest.fn()
const mockDoc = jest.fn()
const mockUpdate = jest.fn()
const mockSet = jest.fn()
const mockDelete = jest.fn()
const mockGetDoc = jest.fn()
const mockCollection = jest.fn()
const mockServerTimestamp = jest.fn(() => 'SERVER_TIMESTAMP')

jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: mockCollection } }))
jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) => handler(req, mockUser, ctx),
}))
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: mockServerTimestamp },
  Timestamp: {
    now: jest.fn(() => 'NOW_TIMESTAMP'),
    fromMillis: jest.fn((millis: number) => ({ millis, toMillis: () => millis })),
  },
}))
jest.mock('@/lib/activity/log', () => ({ logActivity: jest.fn(() => Promise.resolve()) }))

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockUser = { uid: 'admin-1', role: 'admin' }
  const query = { where: mockWhere, limit: jest.fn(() => query), get: mockGet }
  mockWhere.mockReturnValue(query)
  mockGetDoc.mockReset()
  mockDoc.mockReturnValue({ get: mockGetDoc, update: mockUpdate, set: mockSet, delete: mockDelete })
  mockCollection.mockImplementation((name: string) => {
    if (!['workspace_connections', 'workspace_artifacts', 'workspace_broker_jobs', 'workspace_artifact_events', 'mailbox_oauth_states', 'mailbox_accounts'].includes(name)) {
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

  it('starts unified Google Workspace OAuth from an org-scoped registry record', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-id'
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'client-secret'
    mockGet.mockResolvedValue({ docs: [{ id: 'conn-1', data: () => ({
      orgId: 'org-1',
      connectionKey: 'google-workspace-drive-docs-sheets-gmail-calendar',
      scopes: [
        { scope: 'https://www.googleapis.com/auth/drive.file' },
        { scope: 'https://www.googleapis.com/auth/gmail.send' },
        { scope: 'https://www.googleapis.com/auth/calendar.events' },
      ],
      deleted: false,
    }) }] })
    const { GET } = await import('@/app/api/v1/workspace-connections/google/authorize/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/workspace-connections/google/authorize?orgId=org-1&connectionKey=google-workspace-drive-docs-sheets-gmail-calendar&returnTo=%2Fadmin%2Forg%2Facme-client%2Fsettings'))

    expect(res.status).toBe(302)
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('https://accounts.google.com/o/oauth2/v2/auth')
    expect(decodeURIComponent(location)).toContain('https://www.googleapis.com/auth/gmail.send')
    expect(decodeURIComponent(location)).toContain('https://www.googleapis.com/auth/calendar.events')
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      uid: 'admin-1',
      connectionId: 'conn-1',
      connectionKey: 'google-workspace-drive-docs-sheets-gmail-calendar',
      returnTo: '/admin/org/acme-client/settings',
      requestedScopes: expect.arrayContaining(['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/calendar.events']),
    }))
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
  const approvedConnection = {
    orgId: 'org-1',
    provider: 'google_workspace',
    status: 'active',
    approvalStatus: 'approved',
    tokenStatus: 'valid',
    capabilityScopes: ['write'],
    capabilities: { driveWrite: true, docsWrite: true, sheetsWrite: true },
    deleted: false,
  }

  it('queues gated Docs/Sheets create jobs without making Google API calls', async () => {
    mockGet.mockResolvedValue({ docs: [] })
    mockGetDoc.mockResolvedValueOnce({ exists: true, id: 'conn-1', data: () => approvedConnection })
    mockAdd.mockResolvedValue({ id: 'job-1' })
    const { POST } = await import('@/app/api/v1/workspace-broker/docs/create/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/workspace-broker/docs/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-1' },
      body: JSON.stringify({ orgId: 'org-1', connectionId: 'conn-1', title: 'Client-facing brief', visibility: 'admin_agents_clients', projectId: 'project-1' }),
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
      output: expect.objectContaining({ googleMutationPerformed: false, resultArtifactIds: [], resultArtifactUrls: [] }),
      idempotencyKey: 'idem-1',
      connectionId: 'conn-1',
      requester: { id: 'admin-1', type: 'admin', role: 'admin', agentId: null },
      requestedCapability: 'write',
      targetResource: expect.objectContaining({ orgId: 'org-1', connectionId: 'conn-1', projectId: 'project-1', title: 'Client-facing brief' }),
      approvalRequired: true,
      approvalSatisfied: false,
      errors: [],
    }))
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      brokerJobId: 'job-1',
      operation: 'create_doc',
      eventType: 'broker_job_queued',
      status: 'awaiting_approval',
      resultStatus: 'blocked',
      actor: expect.objectContaining({ id: 'admin-1', role: 'admin' }),
      approvalGateTaskId: null,
      source: expect.objectContaining({ projectId: 'project-1' }),
      safeMetadata: expect.objectContaining({ approvalRequired: true, requiredCapability: 'write' }),
      createdAt: 'SERVER_TIMESTAMP',
    }))
  })

  it('rejects Google mutation broker job creation when the connection is missing, unapproved, unhealthy, or under-scoped', async () => {
    const { POST } = await import('@/app/api/v1/workspace-broker/docs/create/route')
    const cases = [
      { name: 'missing connection', connectionId: undefined, snap: null, expected: 'Workspace broker connectionId is required for Google mutation jobs' },
      { name: 'unapproved connection', connectionId: 'conn-paused', snap: { ...approvedConnection, status: 'paused' }, expected: 'Workspace connection must be active or approved before broker mutation jobs can be queued' },
      { name: 'unhealthy token', connectionId: 'conn-stale', snap: { ...approvedConnection, tokenStatus: 'expired' }, expected: 'Workspace connection tokenStatus must be valid or healthy before broker mutation jobs can be queued' },
      { name: 'under-scoped connection', connectionId: 'conn-readonly', snap: { ...approvedConnection, capabilityScopes: ['read'], capabilities: { driveRead: true, docsRead: true } }, expected: 'Workspace connection does not grant the required broker capability' },
    ]

    for (const item of cases) {
      jest.clearAllMocks()
      mockGet.mockResolvedValue({ docs: [] })
      if (item.snap) mockGetDoc.mockResolvedValueOnce({ exists: true, id: item.connectionId, data: () => item.snap })
      const res = await POST(new NextRequest('http://localhost/api/v1/workspace-broker/docs/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId: 'org-1', connectionId: item.connectionId, title: item.name, visibility: 'admin_agents_clients', projectId: 'project-1' }),
      }))
      const body = await res.json()

      expect(res.status).toBe(403)
      expect(body.error).toBe(item.expected)
      expect(mockAdd).not.toHaveBeenCalled()
    }
  })

  it('rejects agent API broker mutation creation when the agent lacks the required capability', async () => {
    mockUser = { uid: 'agent:unknown-agent', role: 'ai', authKind: 'agent_api_key', agentId: 'unknown-agent' }
    mockGet.mockResolvedValue({ docs: [] })
    mockGetDoc.mockResolvedValueOnce({ exists: true, id: 'conn-1', data: () => approvedConnection })
    const { POST } = await import('@/app/api/v1/workspace-broker/docs/create/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/workspace-broker/docs/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-1', connectionId: 'conn-1', title: 'Agent doc', visibility: 'admin_agents_clients', projectId: 'project-1' }),
    }))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toContain("Agent 'unknown-agent' is not allowed to perform 'write'")
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('returns the existing workspace broker job when an idempotency key is replayed', async () => {
    mockGet.mockResolvedValue({ docs: [
      { id: 'job-existing', data: () => ({ orgId: 'org-1', operation: 'create_doc', status: 'awaiting_approval', idempotencyKey: 'idem-replay', approvalRequired: true, requiredCapability: 'write', riskLevel: 'medium', output: { googleMutationPerformed: false } }) },
    ] })
    mockAdd.mockResolvedValue({ id: 'job-new' })
    const { POST } = await import('@/app/api/v1/workspace-broker/docs/create/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/workspace-broker/docs/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-replay' },
      body: JSON.stringify({ orgId: 'org-1', title: 'Client-facing brief', visibility: 'admin_agents_clients', projectId: 'project-1' }),
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toMatchObject({ id: 'job-existing', status: 'awaiting_approval', approvalRequired: true, googleMutationPerformed: false })
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
    expect(mockWhere).toHaveBeenCalledWith('idempotencyKey', '==', 'idem-replay')
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('does not let create callers self-satisfy Workspace broker approval gates', async () => {
    mockGet.mockResolvedValue({ docs: [] })
    mockGetDoc.mockResolvedValueOnce({ exists: true, id: 'conn-1', data: () => approvedConnection })
    mockAdd.mockResolvedValue({ id: 'job-self-approval' })
    const { POST } = await import('@/app/api/v1/workspace-broker/docs/create/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/workspace-broker/docs/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-1', connectionId: 'conn-1', title: 'Client-facing brief', visibility: 'admin_agents_clients', approvalGateTaskId: 'task-approval-1', approvalStatus: 'approved' }),
    }))

    expect(res.status).toBe(202)
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      status: 'awaiting_approval',
      approvalSatisfied: false,
      approvalEvidence: { gateTaskId: null, status: null },
    }))
  })

  it('archives broker delete requests as approval-gated metadata jobs only', async () => {
    mockAdd.mockResolvedValue({ id: 'job-delete' })
    mockGet.mockResolvedValue({ docs: [] })
    mockGetDoc
      .mockResolvedValueOnce({ exists: true, id: 'artifact-1', data: () => ({ orgId: 'org-1', title: 'Plan', artifactType: 'google_doc', visibility: 'admin_agents', connectionId: 'conn-1', deleted: false }) })
      .mockResolvedValueOnce({ exists: true, id: 'conn-1', data: () => ({ ...approvedConnection, capabilityScopes: ['delete'], capabilities: { driveDelete: true } }) })
    const { POST } = await import('@/app/api/v1/workspace-broker/artifacts/[id]/request-delete/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/workspace-broker/artifacts/artifact-1/request-delete?orgId=org-1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'cleanup' }) }), { params: Promise.resolve({ id: 'artifact-1' }) })

    expect(res.status).toBe(202)
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'request_delete',
      status: 'awaiting_approval',
      output: expect.objectContaining({ googleMutationPerformed: false, resultArtifactIds: [], resultArtifactUrls: [] }),
      requestedCapability: 'delete',
      targetResource: expect.objectContaining({ orgId: 'org-1', artifactId: 'artifact-1' }),
      approvalRequired: true,
      approvalSatisfied: false,
      errors: [],
    }))
  })

  it('approves and rejects workspace broker jobs without performing Google mutations', async () => {
    mockGetDoc.mockResolvedValue({ exists: true, id: 'job-1', data: () => ({ orgId: 'org-1', status: 'awaiting_approval', operation: 'request_share', approvalRequired: true, approvalSatisfied: false, approvalGateTaskId: 'task-approval-1', output: { googleMutationPerformed: false } }) })
    const { PATCH } = await import('@/app/api/v1/workspace-broker/jobs/[id]/route')

    const approved = await PATCH(new NextRequest('http://localhost/api/v1/workspace-broker/jobs/job-1?orgId=org-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    }), { params: Promise.resolve({ id: 'job-1' }) })
    expect(approved.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'queued',
      approvalStatus: 'approved',
      approvalGateTaskId: 'task-approval-1',
      approvalSatisfied: true,
      approvalEvidence: expect.objectContaining({ gateTaskId: 'task-approval-1', status: 'approved', decidedBy: 'admin-1' }),
      output: { googleMutationPerformed: false },
      updatedAt: 'SERVER_TIMESTAMP',
    }))

    mockUpdate.mockClear()
    const rejected = await PATCH(new NextRequest('http://localhost/api/v1/workspace-broker/jobs/job-1?orgId=org-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'reject' }),
    }), { params: Promise.resolve({ id: 'job-1' }) })

    expect(rejected.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'cancelled',
      approvalStatus: 'rejected',
      output: { googleMutationPerformed: false },
      updatedAt: 'SERVER_TIMESTAMP',
    }))
  })

  it('requires approval evidence before approving workspace broker jobs', async () => {
    mockGetDoc.mockResolvedValue({ exists: true, id: 'job-1', data: () => ({ orgId: 'org-1', status: 'awaiting_approval', operation: 'request_share', approvalRequired: true, approvalSatisfied: false, output: { googleMutationPerformed: false } }) })
    const { PATCH } = await import('@/app/api/v1/workspace-broker/jobs/[id]/route')
    const res = await PATCH(new NextRequest('http://localhost/api/v1/workspace-broker/jobs/job-1?orgId=org-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    }), { params: Promise.resolve({ id: 'job-1' }) })

    expect(res.status).toBe(400)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects approval transitions for jobs that are not awaiting approval', async () => {
    mockGetDoc.mockResolvedValue({ exists: true, id: 'job-1', data: () => ({ orgId: 'org-1', status: 'done', operation: 'request_share', approvalRequired: true, output: { googleMutationPerformed: false } }) })
    const { PATCH } = await import('@/app/api/v1/workspace-broker/jobs/[id]/route')
    const res = await PATCH(new NextRequest('http://localhost/api/v1/workspace-broker/jobs/job-1?orgId=org-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    }), { params: Promise.resolve({ id: 'job-1' }) })

    expect(res.status).toBe(409)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('executes approved internal Google broker jobs through the server credential path and links artifact ids', async () => {
    process.env.GOOGLE_WORKSPACE_CREDS_JSON_PATH = '/approved/workspace-sa.json'
    mockGetDoc.mockResolvedValueOnce({
      exists: true,
      id: 'job-1',
      data: () => ({
        orgId: 'org-1',
        status: 'queued',
        operation: 'create_folder',
        approvalRequired: true,
        approvalSatisfied: true,
        approvalStatus: 'approved',
        approvalGateTaskId: 'gate-1',
        approvalEvidence: { gateTaskId: 'gate-1', status: 'approved', decidedBy: 'pip', decidedAt: '2026-06-05T10:00:00.000Z' },
        input: { title: 'Internal Evidence', parentFolderId: 'parent-1', visibility: 'admin_agents', projectId: 'project-1', taskId: 'task-1' },
        output: { googleMutationPerformed: false },
      }),
    })
    mockAdd.mockResolvedValueOnce({ id: 'artifact-created' })
    jest.doMock('@/lib/workspace-os/googleBrokerExecutor', () => ({
      executeWorkspaceBrokerJob: jest.fn(async () => ({
        googleMutationPerformed: true,
        providerResultIds: ['folder-1'],
        artifactIds: ['artifact-created'],
        artifactUrls: ['https://drive.google.com/drive/folders/folder-1'],
        output: { fileId: 'folder-1', url: 'https://drive.google.com/drive/folders/folder-1', mimeType: 'application/vnd.google-apps.folder' },
      })),
    }))
    const { PATCH } = await import('@/app/api/v1/workspace-broker/jobs/[id]/route')

    const res = await PATCH(new NextRequest('http://localhost/api/v1/workspace-broker/jobs/job-1?orgId=org-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'execute', credentialsPath: '/untrusted/body.json', approvalStatus: 'approved' }),
    }), { params: Promise.resolve({ id: 'job-1' }) })

    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data).toMatchObject({ id: 'job-1', status: 'done', googleMutationPerformed: true, artifactIds: ['artifact-created'] })
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'done',
      completedAt: 'SERVER_TIMESTAMP',
      resultArtifactIds: ['artifact-created'],
      resultArtifactUrls: ['https://drive.google.com/drive/folders/folder-1'],
      output: expect.objectContaining({
        googleMutationPerformed: true,
        fileId: 'folder-1',
        artifactIds: ['artifact-created'],
        resultArtifactIds: ['artifact-created'],
      }),
    }))
  })

  it('blocks execution when persisted approval evidence is missing and ignores caller supplied approval fields', async () => {
    mockGetDoc.mockResolvedValue({ exists: true, id: 'job-1', data: () => ({ orgId: 'org-1', status: 'queued', operation: 'create_doc', approvalRequired: true, approvalSatisfied: false, input: { title: 'Client doc', visibility: 'admin_agents_clients' }, output: { googleMutationPerformed: false } }) })
    const { PATCH } = await import('@/app/api/v1/workspace-broker/jobs/[id]/route')
    const res = await PATCH(new NextRequest('http://localhost/api/v1/workspace-broker/jobs/job-1?orgId=org-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'execute', approvalStatus: 'approved', approvalGateTaskId: 'task-approval-1' }),
    }), { params: Promise.resolve({ id: 'job-1' }) })

    expect(res.status).toBe(403)
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

