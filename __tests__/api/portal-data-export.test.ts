import { NextRequest } from 'next/server'

const mockListMetrics = jest.fn()
const mockLogActivity = jest.fn()
const mockBuildLifeOsExport = jest.fn()
const mockRequestLifeOsDelete = jest.fn()
const mockDeleteOrAnonymiseLifeOsUserData = jest.fn()

type MockPortalRoleHandler = (
  req: NextRequest,
  uid: string,
  orgId: string,
  role: string,
) => Promise<Response> | Response

jest.mock('@/lib/auth/portal-middleware', () => ({
  withPortalAuthAndRole: (_minRole: string, handler: MockPortalRoleHandler) =>
    (req: NextRequest) => handler(req, 'uid-1', req.nextUrl.searchParams.get('orgId') || 'active-org', 'viewer'),
}))

jest.mock('@/lib/metrics/query', () => ({
  listMetrics: (...args: unknown[]) => mockListMetrics(...args),
}))

jest.mock('@/lib/activity/log', () => ({
  logActivity: (...args: unknown[]) => mockLogActivity(...args),
}))

jest.mock('@/lib/privacy/life-os-user-data', () => ({
  buildLifeOsExport: (...args: unknown[]) => mockBuildLifeOsExport(...args),
  requestLifeOsDelete: (...args: unknown[]) => mockRequestLifeOsDelete(...args),
  deleteOrAnonymiseLifeOsUserData: (...args: unknown[]) => mockDeleteOrAnonymiseLifeOsUserData(...args),
}))

jest.mock('@/lib/privacy/life-os-user-data-firestore', () => ({
  FirestoreLifeOsUserDataStore: jest.fn(() => ({ store: 'life-os-store' })),
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockListMetrics.mockResolvedValue([
    {
      date: '2026-06-01',
      propertyId: 'prop-1',
      source: 'ga4',
      metric: 'sessions',
      value: 42,
      currency: 'ZAR',
      valueZar: 42,
    },
  ])
  mockBuildLifeOsExport.mockResolvedValue({
    lifeOs: {
      schemaVersion: '2026-06-15.life-os-user-export.v1',
      families: {
        profile: { label: 'Profile and first-run baseline', collections: ['life_os_profiles'], count: 1, records: [{ id: 'profile-1', collection: 'life_os_profiles', data: { orgId: 'lumen-org', ownerUid: 'uid-1', firstRun: { goals: ['private goal'] } } }] },
      },
    },
  })
  mockRequestLifeOsDelete.mockResolvedValue({ orgId: 'lumen-org', ownerUid: 'uid-1', requestedAt: '2026-06-15T09:00:00.000Z', auditId: 'audit-delete-request' })
  mockDeleteOrAnonymiseLifeOsUserData.mockResolvedValue({ orgId: 'lumen-org', ownerUid: 'uid-1', requestedAt: '2026-06-15T09:05:00.000Z', auditId: 'audit-delete-complete', totals: { deleted: 2, anonymised: 1, skipped: 0 }, collections: {} })
})

describe('GET /api/v1/portal/data-export', () => {
  it('exports metrics from the requested authorized company workspace', async () => {
    const { GET } = await import('@/app/api/v1/portal/data-export/route')
    const req = new NextRequest(
      'http://localhost/api/v1/portal/data-export?format=json&from=2026-05-01&to=2026-06-01&orgId=lumen-org',
    )

    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockListMetrics).toHaveBeenCalledWith({ orgId: 'lumen-org', from: '2026-05-01', to: '2026-06-01' })
    expect(body.orgId).toBe('lumen-org')
    expect(body.lifeOs.families.profile.records[0].data.firstRun.goals).toEqual(['private goal'])
    expect(mockBuildLifeOsExport).toHaveBeenCalledWith({ store: 'life-os-store' }, expect.objectContaining({
      orgId: 'lumen-org',
      ownerUid: 'uid-1',
      actorUid: 'uid-1',
    }))
    expect(mockLogActivity).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'lumen-org',
      type: 'portal_data_exported',
      actorId: 'uid-1',
      entityType: 'metrics_export',
    }))
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('content-disposition')).toContain('pib-metrics-lumen-org-2026-05-01-to-2026-06-01.json')
  })


  it('records redacted Life OS delete requests and delete completion under the active user scope', async () => {
    const { POST, DELETE } = await import('@/app/api/v1/portal/data-export/route')
    const postRes = await POST(new NextRequest('http://localhost/api/v1/portal/data-export?orgId=lumen-org', { method: 'POST' }))
    const postBody = await postRes.json()

    expect(postRes.status).toBe(202)
    expect(postBody.data).toMatchObject({ status: 'requested', auditId: 'audit-delete-request' })
    expect(mockRequestLifeOsDelete).toHaveBeenCalledWith({ store: 'life-os-store' }, expect.objectContaining({
      orgId: 'lumen-org',
      ownerUid: 'uid-1',
      actorUid: 'uid-1',
    }))
    expect(JSON.stringify(mockLogActivity.mock.calls)).not.toContain('private goal')

    const deleteRes = await DELETE(new NextRequest('http://localhost/api/v1/portal/data-export?orgId=lumen-org', { method: 'DELETE' }))
    const deleteBody = await deleteRes.json()

    expect(deleteRes.status).toBe(200)
    expect(deleteBody.data.totals).toEqual({ deleted: 2, anonymised: 1, skipped: 0 })
    expect(mockDeleteOrAnonymiseLifeOsUserData).toHaveBeenCalledWith({ store: 'life-os-store' }, expect.objectContaining({
      orgId: 'lumen-org',
      ownerUid: 'uid-1',
      actorUid: 'uid-1',
    }))
  })
})
