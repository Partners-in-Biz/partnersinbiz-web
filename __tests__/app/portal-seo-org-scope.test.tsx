import type { ReactElement } from 'react'

const mockVerifySessionCookie = jest.fn()
const mockCookies = jest.fn()
const mockUserDoc = jest.fn()
const mockCollection = jest.fn()
const mockCanUsePortalOrg = jest.fn()
const mockResolvePortalActiveOrgId = jest.fn()
const mockLoadSeoOverviewStats = jest.fn()
const whereCalls: Array<[string, string, unknown]> = []

jest.mock('next/headers', () => ({
  cookies: () => mockCookies(),
}))

jest.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
  notFound: () => {
    throw new Error('notFound')
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

jest.mock('@/lib/seo/overview', () => ({
  loadSeoOverviewStats: (...args: unknown[]) => mockLoadSeoOverviewStats(...args),
}))

function queryCollection(name: string) {
  if (name === 'users') return { doc: mockUserDoc }

  const chain = {
    where(field: string, op: string, value: unknown) {
      whereCalls.push([field, op, value])
      return chain
    },
    async get() {
      return {
        docs: [
          {
            id: 'lumen-sprint',
            data: () => ({
              orgId: 'lumen-org',
              siteName: 'Lumen',
              siteUrl: 'https://lumenspeeds.com',
              currentDay: 12,
              currentPhase: 1,
              createdAt: { toMillis: () => 1000 },
              health: { signals: [] },
            }),
          },
        ],
      }
    },
  }

  return chain
}

describe('portal SEO org scope', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    whereCalls.length = 0
    mockVerifySessionCookie.mockResolvedValue({ uid: 'admin-1' })
    mockCookies.mockResolvedValue({ get: () => ({ value: 'session' }) })
    mockCanUsePortalOrg.mockResolvedValue(true)
    mockResolvePortalActiveOrgId.mockResolvedValue('platform-org')
    mockLoadSeoOverviewStats.mockResolvedValue(undefined)
    mockUserDoc.mockReturnValue({
      get: async () => ({
        exists: true,
        data: () => ({ role: 'admin', orgId: 'platform-org', activeOrgId: 'platform-org' }),
      }),
    })
    mockCollection.mockImplementation(queryCollection)
  })

  it('loads SEO sprints for the requested company workspace org', async () => {
    const Page = (await import('@/app/(portal)/portal/seo/page')).default

    const result = (await Page({
      searchParams: Promise.resolve({ orgId: 'lumen-org', orgSlug: 'lumen-speeds' }),
    } as never)) as ReactElement<{ sprintHref?: (sprint: { id: string }, childPath?: string) => string }>

    expect(mockCanUsePortalOrg).toHaveBeenCalledWith(
      'admin-1',
      expect.objectContaining({ orgId: 'platform-org' }),
      'lumen-org',
    )
    expect(whereCalls).toContainEqual(['orgId', '==', 'lumen-org'])
    expect(whereCalls).not.toContainEqual(['orgId', '==', 'platform-org'])
    expect(result.props.sprintHref?.({ id: 'lumen-sprint' })).toBe(
      '/portal/seo/sprints/lumen-sprint?orgId=lumen-org&orgSlug=lumen-speeds',
    )
    expect(result.props.sprintHref?.({ id: 'lumen-sprint' }, '/keywords')).toBe(
      '/portal/seo/sprints/lumen-sprint/keywords?orgId=lumen-org&orgSlug=lumen-speeds',
    )
  })
})
