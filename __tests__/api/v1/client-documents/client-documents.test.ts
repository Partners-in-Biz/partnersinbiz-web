import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockBatchSet = jest.fn()
const mockBatchCommit = jest.fn()
const mockTransactionGet = jest.fn()
const mockTransactionUpdate = jest.fn()
const mockTransactionSet = jest.fn()
const mockDocGet = jest.fn()
const mockDocUpdate = jest.fn()
const mockWhere = jest.fn()
const mockQueryGet = jest.fn()
const mockVersionDoc = jest.fn()
const mockVersionUpdate = jest.fn()
const mockVersionSet = jest.fn()
const mockVersionsGet = jest.fn()

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'server-timestamp'),
  },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
    batch: jest.fn(() => ({
      set: mockBatchSet,
      commit: mockBatchCommit,
    })),
    runTransaction: jest.fn((handler) =>
      handler({
        get: mockTransactionGet,
        update: mockTransactionUpdate,
        set: mockTransactionSet,
      }),
    ),
  },
}))

jest.mock('@/lib/api/auth', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withAuth: (requiredRole: 'admin' | 'client', handler: any) => async (req: NextRequest, user: any, ctx?: any) => {
    const roleOk =
      user?.role === 'ai' || user?.role === 'admin' || (requiredRole === 'client' && user?.role === 'client')

    if (!roleOk) {
      return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return handler(req, user, ctx)
  },
}))

const user = { uid: 'ai-agent', role: 'ai' as const }
const adminUser = { uid: 'admin-1', role: 'admin' as const }
const clientUser = { uid: 'client-1', role: 'client' as const, orgId: 'org-1' }

