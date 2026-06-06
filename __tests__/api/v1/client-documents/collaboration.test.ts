import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockDocumentGet = jest.fn()
const mockChildGet = jest.fn()
const mockChildSet = jest.fn()
const mockChildUpdate = jest.fn()
const mockChildDoc = jest.fn()
const mockDocumentUpdate = jest.fn()
const mockArrayUnion = jest.fn((...values: unknown[]) => ({ __arrayUnion: values }))
const mockResolveContextReferences = jest.fn()

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    arrayUnion: (...values: unknown[]) => mockArrayUnion(...values),
    serverTimestamp: jest.fn(() => 'server-timestamp'),
  },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
  },
}))

jest.mock('@/lib/api/auth', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withAuth: (requiredRole: 'admin' | 'client' | Array<'admin' | 'client'>, handler: any) => async (req: NextRequest, user: any, ctx?: any) => {
    const requiredRoles = Array.isArray(requiredRole) ? requiredRole : [requiredRole]
    const roleOk =
      user?.role === 'ai' || user?.role === 'admin' || (requiredRoles.includes('client') && user?.role === 'client')

    if (!roleOk) {
      return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return handler(req, user, ctx)
  },
}))

jest.mock('@/lib/context-references/registry', () => ({
  resolveContextReferences: (...args: unknown[]) => mockResolveContextReferences(...args),
}))

const aiUser = { uid: 'ai-agent', role: 'ai' as const }
const adminUser = { uid: 'admin-1', role: 'admin' as const }
const clientUser = { uid: 'client-1', role: 'client' as const, orgId: 'org-1' }

function jsonRequest(url: string, body: unknown, method = 'POST') {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockDocumentGet.mockReset()
  mockChildGet.mockReset()
  mockChildSet.mockResolvedValue(undefined)
  mockChildUpdate.mockResolvedValue(undefined)
  mockDocumentUpdate.mockResolvedValue(undefined)
  mockArrayUnion.mockClear()
  mockResolveContextReferences.mockReset()
  mockResolveContextReferences.mockResolvedValue([])

  const childRef = {
    id: 'child-1',
    get: mockChildGet,
    set: mockChildSet,
    update: mockChildUpdate,
  }
  const childCollection = {
    doc: mockChildDoc.mockReturnValue(childRef),
    get: mockChildGet,
  }
  const documentRef = {
    id: 'doc-1',
    get: mockDocumentGet,
    update: mockDocumentUpdate,
    collection: jest.fn(() => childCollection),
  }

  mockCollection.mockReturnValue({ doc: jest.fn(() => documentRef) })
})

