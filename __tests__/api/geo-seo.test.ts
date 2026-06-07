import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin' | 'client' | 'ai'; orgId?: string; allowedOrgIds?: string[]; agentId?: string }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

let mockUser: MockUser = { uid: 'agent:theo', role: 'ai', agentId: 'theo' }

const mockAdd = jest.fn()
const mockDoc = jest.fn()
const mockGetDoc = jest.fn()
const mockSet = jest.fn()
const mockUpdate = jest.fn()
const mockWhere = jest.fn()
const mockGet = jest.fn()
const mockCollection = jest.fn()
const mockServerTimestamp = jest.fn(() => 'SERVER_TIMESTAMP')

jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: mockCollection } }))
jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) => handler(req, mockUser, ctx),
}))
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: mockServerTimestamp } }))

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockUser = { uid: 'agent:theo', role: 'ai', agentId: 'theo' }
  const query = { where: mockWhere, get: mockGet }
  mockWhere.mockReturnValue(query)
  mockDoc.mockReturnValue({ get: mockGetDoc, set: mockSet, update: mockUpdate })
  mockAdd.mockResolvedValue({ id: 'created-1' })
  mockSet.mockResolvedValue(undefined)
  mockUpdate.mockResolvedValue(undefined)
  mockGet.mockResolvedValue({ docs: [] })
  mockGetDoc.mockResolvedValue({ exists: false, id: 'missing', data: () => undefined })
  mockCollection.mockImplementation(() => ({ add: mockAdd, doc: mockDoc, where: mockWhere, get: mockGet }))
})

describe('GEO SEO namespace tenant-safe record APIs', () => {
  it('requires X-Org-Id and rejects body org mismatches on idempotent workspace creates', async () => {
    const { POST } = await import('@/app/api/v1/geo-seo/workspaces/route')

    const missingHeader = await POST(new NextRequest('http://localhost/api/v1/geo-seo/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'pib-platform-owner', siteUrl: 'https://partnersinbiz.co.za', siteName: 'PiB' }),
    }))
    const mismatch = await POST(new NextRequest('http://localhost/api/v1/geo-seo/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-org-id': 'pib-platform-owner' },
      body: JSON.stringify({ orgId: 'other-org', siteUrl: 'https://partnersinbiz.co.za', siteName: 'PiB' }),
    }))

    expect(missingHeader.status).toBe(400)
    expect(mismatch.status).toBe(400)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('creates a GEO workspace with source company and client org metadata', async () => {
    const { POST } = await import('@/app/api/v1/geo-seo/workspaces/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/geo-seo/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-org-id': 'pib-platform-owner', 'idempotency-key': 'geo-workspace-1' },
      body: JSON.stringify({
        orgId: 'pib-platform-owner',
        clientOrgId: 'client-org-1',
        companyId: 'company-1',
        sourceCompanyId: 'company-1',
        sourceCompanyName: 'Acme',
        siteUrl: 'https://www.example.com/path',
        siteName: 'Example',
        mode: 'monitoring',
      }),
    }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data).toEqual({ id: 'created-1' })
    expect(mockCollection).toHaveBeenCalledWith('geo_workspaces')
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'pib-platform-owner',
      clientOrgId: 'client-org-1',
      companyId: 'company-1',
      sourceCompanyId: 'company-1',
      sourceCompanyName: 'Acme',
      siteUrl: 'https://www.example.com/path',
      domain: 'example.com',
      siteName: 'Example',
      status: 'active',
      mode: 'monitoring',
      visibility: 'internal',
      currentGeoScore: null,
      previousGeoScore: null,
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
      createdBy: 'agent:theo',
      createdByType: 'agent',
    }))
  })

  it('filters workspace list by X-Org-Id and never trusts a mismatched org query', async () => {
    mockGet.mockResolvedValue({ docs: [
      { id: 'ws-1', data: () => ({ orgId: 'pib-platform-owner', siteName: 'Allowed', deleted: false, createdAt: { seconds: 2 } }) },
      { id: 'ws-2', data: () => ({ orgId: 'other-org', siteName: 'Denied', deleted: false, createdAt: { seconds: 3 } }) },
    ] })
    const { GET } = await import('@/app/api/v1/geo-seo/workspaces/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/geo-seo/workspaces?orgId=other-org', {
      headers: { 'x-org-id': 'pib-platform-owner' },
    }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/X-Org-Id/)
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('creates audit, finding, score history, report, and check-run records with strict tenant fields', async () => {
    const routes = await Promise.all([
      import('@/app/api/v1/geo-seo/audits/route'),
      import('@/app/api/v1/geo-seo/findings/route'),
      import('@/app/api/v1/geo-seo/score-history/route'),
      import('@/app/api/v1/geo-seo/reports/route'),
      import('@/app/api/v1/geo-seo/check-runs/route'),
    ])
    const payloads = [
      { workspaceId: 'ws-1', auditType: 'quick', siteUrl: 'https://example.com', compositeScore: 72, categoryScores: { citability: 70 } },
      { workspaceId: 'ws-1', auditId: 'audit-1', severity: 'high', category: 'schema', title: 'Missing entity schema', recommendation: 'Add Organisation schema' },
      { workspaceId: 'ws-1', auditId: 'audit-1', score: 72, previousScore: 64, delta: 8, categoryScores: { citability: 70 } },
      { workspaceId: 'ws-1', auditId: 'audit-1', type: 'client_report', title: 'GEO Quick Audit', documentId: 'doc-1', visibility: 'internal' },
      { workspaceId: 'ws-1', auditId: 'audit-1', checkType: 'llms_txt', status: 'queued', toolName: 'geo-llmstxt' },
    ]

    for (let index = 0; index < routes.length; index += 1) {
      const res = await routes[index].POST(new NextRequest(`http://localhost/api/v1/geo-seo/${index}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-org-id': 'pib-platform-owner' },
        body: JSON.stringify({ orgId: 'pib-platform-owner', clientOrgId: 'client-org-1', companyId: 'company-1', sourceCompanyId: 'company-1', ...payloads[index] }),
      }))
      expect(res.status).toBe(201)
    }

    expect(mockCollection).toHaveBeenCalledWith('geo_audits')
    expect(mockCollection).toHaveBeenCalledWith('geo_findings')
    expect(mockCollection).toHaveBeenCalledWith('geo_score_history')
    expect(mockCollection).toHaveBeenCalledWith('geo_reports')
    expect(mockCollection).toHaveBeenCalledWith('geo_check_runs')
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'pib-platform-owner', clientOrgId: 'client-org-1', companyId: 'company-1', sourceCompanyId: 'company-1', createdAt: 'SERVER_TIMESTAMP' }))
  })

  it('enforces tenant ownership when reading and updating individual GEO records', async () => {
    mockGetDoc.mockResolvedValue({ exists: true, id: 'ws-1', data: () => ({ orgId: 'other-org', siteName: 'Denied', deleted: false }) })
    const { GET, PATCH } = await import('@/app/api/v1/geo-seo/workspaces/[id]/route')

    const getRes = await GET(new NextRequest('http://localhost/api/v1/geo-seo/workspaces/ws-1', {
      headers: { 'x-org-id': 'pib-platform-owner' },
    }), { params: Promise.resolve({ id: 'ws-1' }) })
    const patchRes = await PATCH(new NextRequest('http://localhost/api/v1/geo-seo/workspaces/ws-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-org-id': 'pib-platform-owner' },
      body: JSON.stringify({ siteName: 'New name' }),
    }), { params: Promise.resolve({ id: 'ws-1' }) })

    expect(getRes.status).toBe(404)
    expect(patchRes.status).toBe(404)
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