function jsonRequest(url: string, body: unknown, method = 'POST') {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeDocumentRef(id = 'doc-1') {
  const versionRef = {
    id: 'version-1',
    update: mockVersionUpdate,
    set: mockVersionSet,
  }
  const versions = {
    doc: mockVersionDoc.mockReturnValue(versionRef),
    get: mockVersionsGet,
  }

  return {
    id,
    get: mockDocGet,
    update: mockDocUpdate,
    collection: jest.fn(() => versions),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockBatchCommit.mockResolvedValue(undefined)
  mockDocUpdate.mockResolvedValue(undefined)
  mockTransactionUpdate.mockReturnValue(undefined)
  mockTransactionSet.mockReturnValue(undefined)
  mockVersionSet.mockResolvedValue(undefined)
  mockVersionsGet.mockResolvedValue({ docs: [] })
  mockTransactionGet.mockReset()
  mockDocGet.mockReset()

  const documentRef = makeDocumentRef()
  const query = {
    where: mockWhere,
    get: mockQueryGet,
  }

  mockWhere.mockReturnValue(query)
  mockQueryGet.mockResolvedValue({ docs: [] })
  mockCollection.mockReturnValue({
    doc: jest.fn(() => documentRef),
    where: mockWhere,
  })
})

describe('client documents API', () => {
  it('creates a client document', async () => {
    const { POST } = await import('@/app/api/v1/client-documents/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents', {
      orgId: 'org-1',
      title: 'Proposal',
      type: 'sales_proposal',
      linked: { dealId: 'deal-1' },
    })

    const res = await POST(req, adminUser)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data).toMatchObject({
      id: 'doc-1',
      versionId: 'version-1',
      orgId: 'org-1',
      status: 'internal_draft',
    })
    expect(mockBatchSet).toHaveBeenCalledTimes(2)
    expect(mockBatchCommit).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid document type on create', async () => {
    const { POST } = await import('@/app/api/v1/client-documents/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents', {
      orgId: 'org-1',
      title: 'Proposal',
      type: 'unsupported',
    })

    const res = await POST(req, user)

    expect(res.status).toBe(400)
    expect(mockBatchSet).not.toHaveBeenCalled()
  })

  it('rejects invalid linked create payloads', async () => {
    const { POST } = await import('@/app/api/v1/client-documents/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents', {
      orgId: 'org-1',
      title: 'Proposal',
      type: 'sales_proposal',
      linked: { dealId: 'deal-1', unknownId: 'x' },
    })

    const res = await POST(req, user)

    expect(res.status).toBe(400)
    expect(mockBatchSet).not.toHaveBeenCalled()
  })

  it('rejects invalid assumption severity on create', async () => {
    const { POST } = await import('@/app/api/v1/client-documents/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents', {
      orgId: 'org-1',
      title: 'Proposal',
      type: 'sales_proposal',
      assumptions: [{ text: 'Needs clarity', severity: 'urgent' }],
    })

    const res = await POST(req, user)

    expect(res.status).toBe(400)
    expect(mockBatchSet).not.toHaveBeenCalled()
  })

  it('rejects non-object assumption rows on create', async () => {
    const { POST } = await import('@/app/api/v1/client-documents/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents', {
      orgId: 'org-1',
      title: 'Proposal',
      type: 'sales_proposal',
      assumptions: ['Needs clarity'],
    })

    const res = await POST(req, user)

    expect(res.status).toBe(400)
    expect(mockBatchSet).not.toHaveBeenCalled()
  })

  it('rejects client-supplied assumption lifecycle fields on create', async () => {
    const { POST } = await import('@/app/api/v1/client-documents/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents', {
      orgId: 'org-1',
      title: 'Proposal',
      type: 'sales_proposal',
      assumptions: [{ id: 'assumption-1', text: 'Needs clarity', status: 'open', createdBy: 'client-1' }],
    })

    const res = await POST(req, user)

    expect(res.status).toBe(400)
    expect(mockBatchSet).not.toHaveBeenCalled()
  })

  it('blocks clients from creating documents', async () => {
    const { POST } = await import('@/app/api/v1/client-documents/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents', {
      orgId: 'org-1',
      title: 'Proposal',
      type: 'sales_proposal',
    })

    const res = await POST(req, clientUser)

    expect(res.status).toBe(403)
    expect(mockBatchSet).not.toHaveBeenCalled()
  })

  it('allows internal drafts without orgId for internal actors', async () => {
    const { POST } = await import('@/app/api/v1/client-documents/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents', {
      title: 'Internal build draft',
      type: 'build_spec',
    })

    const res = await POST(req, user)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data).toMatchObject({ id: 'doc-1', versionId: 'version-1' })
    expect(body.data.orgId).toBeUndefined()
  })

  it('lists org-scoped documents with optional filters and excludes deleted documents', async () => {
    mockQueryGet.mockResolvedValueOnce({
      docs: [
        { id: 'doc-1', data: () => ({ orgId: 'org-1', title: 'Proposal', deleted: false }) },
        { id: 'doc-2', data: () => ({ orgId: 'org-1', title: 'Deleted', deleted: true }) },
      ],
    })

    const { GET } = await import('@/app/api/v1/client-documents/route')
    const req = new NextRequest(
      'http://localhost/api/v1/client-documents?orgId=org-1&status=client_review&type=sales_proposal',
    )

    const res = await GET(req, user)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
    expect(mockWhere).toHaveBeenCalledWith('status', '==', 'client_review')
    expect(mockWhere).toHaveBeenCalledWith('type', '==', 'sales_proposal')
    expect(body.data).toEqual([{ id: 'doc-1', orgId: 'org-1', title: 'Proposal', deleted: false }])
  })

  it('returns a scoped document when the actor has access', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({ orgId: 'org-1', title: 'Proposal', deleted: false }),
    })

    const { GET } = await import('@/app/api/v1/client-documents/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1')
    const res = await GET(req, clientUser, { params: Promise.resolve({ id: 'doc-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toMatchObject({ id: 'doc-1', orgId: 'org-1', title: 'Proposal' })
  })

  it('blocks clients from standalone internal documents', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({ title: 'Internal draft', deleted: false }),
    })

    const { GET } = await import('@/app/api/v1/client-documents/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1')
    const res = await GET(req, clientUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(403)
  })

  it('patches only allowed fields and records actor fields', async () => {
    mockTransactionGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({ orgId: 'org-1', title: 'Old', deleted: false }),
    })

    const { PATCH } = await import('@/app/api/v1/client-documents/[id]/route')
    const req = jsonRequest(
      'http://localhost/api/v1/client-documents/doc-1',
      { title: 'New title', shareEnabled: true },
      'PATCH',
    )

    const res = await PATCH(req, user, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(200)
    expect(mockTransactionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'doc-1' }),
      expect.objectContaining({
        title: 'New title',
        shareEnabled: true,
        updatedBy: 'ai-agent',
        updatedByType: 'agent',
      }),
    )
  })

  it('rejects unsupported patch fields', async () => {
    mockTransactionGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({ orgId: 'org-1', title: 'Old', deleted: false }),
    })

    const { PATCH } = await import('@/app/api/v1/client-documents/[id]/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents/doc-1', { status: 'approved' }, 'PATCH')
    const res = await PATCH(req, user, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(400)
    expect(mockTransactionUpdate).not.toHaveBeenCalled()
  })

  it('rejects invalid linked patch payloads', async () => {
    const { PATCH } = await import('@/app/api/v1/client-documents/[id]/route')
    const req = jsonRequest(
      'http://localhost/api/v1/client-documents/doc-1',
      { linked: { dealId: 'deal-1', unknownId: 'x' } },
      'PATCH',
    )
    const res = await PATCH(req, user, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(400)
    expect(mockTransactionGet).not.toHaveBeenCalled()
    expect(mockTransactionUpdate).not.toHaveBeenCalled()
  })

  it('rejects invalid assumption severity and status patch payloads', async () => {
    const { PATCH } = await import('@/app/api/v1/client-documents/[id]/route')
    const invalidSeverity = jsonRequest(
      'http://localhost/api/v1/client-documents/doc-1',
      {
        assumptions: [
          {
            id: 'assumption-1',
            text: 'Needs clarity',
            severity: 'urgent',
            status: 'open',
            createdBy: 'ai-agent',
          },
        ],
      },
      'PATCH',
    )
    const severityRes = await PATCH(invalidSeverity, user, { params: Promise.resolve({ id: 'doc-1' }) })

    const invalidStatus = jsonRequest(
      'http://localhost/api/v1/client-documents/doc-1',
      {
        assumptions: [
          {
            id: 'assumption-1',
            text: 'Needs clarity',
            severity: 'needs_review',
            status: 'done',
            createdBy: 'ai-agent',
          },
        ],
      },
      'PATCH',
    )
    const statusRes = await PATCH(invalidStatus, user, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(severityRes.status).toBe(400)
    expect(statusRes.status).toBe(400)
    expect(mockTransactionGet).not.toHaveBeenCalled()
    expect(mockTransactionUpdate).not.toHaveBeenCalled()
  })

  it('blocks clients from patching documents', async () => {
    const { PATCH } = await import('@/app/api/v1/client-documents/[id]/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents/doc-1', { title: 'Client edit' }, 'PATCH')
    const res = await PATCH(req, clientUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(403)
    expect(mockTransactionGet).not.toHaveBeenCalled()
    expect(mockTransactionUpdate).not.toHaveBeenCalled()
  })

  it('publishes documents with orgId and no blocking assumptions', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'org-1',
        currentVersionId: 'version-1',
        assumptions: [],
        deleted: false,
      }),
    })
    mockTransactionGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        orgId: 'org-1',
        currentVersionId: 'version-1',
        assumptions: [],
        deleted: false,
      }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/publish/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1/publish', { method: 'POST' })
    const res = await POST(req, user, { params: Promise.resolve({ id: 'doc-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({ id: 'doc-1', versionId: 'version-1' })
    expect(mockTransactionUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: 'client_review',
        latestPublishedVersionId: 'version-1',
        shareEnabled: true,
        updatedBy: 'ai-agent',
        updatedByType: 'agent',
      }),
    )
    expect(mockTransactionUpdate).toHaveBeenCalledWith(expect.anything(), { status: 'published' })
  })

  it('blocks clients from publishing documents before transaction update', async () => {
    const { POST } = await import('@/app/api/v1/client-documents/[id]/publish/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-2/publish', { method: 'POST' })
    const res = await POST(req, clientUser, { params: Promise.resolve({ id: 'doc-2' }) })

    expect(res.status).toBe(403)
    expect(mockTransactionGet).not.toHaveBeenCalled()
    expect(mockTransactionUpdate).not.toHaveBeenCalled()
  })

  it('returns 400 when publish transaction sees a different org than the route checked', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        currentVersionId: 'version-1',
        assumptions: [],
        deleted: false,
      }),
    })
    mockTransactionGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        orgId: 'org-2',
        currentVersionId: 'version-1',
        assumptions: [],
        deleted: false,
      }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/publish/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1/publish', { method: 'POST' })
    const res = await POST(req, user, { params: Promise.resolve({ id: 'doc-1' }) })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('Document organisation changed before publishing')
    expect(mockTransactionUpdate).not.toHaveBeenCalled()
  })

  it('returns 400 for publish validation errors', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        currentVersionId: 'version-1',
        assumptions: [],
        deleted: false,
      }),
    })
    mockTransactionGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        currentVersionId: 'version-1',
        assumptions: [],
        deleted: false,
      }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/publish/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1/publish', { method: 'POST' })
    const res = await POST(req, user, { params: Promise.resolve({ id: 'doc-1' }) })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('orgId is required before publishing')
  })

  it('archives an accessible document', async () => {
    mockTransactionGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({ orgId: 'org-1', title: 'Proposal', deleted: false }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/archive/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1/archive', { method: 'POST' })
    const res = await POST(req, user, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(200)
    expect(mockTransactionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'doc-1' }),
      expect.objectContaining({
        status: 'archived',
        deleted: true,
        updatedBy: 'ai-agent',
        updatedByType: 'agent',
      }),
    )
  })

  it('deletes an accessible document through the canonical document route', async () => {
    mockTransactionGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({ orgId: 'org-1', title: 'Proposal', deleted: false }),
    })

    const { DELETE } = await import('@/app/api/v1/client-documents/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1', { method: 'DELETE' })
    const res = await DELETE(req, adminUser, { params: Promise.resolve({ id: 'doc-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({ id: 'doc-1', status: 'archived' })
    expect(mockTransactionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'doc-1' }),
      expect.objectContaining({
        status: 'archived',
        deleted: true,
        updatedBy: 'admin-1',
        updatedByType: 'user',
      }),
    )
  })

  it('blocks clients from archiving documents', async () => {
    const { POST } = await import('@/app/api/v1/client-documents/[id]/archive/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1/archive', { method: 'POST' })
    const res = await POST(req, clientUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(403)
    expect(mockTransactionGet).not.toHaveBeenCalled()
    expect(mockTransactionUpdate).not.toHaveBeenCalled()
  })

  it('lists document versions for an accessible document', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({ orgId: 'org-1', title: 'Proposal', deleted: false }),
    })
    mockVersionsGet.mockResolvedValueOnce({
      docs: [{ id: 'version-1', data: () => ({ versionNumber: 1, status: 'draft' }) }],
    })

    const { GET } = await import('@/app/api/v1/client-documents/[id]/versions/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1/versions')
    const res = await GET(req, clientUser, { params: Promise.resolve({ id: 'doc-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual([{ id: 'version-1', versionNumber: 1, status: 'draft', blocks: [] }])
  })

  it('blocks clients from listing standalone internal document versions', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({ title: 'Internal draft', deleted: false }),
    })

    const { GET } = await import('@/app/api/v1/client-documents/[id]/versions/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1/versions')
    const res = await GET(req, clientUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(403)
    expect(mockVersionsGet).not.toHaveBeenCalled()
  })

  it('creates a draft version and points the document head at it', async () => {
    mockTransactionGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({ orgId: 'org-1', title: 'Proposal', deleted: false }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/versions/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents/doc-1/versions', {
      blocks: [
        {
          id: 'summary',
          type: 'summary',
          title: 'Summary',
          content: { body: 'Updated scope' },
          required: true,
          display: { motion: 'reveal' },
        },
      ],
      versionNumber: 2,
      theme: {
        palette: { bg: '#0A0A0B', text: '#F7F4EE', accent: '#F5A623' },
        typography: { heading: 'Instrument Serif', body: 'Geist' },
      },
      changeSummary: 'Updated scope',
    })

    const res = await POST(req, user, { params: Promise.resolve({ id: 'doc-1' }) })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data).toEqual({ id: 'version-1' })
    expect(mockTransactionSet).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'version-1' }),
      expect.objectContaining({
        documentId: 'doc-1',
        versionNumber: 2,
        status: 'draft',
        createdBy: 'ai-agent',
        createdByType: 'agent',
        changeSummary: 'Updated scope',
      }),
    )
    expect(mockTransactionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'doc-1' }),
      expect.objectContaining({
        currentVersionId: 'version-1',
        updatedBy: 'ai-agent',
        updatedByType: 'agent',
      }),
    )
  })

  it('creates a draft version with showcase blocks from the internal helper payload', async () => {
    mockTransactionGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({ orgId: 'org-1', title: 'Internal showcase', deleted: false }),
    })

    const { createInternalShowcaseVersionPayload } = await import('@/lib/client-documents/showcasePayloads')
    const { POST } = await import('@/app/api/v1/client-documents/[id]/versions/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents/doc-1/versions', createInternalShowcaseVersionPayload())

    const res = await POST(req, user, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(201)
    expect(mockTransactionSet).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'version-1' }),
      expect.objectContaining({
        blocks: expect.arrayContaining([
          expect.objectContaining({ type: 'funnel' }),
          expect.objectContaining({ type: 'weighted_decision_matrix' }),
        ]),
        changeSummary: 'Internal showcase example for advanced document blocks',
      }),
    )
  })

  it('blocks clients from creating document versions', async () => {
    const { POST } = await import('@/app/api/v1/client-documents/[id]/versions/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents/doc-1/versions', { blocks: [] })
    const res = await POST(req, clientUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(403)
    expect(mockTransactionGet).not.toHaveBeenCalled()
    expect(mockTransactionSet).not.toHaveBeenCalled()
  })

  it('rejects invalid draft version blocks before transaction writes', async () => {
    const { POST } = await import('@/app/api/v1/client-documents/[id]/versions/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents/doc-1/versions', {
      blocks: [{ id: 'bad', type: 'not_real', content: {}, required: true, display: {} }],
    })

    const res = await POST(req, user, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(400)
    expect(mockTransactionGet).not.toHaveBeenCalled()
    expect(mockTransactionSet).not.toHaveBeenCalled()
  })

  it('fetches one document version for an accessible document', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({ orgId: 'org-1', title: 'Proposal', deleted: false }),
    })
    mockVersionSet.mockResolvedValue(undefined)
    mockVersionDoc.mockReturnValueOnce({
      id: 'version-1',
      get: jest.fn().mockResolvedValue({
        exists: true,
        id: 'version-1',
        data: () => ({ versionNumber: 1, status: 'draft' }),
      }),
    })

    const { GET } = await import('@/app/api/v1/client-documents/[id]/versions/[versionId]/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1/versions/version-1')
    const res = await GET(req, clientUser, { params: Promise.resolve({ id: 'doc-1', versionId: 'version-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({ id: 'version-1', versionNumber: 1, status: 'draft', blocks: [] })
  })
})

export {}
