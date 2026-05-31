import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockDocumentGet = jest.fn()
const mockApprovalDoc = jest.fn()
const mockBatchSet = jest.fn()
const mockBatchUpdate = jest.fn()
const mockBatchCommit = jest.fn()
const mockGenerateApprovedDocumentProjectTasks = jest.fn()

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
      update: mockBatchUpdate,
      commit: mockBatchCommit,
    })),
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

jest.mock('@/lib/client-documents/taskGeneration', () => ({
  generateApprovedDocumentProjectTasks: mockGenerateApprovedDocumentProjectTasks,
}))

const clientUser = { uid: 'client-1', role: 'client' as const, orgId: 'org-1' }
const aiUser = { uid: 'ai-agent', role: 'ai' as const }

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockDocumentGet.mockReset()
  mockBatchCommit.mockResolvedValue(undefined)
  mockGenerateApprovedDocumentProjectTasks.mockResolvedValue({ ok: true, projectId: 'project-1', tasks: [], createdTaskIds: [] })

  const approvalRef = { id: 'approval-1' }
  const approvalsCollection = {
    doc: mockApprovalDoc.mockReturnValue(approvalRef),
  }
  const documentRef = {
    id: 'doc-1',
    get: mockDocumentGet,
    collection: jest.fn(() => approvalsCollection),
  }

  mockCollection.mockReturnValue({ doc: jest.fn(() => documentRef) })
})

