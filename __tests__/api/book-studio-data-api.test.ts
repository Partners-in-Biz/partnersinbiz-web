import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockGet = jest.fn()
const mockAdd = jest.fn()
const mockDoc = jest.fn()
const mockOrgGet = jest.fn()
const mockCanAccessOrg = jest.fn()
let mockUser = { uid: 'agent-theo', role: 'ai', orgId: 'pib-platform-owner' } as { uid: string; role: string; orgId?: string; authKind?: string; permissions?: Array<{ resource: string; actions: string[] }> }

type AuthHandler = (req: NextRequest, user: typeof mockUser) => Promise<Response> | Response

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string | string[], handler: AuthHandler) => (req: NextRequest) =>
    handler(req, mockUser),
}))

jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: (...args: unknown[]) => mockCanAccessOrg(...args),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}))

function stageFirestore({
  orgSettings = { portalModules: { bookStudio: true } },
  docs = [],
  linkedDocs = {},
}: {
  orgSettings?: Record<string, unknown>
  docs?: Array<{ id: string; data: () => Record<string, unknown> }>
  linkedDocs?: Record<string, Record<string, unknown> | null>
} = {}) {
  mockCanAccessOrg.mockReturnValue(true)
  mockOrgGet.mockResolvedValue({ exists: true, data: () => ({ settings: orgSettings }) })
  mockGet.mockResolvedValue({ docs })
  mockAdd.mockResolvedValue({ id: 'new-record-1' })
  mockWhere.mockReturnValue({ get: mockGet })
  mockDoc.mockImplementation((id: string) => {
    if (linkedDocs[id] !== undefined) {
      const data = linkedDocs[id]
      return { get: jest.fn().mockResolvedValue({ exists: data !== null, data: () => data }) }
    }
    return { get: mockOrgGet }
  })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') return { doc: mockDoc }
    return { where: mockWhere, add: mockAdd, doc: mockDoc }
  })
}

