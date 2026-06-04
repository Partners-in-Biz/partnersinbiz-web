const mockVerifySessionCookie = jest.fn()
const mockCookies = jest.fn()
const mockUserDoc = jest.fn()
const mockCollection = jest.fn()
const mockCanUsePortalOrg = jest.fn()
const mockResolvePortalActiveOrgId = jest.fn()

jest.mock('next/headers', () => ({
  cookies: () => mockCookies(),
}))

jest.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound')
  },
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: mockVerifySessionCookie },
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/portal/org-access', () => ({
  canUsePortalOrg: (...args: unknown[]) => mockCanUsePortalOrg(...args),
  resolvePortalActiveOrgId: (...args: unknown[]) => mockResolvePortalActiveOrgId(...args),
}))

jest.mock(
  '@/app/(portal)/portal/seo/sprints/[id]/PortalSeoSprintChrome',
  () => ({
    PortalSeoSprintChrome: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  }),
  { virtual: true },
)

function queryDocsFor(name: string) {
  if (name === 'seo_tasks') {
    return [
      { data: () => ({ status: 'done' }) },
      { data: () => ({ status: 'todo' }) },
    ]
  }
  if (name === 'seo_keywords') return [{ data: () => ({ status: 'ranking' }) }]
  if (name === 'seo_content') return [{ data: () => ({ status: 'live' }) }]
  return []
}

function queryCollection(name: string) {
  if (name === 'users') return { doc: mockUserDoc }
  if (name === 'seo_sprints') {
    return {
      doc: () => ({
        get: async () => ({
          exists: true,
          data: () => ({
            orgId: 'lumen-org',
            siteName: 'Lumen',
            siteUrl: 'https://lumenspeeds.com',
            currentDay: 12,
            currentPhase: 1,
          }),
        }),
      }),
    }
  }

  const chain = {
    where() {
      return chain
    },
    async get() {
      return { docs: queryDocsFor(name) }
    },
  }

  return chain
}

describe('portal SEO sprint layout scope', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    mockVerifySessionCookie.mockResolvedValue({ uid: 'admin-1' })
    mockCookies.mockResolvedValue({ get: () => ({ value: 'session' }) })
    mockCanUsePortalOrg.mockResolvedValue(true)
    mockResolvePortalActiveOrgId.mockResolvedValue('platform-org')
    mockUserDoc.mockReturnValue({
      get: async () => ({
        exists: true,
        data: () => ({ role: 'admin', orgId: 'platform-org', activeOrgId: 'platform-org' }),
      }),
    })
    mockCollection.mockImplementation(queryCollection)
  })

  it('checks portal access against the sprint organisation before rendering', async () => {
    const Layout = (await import('@/app/(portal)/portal/seo/sprints/[id]/layout')).default

    await expect(
      Layout({
        params: Promise.resolve({ id: 'lumen-sprint' }),
        children: <div>Daily plan</div>,
      }),
    ).resolves.toBeTruthy()

    expect(mockCanUsePortalOrg).toHaveBeenCalledWith(
      'admin-1',
      expect.objectContaining({ orgId: 'platform-org' }),
      'lumen-org',
    )
  })
})
