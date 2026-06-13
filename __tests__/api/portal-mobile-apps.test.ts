import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockOrgGet = jest.fn()
const mockMobileAppsGet = jest.fn()
const mockMobileAppDocGet = jest.fn()
const mockMobileAppSet = jest.fn()
const mockMobileAppAdd = jest.fn()

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
  mockMobileAppSet.mockResolvedValue(undefined)
  mockMobileAppAdd.mockResolvedValue({ id: 'app-new' })
  mockMobileAppDocGet.mockResolvedValue({
    exists: true,
    id: 'app-1',
    data: () => ({
      orgId: 'org-1',
      name: 'Client App',
      platform: 'ios',
      status: 'live',
      visibility: { showInClientPortal: true },
      profileLinks: [],
    }),
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
          profileLinks: [],
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
        doc: jest.fn(() => ({ get: mockMobileAppDocGet, set: mockMobileAppSet })),
        add: mockMobileAppAdd,
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

describe('PUT /api/v1/portal/mobile-apps', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    stageCollections()
  })

  it('appends a client-linked mobile app profile to an existing app in the active org', async () => {
    const { PUT } = await import('@/app/api/v1/portal/mobile-apps/route')
    const res = await PUT(new NextRequest('http://localhost/api/v1/portal/mobile-apps', {
      method: 'PUT',
      body: JSON.stringify({
        id: 'app-1',
        profileLink: {
          type: 'store_account',
          label: 'Acme Google Play Console',
          platform: 'android',
          url: ' https://play.google.com/console/u/0/developers/123 ',
          accountId: 'developers/123',
          notes: 'Owner login shared with the marketing lead',
        },
      }),
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toMatchObject({ id: 'app-1', updated: true })
    expect(mockMobileAppSet).toHaveBeenCalledWith(expect.objectContaining({
      profileLinks: [expect.objectContaining({
        type: 'store_account',
        label: 'Acme Google Play Console',
        platform: 'android',
        url: 'https://play.google.com/console/u/0/developers/123',
        accountId: 'developers/123',
        status: 'linked',
        linkedBy: 'uid-1',
      })],
      updatedBy: 'uid-1',
      updatedByType: 'user',
    }), { merge: true })
  })

  it('keeps profile linking tenant-safe by rejecting app ids from another org', async () => {
    mockMobileAppDocGet.mockResolvedValue({
      exists: true,
      id: 'app-other',
      data: () => ({ orgId: 'org-other', name: 'Other App', platform: 'ios', status: 'live' }),
    })

    const { PUT } = await import('@/app/api/v1/portal/mobile-apps/route')
    const res = await PUT(new NextRequest('http://localhost/api/v1/portal/mobile-apps', {
      method: 'PUT',
      body: JSON.stringify({ id: 'app-other', profileLink: { label: 'Other account' } }),
    }))

    expect(res.status).toBe(403)
    expect(mockMobileAppSet).not.toHaveBeenCalled()
  })

  it('blocks portal Mobile Apps feedback updates when the organisation disables the module', async () => {
    stageCollections({ portalModules: { mobileApps: false } })

    const { PUT } = await import('@/app/api/v1/portal/mobile-apps/route')
    const res = await PUT(new NextRequest('http://localhost/api/v1/portal/mobile-apps', {
      method: 'PUT',
      body: JSON.stringify({ id: 'app-1', clientNotes: 'Looks good' }),
    }))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toMatchObject({
      success: false,
      moduleDisabled: true,
      module: 'mobileApps',
    })
    expect(mockCollection).not.toHaveBeenCalledWith('mobile_apps')
    expect(mockMobileAppsGet).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/portal/mobile-apps', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    stageCollections()
  })

  it('creates an org-scoped mobile app placeholder when a client links the first profile from the portal', async () => {
    const { POST } = await import('@/app/api/v1/portal/mobile-apps/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/portal/mobile-apps', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-other-ignored',
        appName: 'Client App Android',
        platform: 'android',
        profileLink: {
          type: 'developer_account',
          label: 'Google Play developer account',
          accountId: 'dev-123',
        },
      }),
    }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data).toMatchObject({ id: 'app-new', created: true })
    expect(mockMobileAppAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      name: 'Client App Android',
      platform: 'android',
      status: 'planned',
      profileLinks: [expect.objectContaining({
        type: 'developer_account',
        label: 'Google Play developer account',
        accountId: 'dev-123',
        status: 'linked',
        linkedBy: 'uid-1',
      })],
      createdBy: 'uid-1',
      createdByType: 'user',
    }))
  })
})