describe('client document approvals API', () => {
  it('records operational approval against the latest published version', async () => {
    mockDocumentGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'org-1',
        approvalMode: 'operational',
        latestPublishedVersionId: 'version-1',
        deleted: false,
      }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/approve/route')
    const req = jsonRequest(
      'http://localhost/api/v1/client-documents/doc-1/approve',
      { actorName: 'Client Owner', companyName: 'Client Co' },
      { 'user-agent': 'jest', 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
    )

    const res = await POST(req, clientUser, { params: Promise.resolve({ id: 'doc-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({ id: 'approval-1', versionId: 'version-1' })
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'approval-1' }),
      expect.objectContaining({
        documentId: 'doc-1',
        versionId: 'version-1',
        mode: 'operational',
        actorId: 'client-1',
        actorName: 'Client Owner',
        actorRole: 'client',
        companyName: 'Client Co',
        ip: '203.0.113.7',
        userAgent: 'jest',
      }),
    )
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'doc-1' }),
      expect.objectContaining({ status: 'approved', updatedBy: 'client-1', updatedByType: 'user' }),
    )
    expect(mockBatchCommit).toHaveBeenCalledTimes(1)
  })

  it('requires operational approval mode for approve route', async () => {
    mockDocumentGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'org-1',
        approvalMode: 'formal_acceptance',
        latestPublishedVersionId: 'version-1',
        deleted: false,
      }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/approve/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents/doc-1/approve', {})
    const res = await POST(req, clientUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(400)
    expect(mockBatchSet).not.toHaveBeenCalled()
  })

  it('requires a published version before approval', async () => {
    mockDocumentGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'org-1',
        approvalMode: 'operational',
        deleted: false,
      }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/approve/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents/doc-1/approve', {})
    const res = await POST(req, clientUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(400)
    expect(mockBatchSet).not.toHaveBeenCalled()
  })

  it('requires typed name for formal acceptance', async () => {
    mockDocumentGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'org-1',
        approvalMode: 'formal_acceptance',
        latestPublishedVersionId: 'version-1',
        deleted: false,
      }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/accept/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents/doc-1/accept', {
      checkboxText: 'I accept this proposal.',
    })
    const res = await POST(req, clientUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(400)
    expect(mockBatchSet).not.toHaveBeenCalled()
  })

  it('records formal acceptance with typed name and snapshots', async () => {
    mockDocumentGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'org-1',
        approvalMode: 'formal_acceptance',
        latestPublishedVersionId: 'version-1',
        deleted: false,
      }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/accept/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents/doc-1/accept', {
      actorName: 'Client Owner',
      companyName: 'Client Co',
      typedName: 'Client Owner',
      checkboxText: 'I accept this proposal.',
      termsSnapshot: { revision: 'terms-v1' },
      investmentSnapshot: { total: 12000 },
    })

    const res = await POST(req, clientUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(200)
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'approval-1' }),
      expect.objectContaining({
        documentId: 'doc-1',
        versionId: 'version-1',
        mode: 'formal_acceptance',
        actorId: 'client-1',
        actorName: 'Client Owner',
        typedName: 'Client Owner',
        checkboxText: 'I accept this proposal.',
        termsSnapshot: { revision: 'terms-v1' },
        investmentSnapshot: { total: 12000 },
      }),
    )
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'doc-1' }),
      expect.objectContaining({
        status: 'accepted',
        updatedBy: 'client-1',
        updatedByType: 'user',
        clientAcceptance: expect.objectContaining({
          versionId: 'version-1',
          actorId: 'client-1',
          actorName: 'Client Owner',
          typedName: 'Client Owner',
          checkboxText: 'I accept this proposal.',
        }),
      }),
    )
  })

  it('lets an admin countersign a formal agreement for Partners in Biz', async () => {
    const adminUser = { uid: 'admin-1', role: 'admin' as const, orgId: 'org-1' }
    mockDocumentGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'org-1',
        approvalMode: 'formal_acceptance',
        latestPublishedVersionId: 'version-1',
        deleted: false,
      }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/sign/route')
    const req = jsonRequest(
      'http://localhost/api/v1/client-documents/doc-1/sign',
      {
        name: 'Peet Stander',
        capacity: 'Founder',
        companyName: 'The Partners in Business',
        signatureText: 'Peet Stander',
      },
      { 'user-agent': 'jest', 'x-forwarded-for': '203.0.113.8' },
    )

    const res = await POST(req, adminUser, { params: Promise.resolve({ id: 'doc-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({ id: 'approval-1', versionId: 'version-1' })
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'approval-1' }),
      expect.objectContaining({
        documentId: 'doc-1',
        versionId: 'version-1',
        mode: 'formal_acceptance',
        signatureSide: 'provider',
        actorId: 'admin-1',
        actorName: 'Peet Stander',
        actorRole: 'admin',
        typedName: 'Peet Stander',
        companyName: 'The Partners in Business',
        capacity: 'Founder',
        ip: '203.0.113.8',
        userAgent: 'jest',
      }),
    )
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'doc-1' }),
      expect.objectContaining({
        providerSignature: expect.objectContaining({
          versionId: 'version-1',
          name: 'Peet Stander',
          capacity: 'Founder',
          companyName: 'The Partners in Business',
          signatureText: 'Peet Stander',
          signedBy: 'admin-1',
          signedByType: 'user',
        }),
        updatedBy: 'admin-1',
        updatedByType: 'user',
      }),
    )
  })

  it('allows an agent to record internal operational approval as an agent actor', async () => {
    mockDocumentGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'org-1',
        approvalMode: 'operational',
        latestPublishedVersionId: 'version-1',
        deleted: false,
      }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/approve/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents/doc-1/approve', { actorName: 'Pip' })
    const res = await POST(req, aiUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(200)
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorRole: 'ai', actorId: 'ai-agent' }),
    )
    expect(mockBatchUpdate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ updatedByType: 'agent' }))
  })

  it('can generate linked project tasks from an approved internal system document task plan', async () => {
    mockDocumentGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        id: 'doc-1',
        orgId: 'org-1',
        title: 'Internal System Spec',
        approvalMode: 'operational',
        latestPublishedVersionId: 'version-1',
        linked: { projectId: 'project-1' },
        deleted: false,
      }),
    })
    mockGenerateApprovedDocumentProjectTasks.mockResolvedValueOnce({
      ok: true,
      projectId: 'project-1',
      tasks: [],
      createdTaskIds: ['task-1', 'task-2'],
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/approve/route')
    const plan = {
      tasks: [
        { key: 'backend', sectionId: 'backend', title: 'Build backend', assigneeAgentId: 'theo' },
        { key: 'qa', sectionId: 'qa', title: 'QA flow', assigneeAgentId: 'pip', dependsOn: ['backend'] },
      ],
    }
    const req = jsonRequest('http://localhost/api/v1/client-documents/doc-1/approve', {
      actorName: 'Pip',
      generateProjectTasks: plan,
    })
    const res = await POST(req, aiUser, { params: Promise.resolve({ id: 'doc-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({
      id: 'approval-1',
      versionId: 'version-1',
      generatedProjectTasks: { projectId: 'project-1', taskIds: ['task-1', 'task-2'] },
    })
    expect(mockGenerateApprovedDocumentProjectTasks).toHaveBeenCalledWith({
      document: expect.objectContaining({ id: 'doc-1', linked: { projectId: 'project-1' } }),
      approvalId: 'approval-1',
      actorId: 'ai-agent',
      plan,
    })
  })
})

export {}
