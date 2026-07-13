import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin' | 'client' | 'ai'; orgId?: string; allowedOrgIds?: string[] }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockCollection = jest.fn()
const mockDoc = jest.fn()
const mockGet = jest.fn()
const mockSet = jest.fn()
const mockAdd = jest.fn()

let mockUser: MockUser = { uid: 'super-1', role: 'admin' }

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
}))

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockUser = { uid: 'super-1', role: 'admin' }
  mockDoc.mockReturnValue({ get: mockGet, set: mockSet })
  mockSet.mockResolvedValue(undefined)
  mockAdd.mockResolvedValue({ id: 'stored-run-1' })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'hermes_profile_links') return { doc: mockDoc }
    if (name === 'hermes_runs') return { add: mockAdd }
    throw new Error(`Unexpected collection: ${name}`)
  })
  global.fetch = jest.fn()
})

afterEach(() => {
  jest.restoreAllMocks()
})

async function readJson(res: Response) {
  return JSON.parse(await res.text())
}

function profileDoc(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      profile: 'client-a',
      baseUrl: 'http://127.0.0.1:8651/',
      apiKey: 'secret-key',
      dashboardBaseUrl: 'http://127.0.0.1:9119/',
      dashboardSessionToken: 'dashboard-secret',
      enabled: true,
      capabilities: { runs: true, dashboard: true, cron: true, models: true, tools: true, files: true, terminal: true },
      permissions: { superAdmin: true, restrictedAdmin: true, client: false, allowedUserIds: [] },
      ...overrides,
    }),
  }
}

describe('GET /api/v1/admin/hermes/profiles/[orgId]', () => {
  it('returns a profile link without leaking apiKey', async () => {
    mockGet.mockResolvedValue(profileDoc())
    const { GET } = await import('@/app/api/v1/admin/hermes/profiles/[orgId]/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/admin/hermes/profiles/org-a'), {
      params: Promise.resolve({ orgId: 'org-a' }),
    })
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.data).toMatchObject({
      orgId: 'org-a',
      profile: 'client-a',
      baseUrl: 'http://127.0.0.1:8651',
      dashboardBaseUrl: 'http://127.0.0.1:9119',
      hasApiKey: true,
      hasDashboardSessionToken: true,
    })
    expect(body.data.apiKey).toBeUndefined()
    expect(body.data.dashboardSessionToken).toBeUndefined()
  })

  it('rejects clients when the profile client permission is switched off', async () => {
    mockUser = { uid: 'client-1', role: 'client', orgId: 'org-a' }
    mockGet.mockResolvedValue(profileDoc())
    const { GET } = await import('@/app/api/v1/admin/hermes/profiles/[orgId]/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/admin/hermes/profiles/org-a'), {
      params: Promise.resolve({ orgId: 'org-a' }),
    })
    expect(res.status).toBe(403)
  })
})

describe('PUT /api/v1/admin/hermes/profiles/[orgId]', () => {
  it('lets super admins save profile links and permission switches', async () => {
    const { PUT } = await import('@/app/api/v1/admin/hermes/profiles/[orgId]/route')
    const res = await PUT(
      new NextRequest('http://localhost/api/v1/admin/hermes/profiles/org-a', {
        method: 'PUT',
        body: JSON.stringify({
          profile: 'client-a',
          baseUrl: 'http://127.0.0.1:8651/',
          apiKey: 'new-secret',
          dashboardBaseUrl: 'http://127.0.0.1:9119/',
          dashboardSessionToken: 'new-dashboard-secret',
          enabled: true,
          capabilities: { terminal: false },
          permissions: { restrictedAdmin: true, client: true, allowedUserIds: ['u1', 'u1'] },
        }),
      }),
      { params: Promise.resolve({ orgId: 'org-a' }) },
    )
    expect(res.status).toBe(200)
    const setArg = mockSet.mock.calls[0][0]
    expect(setArg).toMatchObject({
      orgId: 'org-a',
      profile: 'client-a',
      baseUrl: 'http://127.0.0.1:8651',
      apiKey: 'new-secret',
      dashboardBaseUrl: 'http://127.0.0.1:9119',
      dashboardSessionToken: 'new-dashboard-secret',
    })
    expect(setArg.capabilities.terminal).toBe(false)
    expect(setArg.permissions.client).toBe(true)
    expect(setArg.permissions.allowedUserIds).toEqual(['u1'])
  })
})

describe('POST /api/v1/admin/hermes/profiles/[orgId]/runs', () => {
  it('proxies run creation to the linked Hermes profile and records metadata', async () => {
    mockGet.mockResolvedValue(profileDoc())
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ run_id: 'hermes-run-1', status: 'queued' }),
    })

    const { POST } = await import('@/app/api/v1/admin/hermes/profiles/[orgId]/runs/route')
    const res = await POST(
      new NextRequest('http://localhost/api/v1/admin/hermes/profiles/org-a/runs', {
        method: 'POST',
        body: JSON.stringify({ prompt: 'Write this client a weekly SEO report' }),
      }),
      { params: Promise.resolve({ orgId: 'org-a' }) },
    )

    expect(res.status).toBe(200)
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8651/v1/runs',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json', 'Authorization': 'Bearer secret-key' }),
      }),
    )
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-a', profile: 'client-a', hermesRunId: 'hermes-run-1', requestedBy: 'super-1' }))
  })

  it('never reflects a malicious nested upstream run payload', async () => {
    mockGet.mockResolvedValue(profileDoc())
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 202,
      text: async () => JSON.stringify({
        run_id: 'hermes-run-safe', status: 'unknown-secret-status',
        nested: { endpoint: 'https://gateway.example/v1/runs', authorization: 'Bearer super-secret', path: '/Users/peet/private' },
      }),
    })
    const { POST } = await import('@/app/api/v1/admin/hermes/profiles/[orgId]/runs/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/admin/hermes/profiles/org-a/runs', {
      method: 'POST', body: JSON.stringify({ prompt: 'safe' }),
    }), { params: Promise.resolve({ orgId: 'org-a' }) })
    const serialized = await res.text()
    expect(serialized).toContain('hermes-run-safe')
    expect(serialized).toContain('legacy-profile')
    expect(serialized).not.toMatch(/unknown-secret-status|gateway\.example|super-secret|Users\/peet|nested/)
  })
})