describe('Book Studio data/API model', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    mockUser = { uid: 'agent-theo', role: 'ai', orgId: 'pib-platform-owner' }
    stageFirestore()
  })

  it('sanitizes all Phase 1 record families and strips forbidden/unsafe fields', async () => {
    const { sanitizeBookStudioRecordInput, serializeBookStudioRecord, BOOK_STUDIO_RESOURCES } = await import('@/lib/book-studio/sanitize')

    expect(Object.keys(BOOK_STUDIO_RESOURCES).sort()).toEqual([
      'analytics-imports',
      'artifact-links',
      'briefs',
      'decision-logs',
      'package-manifests',
      'projects',
      'publishing-packets',
      'rights-ledgers',
      'series',
    ])

    const sanitized = sanitizeBookStudioRecordInput('projects', {
      orgId: 'evil-org',
      title: '  Proof-led Growth Handbook  ',
      stage: 'publishing_packet',
      status: 'approved_for_upload',
      marketplaceCredential: 'secret',
      marketplaceMetadataPatch: { title: 'mutate live listing' },
      publishNow: true,
      publish_now: true,
      internalNotes: 'operator-only',
      sourceDocumentId: 'doc-1',
      approvalGateTaskId: 'gate-task-1',
      linked: {
        projectId: 'project-1',
        sourceDocumentId: 'doc-linked-should-not-persist',
        access_token: 'secret-token',
        marketplaceCredentialId: 'credential-secret',
        submit_to_store: true,
        nested: { clientSecret: 'secret' },
      },
      safeSummary: '<b>client safe</b>',
      artifactLinks: [
        { label: 'Cover PDF', href: 'https://drive.google.com/file/d/cover', internalNotes: 'hide' },
        { label: 'Bad JS', href: 'javascript:alert(1)' },
      ],
      gates: [{ id: 'rights', label: 'Rights', status: 'pass', secret: 'hide' }],
      rightsLedger: { status: 'cleared', sourceUrls: ['https://example.com/source', 'javascript:bad'] },
    }, 'pib-platform-owner')

    expect(sanitized).toMatchObject({
      orgId: 'pib-platform-owner',
      title: 'Proof-led Growth Handbook',
      stage: 'publishing_packet',
      status: 'draft',
      safeSummary: '<b>client safe</b>',
      artifactLinks: [{ label: 'Cover PDF', href: 'https://drive.google.com/file/d/cover' }],
      gates: [{ id: 'rights', label: 'Rights', status: 'pass' }],
      rightsLedger: { status: 'cleared', sourceUrls: ['https://example.com/source'] },
      sourceDocumentId: 'doc-1',
      approvalGateTaskId: 'gate-task-1',
    })
    expect(JSON.stringify(sanitized)).not.toContain('marketplaceCredential')
    expect(JSON.stringify(sanitized)).not.toContain('marketplaceMetadataPatch')
    expect(JSON.stringify(sanitized)).not.toContain('publishNow')
    expect(JSON.stringify(sanitized)).not.toContain('internalNotes')
    expect(JSON.stringify(sanitized)).not.toContain('access_token')
    expect(JSON.stringify(sanitized)).not.toContain('marketplaceCredentialId')
    expect(JSON.stringify(sanitized)).not.toContain('submit_to_store')
    expect(JSON.stringify(sanitized)).not.toContain('clientSecret')
    expect(JSON.stringify(sanitized)).not.toContain('doc-linked-should-not-persist')
    expect(JSON.stringify(sanitized)).not.toContain('javascript:')

    const packet = sanitizeBookStudioRecordInput('publishing-packets', {
      projectId: 'book-1',
      title: 'KDP packet',
      channel: 'kdp',
      status: 'published',
      metadata: { title: 'Reader title', keywords: ['Growth', ''] },
      approvalState: { status: 'approved', snapshotHash: 'abc123', approvedBy: 'peet' },
    }, 'pib-platform-owner')
    expect(packet).toMatchObject({
      orgId: 'pib-platform-owner',
      projectId: 'book-1',
      title: 'KDP packet',
      channel: 'kdp',
      status: 'draft',
      metadata: { title: 'Reader title', keywords: ['Growth'] },
      approvalState: { status: 'approved', snapshotHash: 'abc123' },
    })

    expect(serializeBookStudioRecord('record-1', { ...sanitized, deleted: false })).toMatchObject({ id: 'record-1', orgId: 'pib-platform-owner' })
  })

  it('creates and lists tenant-scoped Book Studio project records with module and org parity guards', async () => {
    const { GET, POST } = await import('@/app/api/v1/book-studio/projects/route')

    const mismatch = await POST(new NextRequest('http://localhost/api/v1/book-studio/projects?orgId=pib-platform-owner', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-org-id': 'pib-platform-owner' },
      body: JSON.stringify({ orgId: 'other-org', title: 'Bad tenant' }),
    }))
    expect(mismatch.status).toBe(400)
    expect(mockAdd).not.toHaveBeenCalled()

    stageFirestore({ orgSettings: { portalModules: { bookStudio: false } } })
    const disabled = await POST(new NextRequest('http://localhost/api/v1/book-studio/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-org-id': 'pib-platform-owner' },
      body: JSON.stringify({ title: 'Disabled project' }),
    }))
    expect(disabled.status).toBe(403)
    expect(mockAdd).not.toHaveBeenCalled()

    stageFirestore()
    mockUser = { uid: 'agent-scoped', role: 'ai', authKind: 'agent_api_key', orgId: 'other-org' }
    const scopedAgent = await POST(new NextRequest('http://localhost/api/v1/book-studio/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-org-id': 'pib-platform-owner' },
      body: JSON.stringify({ title: 'Wrong org key' }),
    }))
    expect(scopedAgent.status).toBe(403)
    expect(mockAdd).not.toHaveBeenCalled()

    mockUser = { uid: 'agent-unscoped', role: 'ai', authKind: 'agent_api_key' }
    const unscopedAgent = await POST(new NextRequest('http://localhost/api/v1/book-studio/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-org-id': 'pib-platform-owner' },
      body: JSON.stringify({ title: 'Unscoped key' }),
    }))
    expect(unscopedAgent.status).toBe(403)
    expect(mockAdd).not.toHaveBeenCalled()

    mockUser = {
      uid: 'agent-permitted',
      role: 'ai',
      authKind: 'agent_api_key',
      permissions: [{ resource: 'org:pib-platform-owner:book-studio', actions: ['write', 'read'] }],
    }
    const permittedAgent = await POST(new NextRequest('http://localhost/api/v1/book-studio/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-org-id': 'pib-platform-owner' },
      body: JSON.stringify({ title: 'Permitted key' }),
    }))
    expect(permittedAgent.status).toBe(201)
    expect(mockAdd).toHaveBeenCalledTimes(1)
    mockAdd.mockClear()

    mockUser = { uid: 'agent-theo', role: 'ai', orgId: 'pib-platform-owner' }
    const malformed = await POST(new NextRequest('http://localhost/api/v1/book-studio/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-org-id': 'pib-platform-owner' },
      body: '{not-json',
    }))
    expect(malformed.status).toBe(400)
    expect(mockAdd).not.toHaveBeenCalled()

    stageFirestore({
      linkedDocs: { 'book-foreign': { orgId: 'other-org', title: 'Foreign book', deleted: false } },
    })
    const crossTenantReference = await POST(new NextRequest('http://localhost/api/v1/book-studio/briefs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-org-id': 'pib-platform-owner' },
      body: JSON.stringify({ title: 'Brief', projectId: 'book-foreign' }),
    }))
    expect(crossTenantReference.status).toBe(403)
    expect(mockAdd).not.toHaveBeenCalled()

    stageFirestore({
      linkedDocs: { 'book-1': { orgId: 'pib-platform-owner', title: 'Book A', deleted: false } },
      docs: [{ id: 'book-1', data: () => ({ orgId: 'pib-platform-owner', title: 'Book A', deleted: false, internalNotes: 'hide' }) }],
    })
    const created = await POST(new NextRequest('http://localhost/api/v1/book-studio/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-org-id': 'pib-platform-owner' },
      body: JSON.stringify({ title: 'Book A', status: 'approved_for_upload', artifactLinks: [{ label: 'Brief', href: 'https://example.com/brief' }] }),
    }))
    const createdBody = await created.json()
    expect(created.status).toBe(201)
    expect(createdBody.data).toEqual({ id: 'new-record-1', resource: 'projects' })
    expect(mockCollection).toHaveBeenCalledWith('book_studio_projects')
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'pib-platform-owner',
      title: 'Book A',
      status: 'draft',
      createdBy: 'agent-theo',
      createdByType: 'agent',
      createdAt: 'SERVER_TS',
    }))

    const listed = await GET(new NextRequest('http://localhost/api/v1/book-studio/projects', { headers: { 'x-org-id': 'pib-platform-owner' } }))
    const listedBody = await listed.json()
    expect(listed.status).toBe(200)
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'pib-platform-owner')
    expect(listedBody.data.records).toEqual([{ id: 'book-1', orgId: 'pib-platform-owner', title: 'Book A', deleted: false }])
    expect(JSON.stringify(listedBody)).not.toContain('internalNotes')
  })

  it('creates every linked Book Studio artifact family through resource-specific routes without publishing side effects', async () => {
    stageFirestore({ linkedDocs: { 'book-1': { orgId: 'pib-platform-owner', title: 'Book A', deleted: false } } })
    const routeImports = await Promise.all([
      import('@/app/api/v1/book-studio/briefs/route'),
      import('@/app/api/v1/book-studio/series/route'),
      import('@/app/api/v1/book-studio/artifact-links/route'),
      import('@/app/api/v1/book-studio/publishing-packets/route'),
      import('@/app/api/v1/book-studio/rights-ledgers/route'),
      import('@/app/api/v1/book-studio/package-manifests/route'),
      import('@/app/api/v1/book-studio/analytics-imports/route'),
      import('@/app/api/v1/book-studio/decision-logs/route'),
    ])

    for (const route of routeImports) {
      const res = await route.POST(new NextRequest('http://localhost/api/v1/book-studio/resource', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-org-id': 'pib-platform-owner' },
        body: JSON.stringify({ title: 'Linked record', projectId: 'book-1', href: 'https://example.com/artifact', status: 'published' }),
      }))
      expect(res.status).toBe(201)
    }

    const writes = mockAdd.mock.calls.map(([payload]) => payload)
    expect(writes).toHaveLength(8)
    expect(JSON.stringify(writes)).not.toContain('publishNow')
    expect(JSON.stringify(writes)).not.toContain('marketplaceCredential')
    expect(JSON.stringify(writes)).not.toContain('marketplaceMetadataPatch')
    expect(mockCollection).toHaveBeenCalledWith('book_studio_publishing_packets')
    expect(mockCollection).toHaveBeenCalledWith('book_studio_rights_ledgers')
    expect(mockCollection).toHaveBeenCalledWith('book_studio_package_manifests')
    expect(mockCollection).toHaveBeenCalledWith('book_studio_analytics_imports')
    expect(mockCollection).toHaveBeenCalledWith('book_studio_decision_logs')
  })
})
