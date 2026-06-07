import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockOrgGet = jest.fn()
const mockMobileAppsGet = jest.fn()

type MockPortalRoleHandler = (
  req: NextRequest,
  uid: string,
  orgId: string,
  role: string,
) => Promise<Response> | Response

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/auth/portal-middleware', () => ({
  withPortalAuthAndRole: (_minRole: string, handler: MockPortalRoleHandler) =>
    (req: NextRequest) => handler(req, 'uid-1', req.nextUrl.searchParams.get('orgId') || 'org-1', 'viewer'),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}))

function stageCollections(settings: Record<string, unknown> = {}) {
  mockOrgGet.mockResolvedValue({
    exists: true,
    data: () => ({ settings }),
  })
  mockMobileAppsGet.mockResolvedValue({
    docs: [
      {
        id: 'app-1',
        data: () => ({
          orgId: 'org-1',
          name: 'Client App',
          platform: 'ios',
          status: 'live',
          visibility: { showInClientPortal: true },
        }),
      },
      {
        id: 'app-hidden',
        data: () => ({
          orgId: 'org-1',
          name: 'Hidden App',
          platform: 'android',
          status: 'live',
          visibility: { showInClientPortal: false },
        }),
      },
    ],
  })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') {
      return { doc: () => ({ get: mockOrgGet }) }
    }
    if (name === 'mobile_apps') {
      return {
        where: jest.fn().mockReturnValue({ get: mockMobileAppsGet }),
      }
    }
    throw new Error(`Unexpected collection: ${name}`)
  })
}

describe('GET /api/v1/portal/mobile-apps', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    stageCollections()
  })

  it('keeps Mobile Apps visible by default when no portal module setting is stored', async () => {
    const { GET } = await import('@/app/api/v1/portal/mobile-apps/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/mobile-apps'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockMobileAppsGet).toHaveBeenCalledTimes(1)
    expect(body.data.apps).toHaveLength(1)
    expect(body.data.apps[0]).toMatchObject({ id: 'app-1', name: 'Client App' })
  })

  it('blocks portal Mobile Apps access when the organisation disables the module', async () => {
    stageCollections({ portalModules: { mobileApps: false } })

    const { GET } = await import('@/app/api/v1/portal/mobile-apps/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/mobile-apps'))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toMatchObject({
      success: false,
      moduleDisabled: true,
      module: 'mobileApps',
    })
    expect(mockMobileAppsGet).not.toHaveBeenCalled()
  })
})
