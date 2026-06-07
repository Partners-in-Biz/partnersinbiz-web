/** @jest-environment node */

import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockBatchSet = jest.fn()
const mockBatchUpdate = jest.fn()
const mockBatchCommit = jest.fn()
const mockDocGet = jest.fn()
const mockRunTransaction = jest.fn()
const mockTransactionGet = jest.fn()
const mockTransactionUpdate = jest.fn()

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
    runTransaction: mockRunTransaction,
  },
}))

type TestUser = { uid: string; role: 'ai' | 'admin' | 'client' }
type TestRouteContext = { params: Promise<{ id: string }> }
type TestHandler = (req: NextRequest, user: TestUser, ctx?: TestRouteContext) => Response | Promise<Response>

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_requiredRole: 'admin' | 'client', handler: TestHandler) => async (
    req: NextRequest,
    user: TestUser,
    ctx?: TestRouteContext,
  ) => {
    if (!user || !['ai', 'admin'].includes(user.role)) {
      return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return handler(req, user, ctx)
  },
}))

const aiUser = { uid: 'agent:theo', role: 'ai' as const }

function jsonRequest(url: string, body: unknown, method = 'POST') {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Org-Id': 'pib-platform-owner' },
    body: JSON.stringify(body),
  })
}

type TestDocRef = {
  id: string
  get?: jest.Mock
  collection?: jest.Mock
}

function setupDocCollections() {
  const refs: Record<string, TestDocRef> = {
    geo_audits: { id: 'audit-1', get: mockDocGet },
    client_documents: {
      id: 'doc-1',
      collection: jest.fn(() => ({ doc: jest.fn(() => ({ id: 'version-1' })) })),
    },
    geo_reports: { id: 'report-1', get: mockDocGet },
  }
  mockCollection.mockImplementation((name: string) => ({
    doc: jest.fn((id?: string) => (id ? { ...refs[name], id } : refs[name])),
  }))
}

beforeEach(() => {
  jest.clearAllMocks()
  mockBatchCommit.mockResolvedValue(undefined)
  mockRunTransaction.mockImplementation((handler) => handler({ get: mockTransactionGet, update: mockTransactionUpdate }))
  setupDocCollections()
})

describe('GEO SEO report Client Document workflow', () => {
  it('creates an internal Client Document draft from a GEO audit and preserves provenance links', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'audit-1',
      data: () => ({
        id: 'audit-1',
        orgId: 'pib-platform-owner',
        workspaceId: 'workspace-1',
        siteName: 'Partners in Biz',
        siteUrl: 'https://partnersinbiz.online',
        projectId: 'UhlEQl2fsZbhfAcnKmt2',
        clientOrgId: 'pib-platform-owner',
        sourceCompanyId: 'company-source',
        compositeScore: 72,
        categoryScores: { citability: 70, technical: 85 },
        findings: [
          {
            id: 'finding-1',
            severity: 'high',
            category: 'citability',
            title: 'Weak citation evidence',
            recommendation: 'Add stronger source-backed proof blocks.',
            evidenceRowIds: ['ev-row-1'],
          },
        ],
        evidenceRowIds: ['ev-row-1', 'ev-row-2'],
        assumptions: [{ text: 'AI platform results are sampled.', severity: 'needs_review' }],
      }),
    })

    const { POST } = await import('@/app/api/v1/geo-seo/audits/[id]/report/route')
    const res = await POST(
      jsonRequest('http://localhost/api/v1/geo-seo/audits/audit-1/report', {
        orgId: 'pib-platform-owner',
        sourceDocumentId: 'spcGrC3eqoCH6fCYWmUK',
        sourceSpecVersion: 'VGrgmHtxUS30GRpvfnJC',
        approvalGateTaskId: 'kozWpdbNo5APgv52rRKc',
      }),
      aiUser,
      { params: Promise.resolve({ id: 'audit-1' }) },
    )
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data).toMatchObject({ reportId: 'report-1', documentId: 'doc-1', documentVersionId: 'version-1' })
    const documentWrite = mockBatchSet.mock.calls.find((call) => call[1]?.title?.includes('GEO SEO Report'))?.[1]
    expect(documentWrite).toMatchObject({
      orgId: 'pib-platform-owner',
      status: 'internal_draft',
      shareEnabled: false,
      linked: {
        projectId: 'UhlEQl2fsZbhfAcnKmt2',
        clientOrgId: 'pib-platform-owner',
        geoWorkspaceId: 'workspace-1',
        geoAuditId: 'audit-1',
        geoReportId: 'report-1',
        sourceDocumentId: 'spcGrC3eqoCH6fCYWmUK',
        sourceSpecVersion: 'VGrgmHtxUS30GRpvfnJC',
        evidenceRowIds: ['ev-row-1', 'ev-row-2'],
      },
    })
    const reportWrite = mockBatchSet.mock.calls.find((call) => call[1]?.documentId === 'doc-1' && call[1]?.visibility === 'internal')?.[1]
    expect(reportWrite).toMatchObject({
      status: 'internal_draft',
      visibility: 'internal',
      documentId: 'doc-1',
      documentVersionId: 'version-1',
      workspaceId: 'workspace-1',
      auditId: 'audit-1',
      projectId: 'UhlEQl2fsZbhfAcnKmt2',
      evidenceRowIds: ['ev-row-1', 'ev-row-2'],
    })
  })

  it('fails closed when publishing a GEO report without explicit approval evidence', async () => {
    mockTransactionGet.mockResolvedValue({
      exists: true,
      id: 'report-1',
      data: () => ({
        id: 'report-1',
        orgId: 'pib-platform-owner',
        documentId: 'doc-1',
        documentVersionId: 'version-1',
        status: 'internal_draft',
        visibility: 'internal',
      }),
    })

    const { POST } = await import('@/app/api/v1/geo-seo/reports/[id]/publish/route')
    const res = await POST(
      jsonRequest('http://localhost/api/v1/geo-seo/reports/report-1/publish', { orgId: 'pib-platform-owner' }),
      aiUser,
      { params: Promise.resolve({ id: 'report-1' }) },
    )
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toMatchObject({ success: false, approvalRequired: true })
    expect(mockTransactionUpdate).not.toHaveBeenCalled()
  })
})