describe('client document collaboration API', () => {
  it('creates an anchored comment on the current version', async () => {
    mockDocumentGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({ orgId: 'org-1', currentVersionId: 'version-1', deleted: false, status: 'client_review', linked: { clientOrgId: 'org-1' } }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/comments/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents/doc-1/comments', {
      text: 'Please soften this.',
      blockId: 'summary',
      userName: 'Client One',
      anchor: { type: 'text', text: 'This is too hard sell', offset: 4 },
    })

    const res = await POST(req, clientUser, { params: Promise.resolve({ id: 'doc-1' }) })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data).toEqual({ id: 'child-1' })
    expect(mockChildSet).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        versionId: 'version-1',
        blockId: 'summary',
        text: 'Please soften this.',
        userId: 'client-1',
        userName: 'Client One',
        userRole: 'client',
        status: 'open',
        agentPickedUp: false,
      }),
    )
  })

  it('stores resolved context refs on document comments', async () => {
    const resolvedRefs = [
      {
        type: 'document',
        id: 'doc-1',
        orgId: 'org-1',
        label: 'Client Proposal',
        origin: 'current_page',
      },
      {
        type: 'project',
        id: 'project-1',
        orgId: 'org-1',
        label: 'Launch Project',
        origin: 'mention',
      },
    ]
    mockResolveContextReferences.mockResolvedValueOnce(resolvedRefs)
    mockDocumentGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'org-1',
        currentVersionId: 'version-1',
        deleted: false,
        title: 'Client Proposal',
        type: 'sales_proposal',
        status: 'client_review',
        linked: { clientOrgId: 'org-1' },
      }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/comments/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents/doc-1/comments', {
      text: 'Please align this with the launch work.',
      contextRefs: [{ type: 'projects', id: 'project-1', orgId: 'org-1', origin: 'mention' }],
    })

    const res = await POST(req, clientUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(201)
    expect(mockResolveContextReferences).toHaveBeenCalledWith(
      [
        expect.objectContaining({ type: 'document', id: 'doc-1', orgId: 'org-1', origin: 'current_page' }),
        expect.objectContaining({ type: 'project', id: 'project-1', orgId: 'org-1', origin: 'mention' }),
      ],
      clientUser,
      'org-1',
    )
    expect(mockChildSet).toHaveBeenCalledWith(
      expect.objectContaining({
        contextRefs: resolvedRefs,
      }),
    )
  })

  it('promotes selected CRM contact and company refs into document-level links without creating mention notifications', async () => {
    const resolvedRefs = [
      {
        type: 'document',
        id: 'doc-1',
        orgId: 'org-1',
        label: 'Client Proposal',
        origin: 'current_page',
      },
      {
        type: 'contact',
        id: 'contact-1',
        orgId: 'org-1',
        label: 'Jane Client',
        origin: 'mention',
      },
      {
        type: 'company',
        id: 'company-1',
        orgId: 'org-1',
        label: 'Client Co',
        origin: 'mention',
      },
      {
        type: 'project',
        id: 'project-1',
        orgId: 'org-1',
        label: 'Launch Project',
        origin: 'mention',
      },
    ]
    mockResolveContextReferences.mockResolvedValueOnce(resolvedRefs)
    mockDocumentGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'org-1',
        currentVersionId: 'version-1',
        deleted: false,
        title: 'Client Proposal',
        type: 'sales_proposal',
        status: 'client_review',
        linked: { clientOrgId: 'org-1' },
      }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/comments/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents/doc-1/comments', {
      text: 'Tie this feedback back to Jane and Client Co.',
      alsoLinkToDocument: true,
      contextRefs: [
        { type: 'contacts', id: 'contact-1', orgId: 'org-1', origin: 'mention' },
        { type: 'companies', id: 'company-1', orgId: 'org-1', origin: 'mention' },
        { type: 'projects', id: 'project-1', orgId: 'org-1', origin: 'mention' },
      ],
    })

    const res = await POST(req, clientUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(201)
    expect(mockDocumentUpdate).toHaveBeenCalledWith(expect.objectContaining({
      'linked.contactIds': { __arrayUnion: ['contact-1'] },
      'linked.companyIds': { __arrayUnion: ['company-1'] },
    }))
    expect(mockDocumentUpdate).not.toHaveBeenCalledWith(expect.objectContaining({
      'linked.projectIds': expect.anything(),
    }))
    expect(mockChildSet).toHaveBeenCalledWith(expect.objectContaining({ contextRefs: resolvedRefs }))
  })


  it('lists comments for an accessible document', async () => {
    mockDocumentGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({ orgId: 'org-1', currentVersionId: 'version-1', deleted: false, status: 'client_review', linked: { clientOrgId: 'org-1' } }),
    })
    mockChildGet.mockResolvedValueOnce({
      docs: [{ id: 'comment-1', data: () => ({ text: 'Looks good', status: 'open' }) }],
    })

    const { GET } = await import('@/app/api/v1/client-documents/[id]/comments/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1/comments')
    const res = await GET(req, clientUser, { params: Promise.resolve({ id: 'doc-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual([{ id: 'comment-1', text: 'Looks good', status: 'open' }])
  })

  it('rejects invalid comment anchors', async () => {
    mockDocumentGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({ orgId: 'org-1', currentVersionId: 'version-1', deleted: false, status: 'client_review', linked: { clientOrgId: 'org-1' } }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/comments/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents/doc-1/comments', {
      text: 'Please check',
      anchor: { type: 'text' },
    })

    const res = await POST(req, clientUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(400)
    expect(mockChildSet).not.toHaveBeenCalled()
  })

  it('stores resolved context refs on document comment replies', async () => {
    const resolvedRefs = [
      {
        type: 'document',
        id: 'doc-1',
        orgId: 'org-1',
        label: 'Client Proposal',
        origin: 'current_page',
      },
      {
        type: 'contact',
        id: 'contact-1',
        orgId: 'org-1',
        label: 'Jane Client',
        origin: 'mention',
      },
    ]
    mockResolveContextReferences.mockResolvedValueOnce(resolvedRefs)
    mockDocumentGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'org-1',
        currentVersionId: 'version-1',
        deleted: false,
        title: 'Client Proposal',
        type: 'sales_proposal',
        status: 'client_review',
        linked: { clientOrgId: 'org-1' },
      }),
    })
    mockChildGet.mockResolvedValueOnce({
      exists: true,
      id: 'comment-1',
      data: () => ({ status: 'open', text: 'Needs context.' }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/comments/[commentId]/replies/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents/doc-1/comments/comment-1/replies', {
      text: 'Jane has the latest requirements.',
      contextRefs: [{ type: 'contacts', id: 'contact-1', orgId: 'org-1', origin: 'mention' }],
    })

    const res = await POST(req, clientUser, { params: Promise.resolve({ id: 'doc-1', commentId: 'comment-1' }) })

    expect(res.status).toBe(201)
    expect(mockResolveContextReferences).toHaveBeenCalledWith(
      [
        expect.objectContaining({ type: 'document', id: 'doc-1', orgId: 'org-1', origin: 'current_page' }),
        expect.objectContaining({ type: 'contact', id: 'contact-1', orgId: 'org-1', origin: 'mention' }),
      ],
      clientUser,
      'org-1',
    )
    expect(mockChildUpdate).toHaveBeenCalledWith({
      replies: {
        __arrayUnion: [
          expect.objectContaining({
            text: 'Jane has the latest requirements.',
            contextRefs: resolvedRefs,
          }),
        ],
      },
    })
  })

  it('promotes selected CRM refs from replies into document-level links', async () => {
    const resolvedRefs = [
      {
        type: 'document',
        id: 'doc-1',
        orgId: 'org-1',
        label: 'Client Proposal',
        origin: 'current_page',
      },
      {
        type: 'company',
        id: 'company-1',
        orgId: 'org-1',
        label: 'Client Co',
        origin: 'mention',
      },
    ]
    mockResolveContextReferences.mockResolvedValueOnce(resolvedRefs)
    mockDocumentGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'org-1',
        currentVersionId: 'version-1',
        deleted: false,
        title: 'Client Proposal',
        type: 'sales_proposal',
        status: 'client_review',
        linked: { clientOrgId: 'org-1' },
      }),
    })
    mockChildGet.mockResolvedValueOnce({
      exists: true,
      id: 'comment-1',
      data: () => ({ status: 'open', text: 'Needs context.' }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/comments/[commentId]/replies/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents/doc-1/comments/comment-1/replies', {
      text: 'Client Co is the document-level relationship for this thread.',
      alsoLinkToDocument: true,
      contextRefs: [{ type: 'companies', id: 'company-1', orgId: 'org-1', origin: 'mention' }],
    })

    const res = await POST(req, clientUser, { params: Promise.resolve({ id: 'doc-1', commentId: 'comment-1' }) })

    expect(res.status).toBe(201)
    expect(mockDocumentUpdate).toHaveBeenCalledWith(expect.objectContaining({
      'linked.companyIds': { __arrayUnion: ['company-1'] },
    }))
    expect(mockDocumentUpdate).not.toHaveBeenCalledWith(expect.objectContaining({
      'linked.contactIds': expect.anything(),
    }))
  })


  it('resolves an accessible comment', async () => {
    mockDocumentGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({ orgId: 'org-1', currentVersionId: 'version-1', deleted: false, status: 'client_review', linked: { clientOrgId: 'org-1' } }),
    })
    mockChildGet.mockResolvedValueOnce({
      exists: true,
      id: 'comment-1',
      data: () => ({ status: 'open' }),
    })

    const { PATCH } = await import('@/app/api/v1/client-documents/[id]/comments/[commentId]/route')
    const req = jsonRequest(
      'http://localhost/api/v1/client-documents/doc-1/comments/comment-1',
      { status: 'resolved' },
      'PATCH',
    )
    const res = await PATCH(req, clientUser, { params: Promise.resolve({ id: 'doc-1', commentId: 'comment-1' }) })

    expect(res.status).toBe(200)
    expect(mockChildUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'resolved',
        resolvedBy: 'client-1',
        resolvedAt: 'server-timestamp',
      }),
    )
  })

  it('creates a suggestion on the current version', async () => {
    mockDocumentGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({ orgId: 'org-1', currentVersionId: 'version-1', deleted: false, status: 'client_review', linked: { clientOrgId: 'org-1' } }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/suggestions/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents/doc-1/suggestions', {
      blockId: 'summary',
      kind: 'replace_text',
      original: 'Old line',
      proposed: 'Better line',
    })

    const res = await POST(req, clientUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(201)
    expect(mockChildSet).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        versionId: 'version-1',
        blockId: 'summary',
        kind: 'replace_text',
        original: 'Old line',
        proposed: 'Better line',
        status: 'open',
        createdBy: 'client-1',
      }),
    )
  })

  it('lists suggestions for an accessible document', async () => {
    mockDocumentGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({ orgId: 'org-1', currentVersionId: 'version-1', deleted: false, status: 'client_review', linked: { clientOrgId: 'org-1' } }),
    })
    mockChildGet.mockResolvedValueOnce({
      docs: [{ id: 'suggestion-1', data: () => ({ status: 'open', kind: 'insert_text' }) }],
    })

    const { GET } = await import('@/app/api/v1/client-documents/[id]/suggestions/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1/suggestions')
    const res = await GET(req, clientUser, { params: Promise.resolve({ id: 'doc-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual([{ id: 'suggestion-1', status: 'open', kind: 'insert_text' }])
  })

  it('rejects invalid suggestion kinds', async () => {
    mockDocumentGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({ orgId: 'org-1', currentVersionId: 'version-1', deleted: false, status: 'client_review', linked: { clientOrgId: 'org-1' } }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/suggestions/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents/doc-1/suggestions', {
      blockId: 'summary',
      kind: 'rewrite_everything',
      proposed: 'Better line',
    })

    const res = await POST(req, clientUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(400)
    expect(mockChildSet).not.toHaveBeenCalled()
  })

  it('blocks clients from accepting suggestions', async () => {
    const { POST } = await import('@/app/api/v1/client-documents/[id]/suggestions/[suggestionId]/accept/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1/suggestions/s1/accept', {
      method: 'POST',
    })

    const res = await POST(req, clientUser, { params: Promise.resolve({ id: 'doc-1', suggestionId: 's1' }) })

    expect(res.status).toBe(403)
    expect(mockChildUpdate).not.toHaveBeenCalled()
  })

  it('allows internal users to accept suggestions', async () => {
    mockDocumentGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({ orgId: 'org-1', currentVersionId: 'version-1', deleted: false, status: 'client_review', linked: { clientOrgId: 'org-1' } }),
    })
    mockChildGet.mockResolvedValueOnce({
      exists: true,
      id: 'suggestion-1',
      data: () => ({ status: 'open' }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/suggestions/[suggestionId]/accept/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1/suggestions/suggestion-1/accept', {
      method: 'POST',
    })
    const res = await POST(req, adminUser, { params: Promise.resolve({ id: 'doc-1', suggestionId: 'suggestion-1' }) })

    expect(res.status).toBe(200)
    expect(mockChildUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'accepted',
        resolvedBy: 'admin-1',
        resolvedAt: 'server-timestamp',
      }),
    )
  })

  it('allows agents to reject suggestions', async () => {
    mockDocumentGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({ orgId: 'org-1', currentVersionId: 'version-1', deleted: false, status: 'client_review', linked: { clientOrgId: 'org-1' } }),
    })
    mockChildGet.mockResolvedValueOnce({
      exists: true,
      id: 'suggestion-1',
      data: () => ({ status: 'open' }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/suggestions/[suggestionId]/reject/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1/suggestions/suggestion-1/reject', {
      method: 'POST',
    })
    const res = await POST(req, aiUser, { params: Promise.resolve({ id: 'doc-1', suggestionId: 'suggestion-1' }) })

    expect(res.status).toBe(200)
    expect(mockChildUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'rejected',
        resolvedBy: 'ai-agent',
        resolvedAt: 'server-timestamp',
      }),
    )
  })
})

export {}
