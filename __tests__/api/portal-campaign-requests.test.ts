import { NextRequest } from 'next/server'

const mockAdd = jest.fn()

type MockPortalRoleHandler = (
  req: NextRequest,
  uid: string,
  orgId: string,
  role: string,
) => Promise<Response> | Response

jest.mock('@/lib/auth/portal-middleware', () => ({
  withPortalAuthAndRole: (_minRole: string, handler: MockPortalRoleHandler) =>
    (req: NextRequest) => handler(req, 'uid-1', req.nextUrl.searchParams.get('orgId') || 'active-org', 'member'),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name !== 'campaign_requests') throw new Error(`Unexpected collection: ${name}`)
      return { add: mockAdd }
    },
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockAdd.mockResolvedValue({ id: 'request-1' })
})

describe('POST /api/v1/portal/campaign-requests', () => {
  it('persists CRM company source context for company-scoped campaign requests', async () => {
    const { POST } = await import('@/app/api/v1/portal/campaign-requests/route')
    const req = new NextRequest('http://localhost/api/v1/portal/campaign-requests?orgId=lumen-org', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaignType: 'social',
        title: 'Lumen launch',
        goal: 'Launch the campaign',
        audience: 'Lumen prospects',
        sourceCompanyId: 'company-1',
        sourceCompanyName: 'Lumen',
      }),
    })

    const res = await POST(req)

    expect(res.status).toBe(201)
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'lumen-org',
        sourceCompanyId: 'company-1',
        sourceCompanyName: 'Lumen',
      }),
    )
  })
})
