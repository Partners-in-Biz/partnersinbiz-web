import { NextRequest } from 'next/server'

const mockListMetrics = jest.fn()
const mockLogActivity = jest.fn()

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
    expect(mockLogActivity).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'lumen-org',
      type: 'portal_data_exported',
      actorId: 'uid-1',
      entityType: 'metrics_export',
    }))
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('content-disposition')).toContain('pib-metrics-lumen-org-2026-05-01-to-2026-06-01.json')
  })
})
