import { NextRequest } from 'next/server'
import { planningDiscoveryDigest } from '@/lib/projects/planningDiscovery'

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
let organizationSettings: Record<string, unknown>
let organizationMembers: Array<Record<string, unknown>>
let orgMemberRoles: Record<string, string>

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
const linkedClientUser = { uid: 'client-2', role: 'client' as const, orgId: 'client-org' }

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
  organizationSettings = {}
  organizationMembers = [
    { userId: 'client-1', role: 'member' },
    { userId: 'client-2', role: 'member' },
  ]
  orgMemberRoles = {}
  mockBatchCommit.mockResolvedValue(undefined)
  mockDocUpdate.mockResolvedValue(undefined)
  mockTransactionUpdate.mockReturnValue(undefined)
  mockTransactionSet.mockReturnValue(undefined)
  mockVersionSet.mockResolvedValue(undefined)
  mockVersionsGet.mockResolvedValue({ docs: [] })
  mockTransactionGet.mockReset()
  mockDocGet.mockReset()
  mockQueryGet.mockReset()
  mockWhere.mockReset()

  const documentRef = makeDocumentRef()
  const query = {
    where: mockWhere,
    limit: jest.fn(() => query),
    get: mockQueryGet,
  }

  mockWhere.mockReturnValue(query)
  mockQueryGet.mockResolvedValue({ docs: [] })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') {
      return {
        doc: jest.fn((id: string) => ({
          id,
          get: jest.fn().mockResolvedValue({
            exists: true,
            id,
            data: () => ({
              id,
              members: organizationMembers,
              settings: organizationSettings,
            }),
          }),
        })),
        where: mockWhere,
      }
    }

    if (name === 'orgMembers') {
      return {
        doc: jest.fn((id: string) => ({
          id,
          get: jest.fn().mockResolvedValue(
            orgMemberRoles[id]
              ? { exists: true, id, data: () => ({ role: orgMemberRoles[id] }) }
              : { exists: false, id, data: () => undefined },
          ),
        })),
        where: mockWhere,
      }
    }

    return {
      doc: jest.fn(() => documentRef),
      where: mockWhere,
    }
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

  it('returns a structured 409 and initializes discovery before linked document creation', async () => {
    const documentRef = makeDocumentRef()
    const planningEventRef = { id: 'event-1' }
    const projectRef = {
      id: 'project-1',
      collection: jest.fn(() => ({ doc: jest.fn(() => planningEventRef) })),
    }
    mockCollection.mockImplementation((name: string) => ({
      doc: jest.fn(() => name === 'projects' ? projectRef : documentRef),
      where: mockWhere,
    }))
    mockTransactionGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-1' }) })

    const { POST } = await import('@/app/api/v1/client-documents/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents', {
      title: 'Project requirements',
      type: 'build_spec',
      linked: { projectId: 'project-1' },
    })

    const res = await POST(req, adminUser)
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body).toEqual(expect.objectContaining({
      success: false,
      error: expect.stringContaining('Start planning discovery'),
      code: 'planning_discovery_required',
      revision: 0,
    }))
    expect(mockTransactionUpdate).toHaveBeenCalledWith(projectRef, expect.objectContaining({
      planningDiscovery: expect.objectContaining({ status: 'interviewing', enforced: true }),
    }))
    expect(mockTransactionSet).toHaveBeenCalledWith(planningEventRef, expect.objectContaining({
      type: 'started',
      projectId: 'project-1',
      reason: 'client_document.created',
    }))
    expect(mockBatchCommit).not.toHaveBeenCalled()
  })

  it('creates a platform-owned document linked to a CRM company and client org', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ orgId: 'pib-platform-owner', linkedOrgId: 'client-org', deleted: false }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents', {
      orgId: 'pib-platform-owner',
      title: 'Client Growth Proposal',
      type: 'sales_proposal',
      linked: { companyId: 'company-1', clientOrgId: 'client-org' },
    })

    const res = await POST(req, adminUser)
    const documentWrite = mockBatchSet.mock.calls[0]?.[1]

    expect(res.status).toBe(201)
    expect(documentWrite).toEqual(expect.objectContaining({
      orgId: 'pib-platform-owner',
      linked: {
        companyId: 'company-1',
        companyIds: ['company-1'],
        clientOrgId: 'client-org',
        clientOrgIds: ['client-org'],
      },
    }))
  })

  it('source-owns new selected-client documents under Partners in Biz when a platform CRM company exists', async () => {
    mockQueryGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'company-1',
          data: () => ({ orgId: 'pib-platform-owner', linkedOrgId: 'client-org', deleted: false }),
        },
      ],
    })
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ orgId: 'pib-platform-owner', linkedOrgId: 'client-org', deleted: false }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents', {
      orgId: 'client-org',
      title: 'Client Growth Proposal',
      type: 'sales_proposal',
    })

    const res = await POST(req, adminUser)
    const body = await res.json()
    const documentWrite = mockBatchSet.mock.calls[0]?.[1]

    expect(res.status).toBe(201)
    expect(body.data).toEqual(expect.objectContaining({
      orgId: 'pib-platform-owner',
      linked: {
        companyId: 'company-1',
        companyIds: ['company-1'],
        clientOrgId: 'client-org',
        clientOrgIds: ['client-org'],
      },
    }))
    expect(documentWrite).toEqual(expect.objectContaining({
      orgId: 'pib-platform-owner',
      linked: {
        companyId: 'company-1',
        companyIds: ['company-1'],
        clientOrgId: 'client-org',
        clientOrgIds: ['client-org'],
      },
    }))
  })

  it('source-owns new company-only documents from the linked CRM company org without requiring a client org', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ orgId: 'pib-platform-owner', name: 'Standalone Prospect', deleted: false }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents', {
      title: 'Standalone Prospect Proposal',
      type: 'sales_proposal',
      linked: { companyId: 'company-plain' },
    })

    const res = await POST(req, adminUser)
    const body = await res.json()
    const documentWrite = mockBatchSet.mock.calls[0]?.[1]

    expect(res.status).toBe(201)
    expect(body.data).toEqual(expect.objectContaining({
      orgId: 'pib-platform-owner',
      linked: { companyId: 'company-plain', companyIds: ['company-plain'] },
    }))
    expect(documentWrite).toEqual(expect.objectContaining({
      orgId: 'pib-platform-owner',
      linked: { companyId: 'company-plain', companyIds: ['company-plain'] },
    }))
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

  it('blocks client document creation when the organisation policy denies their role', async () => {
    organizationSettings = {
      modulePolicies: {
        documents: {
          actions: {
            create: { owner: true, admin: true, member: false },
          },
        },
      },
    }
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

  it('allows client org members to create documents when the organisation policy permits it', async () => {
    organizationSettings = {
      modulePolicies: {
        documents: {
          actions: {
            create: { owner: true, admin: true, member: true },
          },
        },
      },
    }
    const { POST } = await import('@/app/api/v1/client-documents/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents', {
      orgId: 'org-1',
      title: 'Client-authored proposal',
      type: 'sales_proposal',
    })

    const res = await POST(req, clientUser)

    expect(res.status).toBe(201)
    expect(mockBatchSet).toHaveBeenCalledTimes(2)
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

  it('lists only client-visible documents explicitly linked to the client org for client users', async () => {
    // Client list path: (1) owned/shared on scope org (2) owned/shared again via helper
    // (3-4) platform linked.clientOrgId / clientOrgIds queries.
    mockQueryGet
      .mockResolvedValueOnce({
        // listForOrg(client-org) — client-held workspace docs
        docs: [
          { id: 'doc-direct', data: () => ({ orgId: 'client-org', title: 'Direct document without explicit link', status: 'approved', createdBy: 'client-2', deleted: false }) },
          { id: 'doc-direct-linked', data: () => ({ orgId: 'client-org', title: 'Direct linked document', status: 'approved', linked: { clientOrgIds: ['client-org'] }, createdBy: 'client-2', deleted: false }) },
          { id: 'doc-internal', data: () => ({ orgId: 'client-org', title: 'Internal document with many CRM links', status: 'internal_review', linked: { clientOrgIds: ['client-org'], companyIds: ['company-1', 'company-2'], contactIds: ['contact-1', 'contact-2'] }, createdBy: 'client-2', deleted: false }) },
        ],
      })
      .mockResolvedValueOnce({
        // owned by user on client-org
        docs: [
          { id: 'doc-direct', data: () => ({ orgId: 'client-org', title: 'Direct document without explicit link', status: 'approved', createdBy: 'client-2', deleted: false }) },
        ],
      })
      .mockResolvedValueOnce({
        // shared with user
        docs: [],
      })
      .mockResolvedValueOnce({
        // platform linked.clientOrgId == client-org
        docs: [
          {
            id: 'doc-linked',
            data: () => ({
              orgId: 'pib-platform-owner',
              title: 'Linked platform document',
              status: 'client_review',
              linked: { clientOrgIds: ['client-org'], companyIds: ['company-1'] },
              deleted: false,
            }),
          },
        ],
      })
      .mockResolvedValueOnce({
        // platform array-contains
        docs: [
          {
            id: 'doc-crm-only',
            data: () => ({
              orgId: 'pib-platform-owner',
              title: 'CRM-only company link must not expose',
              status: 'approved',
              linked: { companyIds: ['company-1'], contactIds: ['contact-1'] },
              deleted: false,
            }),
          },
          {
            id: 'doc-other',
            data: () => ({
              orgId: 'pib-platform-owner',
              title: 'Other client document',
              status: 'client_review',
              linked: { clientOrgIds: ['other-org'], companyIds: ['company-2'] },
              deleted: false,
            }),
          },
        ],
      })

    const { GET } = await import('@/app/api/v1/client-documents/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents')

    const res = await GET(req, linkedClientUser)
    const body = await res.json()

    expect(res.status).toBe(200)
    // Client-role never gets full holder dump. Own/client-held + recipient-linked client-facing only.
    expect(body.data.map((doc: { id: string }) => doc.id).sort()).toEqual([
      'doc-direct',
      'doc-direct-linked',
      'doc-internal',
      'doc-linked',
    ].sort())
    expect(mockWhere).toHaveBeenCalledWith('linked.clientOrgId', '==', 'client-org')
    expect(mockWhere).toHaveBeenCalledWith('linked.clientOrgIds', 'array-contains', 'client-org')
  })

  it('never dumps platform-held docs to a client-role user who is also a platform member', async () => {
    // Stean-style: role=client, orgId=pib-platform-owner
    const platformClientUser = {
      uid: 'stean-1',
      role: 'client' as const,
      orgId: 'pib-platform-owner',
      orgIds: ['pib-platform-owner', 'client-org-a'],
    }
    mockQueryGet
      // owned on platform
      .mockResolvedValueOnce({
        docs: [
          { id: 'doc-own', data: () => ({ orgId: 'pib-platform-owner', title: 'Mine', status: 'internal_draft', createdBy: 'stean-1', deleted: false }) },
        ],
      })
      // shared on platform
      .mockResolvedValueOnce({ docs: [] })
      // platform linked to client-org-a
      .mockResolvedValueOnce({
        docs: [
          {
            id: 'doc-for-me',
            data: () => ({
              orgId: 'pib-platform-owner',
              title: 'Saaiman proposal',
              status: 'client_review',
              linked: { clientOrgId: 'client-org-a' },
              deleted: false,
            }),
          },
        ],
      })
      .mockResolvedValueOnce({ docs: [] }) // array-contains client-org-a
      // also queries for pib-platform-owner as recipientOrgIds includes scope — should not expose
      .mockResolvedValueOnce({
        docs: [
          {
            id: 'doc-scholtz',
            data: () => ({
              orgId: 'pib-platform-owner',
              title: 'Scholtz secret',
              status: 'client_review',
              linked: { clientOrgId: 'pib-platform-owner' },
              deleted: false,
            }),
          },
        ],
      })
      .mockResolvedValueOnce({ docs: [] })

    const { GET } = await import('@/app/api/v1/client-documents/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents?orgId=pib-platform-owner')
    const res = await GET(req, platformClientUser)
    const body = await res.json()
    expect(res.status).toBe(200)
    const ids = body.data.map((doc: { id: string }) => doc.id)
    expect(ids).toContain('doc-own')
    expect(ids).toContain('doc-for-me')
    expect(ids).not.toContain('doc-scholtz')
  })

  it('lists selected-client documents for admins and only client-visible platform-owned linked docs', async () => {
    mockQueryGet
      .mockResolvedValueOnce({
        docs: [
          {
            id: 'doc-direct',
            data: () => ({
              orgId: 'client-org',
              title: 'Direct client draft',
              status: 'internal_draft',
              deleted: false,
            }),
          },
        ],
      })
      .mockResolvedValueOnce({
        docs: [
          {
            id: 'doc-linked-internal',
            data: () => ({
              orgId: 'pib-platform-owner',
              title: 'PiB-owned linked internal draft',
              status: 'internal_review',
              linked: { clientOrgId: 'client-org', companyId: 'company-1' },
              deleted: false,
            }),
          },
          {
            id: 'doc-linked-published',
            data: () => ({
              orgId: 'pib-platform-owner',
              title: 'PiB-owned linked client review doc',
              status: 'client_review',
              linked: { clientOrgId: 'client-org', companyId: 'company-1' },
              deleted: false,
            }),
          },
          {
            id: 'doc-other',
            data: () => ({
              orgId: 'pib-platform-owner',
              title: 'Other client document',
              status: 'client_review',
              linked: { clientOrgId: 'other-org', companyId: 'company-2' },
              deleted: false,
            }),
          },
        ],
      })

    const { GET } = await import('@/app/api/v1/client-documents/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents?orgId=client-org')

    const res = await GET(req, adminUser)
    const body = await res.json()

    expect(res.status).toBe(200)
    // Client-org listing keeps direct client-owned docs, but platform-owned linked docs
    // only appear after they leave internal draft/review (client-visible statuses).
    expect(body.data.map((doc: { id: string }) => doc.id)).toEqual(['doc-direct', 'doc-linked-published'])
    expect(mockWhere).toHaveBeenCalledWith('linked.clientOrgId', '==', 'client-org')
    expect(mockWhere).toHaveBeenCalledWith('linked.clientOrgIds', 'array-contains', 'client-org')
  })

  it('returns a scoped document when the actor has access', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({ orgId: 'org-1', title: 'Proposal', status: 'approved', linked: { clientOrgId: 'org-1' }, deleted: false }),
    })

    const { GET } = await import('@/app/api/v1/client-documents/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1')
    const res = await GET(req, clientUser, { params: Promise.resolve({ id: 'doc-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toMatchObject({ id: 'doc-1', orgId: 'org-1', title: 'Proposal' })
  })

  it('returns a platform-owned client-visible document linked to the client org', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'pib-platform-owner',
        title: 'Linked proposal',
        status: 'client_review',
        linked: { clientOrgId: 'client-org', companyId: 'company-1' },
        deleted: false,
      }),
    })

    const { GET } = await import('@/app/api/v1/client-documents/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1')
    const res = await GET(req, linkedClientUser, { params: Promise.resolve({ id: 'doc-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toMatchObject({
      id: 'doc-1',
      orgId: 'pib-platform-owner',
      linked: { clientOrgId: 'client-org', companyId: 'company-1' },
    })
  })

  it('blocks clients from platform-owned internal draft documents even when linked to their org', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'pib-platform-owner',
        title: 'Internal draft',
        status: 'internal_draft',
        linked: { clientOrgId: 'client-org', companyId: 'company-1' },
        deleted: false,
      }),
    })

    const { GET } = await import('@/app/api/v1/client-documents/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1')
    const res = await GET(req, linkedClientUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(403)
  })

  it('blocks clients from platform-owned client-facing documents without an explicit client org link', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'pib-platform-owner',
        title: 'Approved but only CRM-linked',
        status: 'approved',
        linked: { companyIds: ['company-1'], contactIds: ['contact-1'] },
        deleted: false,
      }),
    })

    const { GET } = await import('@/app/api/v1/client-documents/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1')
    const res = await GET(req, linkedClientUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(403)
  })

  it('allows client holder-org members to read direct-org documents without a recipient link', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'client-org',
        title: 'Client workspace document',
        status: 'approved',
        linked: { companyIds: ['company-1'] },
        deleted: false,
      }),
    })

    const { GET } = await import('@/app/api/v1/client-documents/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1')
    const res = await GET(req, linkedClientUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(200)
  })

  it('denies a legacy raw uid share even when the uid is listed', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'pib-platform-owner',
        title: 'Stean meeting minutes',
        status: 'internal_draft',
        createdBy: 'client-2',
        sharedWithUserIds: ['client-1'],
        deleted: false,
      }),
    })

    const { GET } = await import('@/app/api/v1/client-documents/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1')
    const res = await GET(req, clientUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(403)
  })

  it('allows clients to fetch client-visible documents explicitly linked via clientOrgIds', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'pib-platform-owner',
        title: 'Explicit array-linked proposal',
        status: 'approved',
        linked: { clientOrgIds: ['client-org'], companyIds: ['company-1'], contactIds: ['contact-1'] },
        deleted: false,
      }),
    })

    const { GET } = await import('@/app/api/v1/client-documents/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1')
    const res = await GET(req, linkedClientUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(200)
  })

  it('blocks clients from platform-owned documents linked to a different client org', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'pib-platform-owner',
        title: 'Other client proposal',
        status: 'client_review',
        linked: { clientOrgId: 'other-org' },
        deleted: false,
      }),
    })

    const { GET } = await import('@/app/api/v1/client-documents/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1')
    const res = await GET(req, linkedClientUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(403)
  })

  it('allows owner-org staff to GET a platform-owned document by id', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'pib-platform-owner',
        title: 'Platform held proposal',
        status: 'internal_draft',
        linked: { clientOrgId: 'client-org' },
        deleted: false,
      }),
    })

    const platformStaff = {
      uid: 'pib-staff',
      role: 'admin' as const,
      orgId: 'pib-platform-owner',
      orgIds: ['pib-platform-owner'],
    }
    const { GET } = await import('@/app/api/v1/client-documents/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1')
    const res = await GET(req, platformStaff, { params: Promise.resolve({ id: 'doc-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toMatchObject({ id: 'doc-1', orgId: 'pib-platform-owner' })
  })

  it('does not grant authenticated portal GET via a public share token', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'pib-platform-owner',
        title: 'Publicly shared proposal',
        status: 'client_review',
        shareToken: 'public-share-token',
        shareEnabled: true,
        linked: { clientOrgId: 'other-org' },
        deleted: false,
      }),
    })

    const { GET } = await import('@/app/api/v1/client-documents/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1')
    const res = await GET(req, linkedClientUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(403)
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

  it('patches CRM company and client org links', async () => {
    mockTransactionGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({ orgId: 'pib-platform-owner', title: 'Old', deleted: false }),
    })
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ orgId: 'pib-platform-owner', deleted: false }),
    })

    const { PATCH } = await import('@/app/api/v1/client-documents/[id]/route')
    const req = jsonRequest(
      'http://localhost/api/v1/client-documents/doc-1',
      { linked: { companyId: 'company-1', clientOrgId: 'client-org' } },
      'PATCH',
    )

    const res = await PATCH(req, adminUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(200)
    expect(mockTransactionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'doc-1' }),
      expect.objectContaining({
        linked: {
          companyId: 'company-1',
          companyIds: ['company-1'],
          clientOrgId: 'client-org',
          clientOrgIds: ['client-org'],
        },
        updatedBy: 'admin-1',
        updatedByType: 'user',
      }),
    )
  })

  it('patches normalised multi-relationship fields while preserving scalar primary links', async () => {
    const planningBrief = {
      outcome: 'Keep linked planning context current',
      user: 'Project managers',
      whyNow: 'Document relationships changed',
      successCriteria: ['Project planning reopens'],
      constraints: ['Preserve approvals'],
      outOfScope: ['Production deploy'],
      assumptions: ['Existing work may finish'],
      risks: ['Stale context'],
      approvalGates: ['production-deploy'],
    }
    mockTransactionGet
      .mockResolvedValueOnce({
        exists: true,
        id: 'doc-1',
        data: () => ({ orgId: 'org-1', title: 'Old', deleted: false }),
      })
      .mockResolvedValue({
        exists: true,
        data: () => ({
          orgId: 'org-1',
          planningDiscovery: {
            schemaVersion: 1,
            revision: 4,
            status: 'assumptions_attested',
            mode: 'assumptions',
            enforced: true,
            attestation: 'PLAN WITH ASSUMPTIONS',
            attestationReason: 'Proceed with documented assumptions',
            acknowledgesPreservedOperationalGates: true,
            confirmedBy: 'admin-1',
            confirmedAt: '2026-07-27T00:00:00.000Z',
            brief: planningBrief,
            digest: planningDiscoveryDigest(planningBrief),
            inspection: {
              brief: ['brief'], docs: ['docs'], files: ['files'], plan: ['plan'], tasks: ['tasks'],
              tools: ['tools'], agents: ['agents'], skills: ['skills'], inspectedBy: 'pip',
              inspectedAt: '2026-07-27T00:00:00.000Z',
            },
          },
        }),
      })
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ orgId: 'org-1', deleted: false }),
    })

    const { PATCH } = await import('@/app/api/v1/client-documents/[id]/route')
    const req = jsonRequest(
      'http://localhost/api/v1/client-documents/doc-1',
      {
        linked: {
          companyId: 'company-1',
          companyIds: ['company-2', 'company-1'],
          contactId: 'contact-1',
          contactIds: ['contact-2', 'contact-1'],
          clientOrgId: 'client-org-1',
          clientOrgIds: ['client-org-2', 'client-org-1'],
          projectId: 'project-1',
          projectIds: ['project-2', 'project-1'],
          dealId: 'deal-1',
          dealIds: ['deal-2', 'deal-1'],
        },
      },
      'PATCH',
    )

    const res = await PATCH(req, adminUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(200)
    expect(mockTransactionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'doc-1' }),
      expect.objectContaining({
        linked: {
          companyId: 'company-1',
          companyIds: ['company-1', 'company-2'],
          contactId: 'contact-1',
          contactIds: ['contact-1', 'contact-2'],
          clientOrgId: 'client-org-1',
          clientOrgIds: ['client-org-1', 'client-org-2'],
          projectId: 'project-1',
          projectIds: ['project-1', 'project-2'],
          dealId: 'deal-1',
          dealIds: ['deal-1', 'deal-2'],
        },
        updatedBy: 'admin-1',
        updatedByType: 'user',
      }),
    )
  })

  it('rejects cross-org CRM contact ids in document links', async () => {
    mockTransactionGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({ orgId: 'org-1', title: 'Old', deleted: false }),
    })
    mockDocGet
      .mockResolvedValueOnce({ exists: true, data: () => ({ orgId: 'org-1', deleted: false }) })
      .mockResolvedValueOnce({ exists: true, data: () => ({ orgId: 'org-2', deleted: false }) })

    const { PATCH } = await import('@/app/api/v1/client-documents/[id]/route')
    const req = jsonRequest(
      'http://localhost/api/v1/client-documents/doc-1',
      { linked: { companyIds: ['company-1'], contactIds: ['contact-foreign'] } },
      'PATCH',
    )

    const res = await PATCH(req, adminUser, { params: Promise.resolve({ id: 'doc-1' }) })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain('linked.contactIds contains a contact outside the document org')
    expect(mockTransactionUpdate).not.toHaveBeenCalled()
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

  it('rejects raw uid share mutation instead of creating an unaudited grant', async () => {
    const { PATCH } = await import('@/app/api/v1/client-documents/[id]/route')
    const request = jsonRequest(
      'http://localhost/api/v1/client-documents/doc-1',
      { sharedWithUserIds: ['client-2'] },
      'PATCH',
    )

    const response = await PATCH(request, clientUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(response.status).toBe(400)
    expect(mockTransactionUpdate).not.toHaveBeenCalled()
  })

  it('publishes documents with orgId and no blocking assumptions', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'org-1',
        currentVersionId: 'version-1',
        linked: { clientOrgId: 'org-1' },
        assumptions: [],
        deleted: false,
      }),
    })
    mockTransactionGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        orgId: 'org-1',
        currentVersionId: 'version-1',
        linked: { clientOrgId: 'org-1' },
        assumptions: [],
        deleted: false,
      }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/publish/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1/publish', { method: 'POST' })
    const res = await POST(req, user, { params: Promise.resolve({ id: 'doc-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({
      id: 'doc-1',
      versionId: 'version-1',
      clientOrgIds: ['org-1'],
      multiOrgPublish: false,
    })
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

  it('returns a multi-org publish warning unless explicitly acknowledged', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'pib-platform-owner',
        currentVersionId: 'version-1',
        linked: { clientOrgIds: ['client-org-1', 'client-org-2'] },
        assumptions: [],
        deleted: false,
      }),
    })
    mockTransactionGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        orgId: 'pib-platform-owner',
        currentVersionId: 'version-1',
        linked: { clientOrgIds: ['client-org-1', 'client-org-2'] },
        assumptions: [],
        deleted: false,
      }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/publish/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents/doc-1/publish', {}, 'POST')
    const res = await POST(req, user, { params: Promise.resolve({ id: 'doc-1' }) })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toBe('Publishing to multiple client orgs requires explicit acknowledgement')
    expect(mockTransactionUpdate).not.toHaveBeenCalled()
  })

  it('blocks non-creator clients from publishing documents', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-2',
      data: () => ({
        orgId: 'org-1',
        createdBy: 'someone-else',
        currentVersionId: 'version-1',
        linked: { clientOrgId: 'org-1' },
        assumptions: [],
        deleted: false,
      }),
    })
    const { POST } = await import('@/app/api/v1/client-documents/[id]/publish/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-2/publish', { method: 'POST' })
    const res = await POST(req, clientUser, { params: Promise.resolve({ id: 'doc-2' }) })

    expect(res.status).toBe(403)
    expect(mockTransactionGet).not.toHaveBeenCalled()
    expect(mockTransactionUpdate).not.toHaveBeenCalled()
  })

  it('allows document creators with client role to publish their own drafts', async () => {
    mockDocGet
      .mockResolvedValueOnce({
        exists: true,
        id: 'doc-own',
        data: () => ({
          orgId: 'org-1',
          createdBy: 'client-1',
          currentVersionId: 'version-1',
          linked: { clientOrgId: 'org-1' },
          assumptions: [],
          deleted: false,
        }),
      })
    mockTransactionGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        orgId: 'org-1',
        createdBy: 'client-1',
        currentVersionId: 'version-1',
        linked: { clientOrgId: 'org-1' },
        assumptions: [],
        deleted: false,
      }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/publish/route')
    const req = new NextRequest('http://localhost/api/v1/client-documents/doc-own/publish', { method: 'POST' })
    const res = await POST(req, clientUser, { params: Promise.resolve({ id: 'doc-own' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({
      id: 'doc-own',
      versionId: 'version-1',
      clientOrgIds: ['org-1'],
      multiOrgPublish: false,
    })
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
      data: () => ({ orgId: 'org-1', title: 'Proposal', status: 'approved', linked: { clientOrgId: 'org-1' }, deleted: false }),
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
      data: () => ({ orgId: 'org-1', title: 'Proposal', status: 'approved', linked: { clientOrgId: 'org-1' }, deleted: false }),
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

  it('defaults missing required/display and accepts top-level motion aliases from agent payloads', async () => {
    mockTransactionGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({ orgId: 'org-1', title: 'Proposal', deleted: false }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/versions/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents/doc-1/versions', {
      blocks: [
        {
          id: 'hero',
          type: 'hero',
          title: 'SPEC',
          content: 'Hunt & Gun CRM',
          motion: 'reveal',
        },
        {
          id: 'summary',
          type: 'summary',
          title: 'Overview',
          content: 'Agent content-only block',
        },
      ],
      theme: {
        brandName: 'Hunt and Gun',
        palette: { bg: '#FFFFFF', text: '#1a202c', accent: '#D5A138' },
      },
      changeSummary: 'Agent payload without required/display/typography',
    })

    const res = await POST(req, user, { params: Promise.resolve({ id: 'doc-1' }) })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data).toEqual({ id: 'version-1' })
    expect(mockTransactionSet).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'version-1' }),
      expect.objectContaining({
        blocks: [
          expect.objectContaining({
            id: 'hero',
            required: false,
            display: { motion: 'reveal' },
          }),
          expect.objectContaining({
            id: 'summary',
            required: false,
            display: {},
          }),
        ],
        theme: expect.objectContaining({
          brandName: 'Hunt and Gun',
          palette: expect.objectContaining({ accent: '#D5A138' }),
          typography: expect.objectContaining({
            heading: expect.any(String),
            body: expect.any(String),
          }),
        }),
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

  it('sanitizes block-level context refs and explicit internal-only visibility on draft versions', async () => {
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
          content: 'Client-safe copy',
          required: true,
          display: {},
          visibility: 'internal-only',
          contextRefs: [
            { type: 'company', id: ' company-1 ', orgId: 'org-1', label: ' Acme CRM ', origin: 'manual', href: '/admin/crm/companies/company-1' },
            { type: 'company', id: 'company-1', orgId: 'org-1', label: 'Duplicate', origin: 'manual' },
            { type: 'not-real', id: 'bad', label: 'Bad' },
          ],
        },
      ],
      theme: {
        palette: { bg: '#0A0A0B', text: '#F7F4EE', accent: '#F5A623' },
        typography: { heading: 'Instrument Serif', body: 'Geist' },
      },
    })

    const res = await POST(req, user, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(201)
    expect(mockTransactionSet).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'version-1' }),
      expect.objectContaining({
        blocks: [
          expect.objectContaining({
            visibility: 'internal-only',
            contextRefs: [
              expect.objectContaining({ type: 'company', id: 'company-1', orgId: 'org-1', label: 'Acme CRM', origin: 'manual' }),
            ],
          }),
        ],
      }),
    )
  })

  it('allows document creators with client role to create draft versions (user-delegation path)', async () => {
    mockTransactionGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'org-1',
        title: 'Member-owned proposal',
        deleted: false,
        createdBy: 'client-1',
        status: 'internal_draft',
      }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/versions/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents/doc-1/versions', {
      blocks: [
        {
          id: 'summary',
          type: 'summary',
          title: 'Summary',
          content: 'Creator revision via user-delegation',
          required: true,
          display: {},
        },
      ],
      theme: {
        palette: { bg: '#0A0A0B', text: '#F7F4EE', accent: '#F5A623' },
        typography: { heading: 'Instrument Serif', body: 'Geist' },
      },
      changeSummary: 'Creator pricing amendment',
    })

    const res = await POST(req, clientUser, { params: Promise.resolve({ id: 'doc-1' }) })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data).toEqual({ id: 'version-1' })
    expect(mockTransactionSet).toHaveBeenCalled()
  })

  it('blocks non-creator clients from creating document versions', async () => {
    mockTransactionGet.mockResolvedValueOnce({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'org-1',
        title: 'Someone else proposal',
        deleted: false,
        createdBy: 'other-user',
        sharedWithUserIds: ['client-1'],
        status: 'internal_draft',
      }),
    })

    const { POST } = await import('@/app/api/v1/client-documents/[id]/versions/route')
    const req = jsonRequest('http://localhost/api/v1/client-documents/doc-1/versions', {
      blocks: [
        {
          id: 'summary',
          type: 'summary',
          content: 'Should not write',
          required: true,
          display: {},
        },
      ],
      theme: {
        palette: { bg: '#0A0A0B', text: '#F7F4EE', accent: '#F5A623' },
        typography: { heading: 'Instrument Serif', body: 'Geist' },
      },
    })
    const res = await POST(req, clientUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(403)
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
