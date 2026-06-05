import { render, screen } from '@testing-library/react'

const mockVerifySessionCookie = jest.fn()
const mockCookies = jest.fn()
const mockUserDoc = jest.fn()
const mockOrgDoc = jest.fn()
const mockCollection = jest.fn()
const mockLoadCampaignWithAssets = jest.fn()
const mockCanUsePortalOrg = jest.fn()
const mockCockpitClient = jest.fn(
  ({
    campaignId,
    orgName,
    brand,
  }: {
    campaignId: string
    orgName: string
    brand?: { name?: string }
  }) => (
    <div
      data-testid="campaign-cockpit"
      data-campaign-id={campaignId}
      data-org-name={orgName}
      data-brand-name={brand?.name ?? ''}
    />
  ),
)
const mockToPreviewBrand = jest.fn()

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

jest.mock('@/lib/campaigns/load', () => ({
  loadCampaignWithAssets: (...args: unknown[]) => mockLoadCampaignWithAssets(...args),
}))

jest.mock('@/app/(portal)/portal/campaigns/[id]/cockpit-client', () => ({
  CockpitClient: (props: { campaignId: string; orgName: string; brand?: { name?: string } }) =>
    mockCockpitClient(props),
}))

jest.mock('@/lib/organizations/toPreviewBrand', () => ({
  toPreviewBrand: (...args: unknown[]) => mockToPreviewBrand(...args),
}))

describe('portal campaign detail org scope', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    mockToPreviewBrand.mockImplementation((brandColors, brandProfile, orgName) => ({
      name: orgName,
      palette: {
        bg: '#0A0A0B',
        accent: '#F5A623',
        alert: '#F59E0B',
        text: '#EDEDED',
      },
      brandColors,
      brandProfile,
    }))
    mockVerifySessionCookie.mockResolvedValue({ uid: 'admin-1' })
    mockCookies.mockResolvedValue({ get: () => ({ value: 'session' }) })
    mockCanUsePortalOrg.mockResolvedValue(true)
    mockUserDoc.mockReturnValue({
      get: async () => ({
        exists: true,
        data: () => ({ role: 'admin', orgId: 'platform-org' }),
      }),
    })
    mockOrgDoc.mockReturnValue({
      get: async () => ({
        exists: true,
        data: () => ({
          name: 'Lumen',
          settings: { brandColors: { primary: '#111111', accent: '#F5A623' } },
          brandProfile: {},
        }),
      }),
    })
    mockCollection.mockImplementation((name: string) => {
      if (name === 'users') return { doc: mockUserDoc }
      if (name === 'organizations') return { doc: mockOrgDoc }
      return { doc: () => ({ get: async () => ({ exists: false }) }) }
    })
    mockLoadCampaignWithAssets.mockResolvedValue({
      campaign: {
        id: 'campaign-1',
        orgId: 'lumen-org',
        name: 'Lumen launch',
        status: 'active',
        clientType: 'retainer',
      },
      assets: {},
    })
  })

  it('allows a company-scoped portal campaign detail when the admin can access that organisation', async () => {
    jest.doMock('@/lib/portal/org-access', () => ({
      canUsePortalOrg: mockCanUsePortalOrg,
    }))
    const Page = (await import('@/app/(portal)/portal/campaigns/[id]/page')).default

    const result = await Page({
      params: Promise.resolve({ id: 'campaign-1' }),
      searchParams: Promise.resolve({ orgId: 'lumen-org', orgSlug: 'lumen-speeds' }),
    } as never)

    expect(result).toBeTruthy()
    render(result)
    expect(screen.getByTestId('campaign-cockpit')).toHaveAttribute('data-brand-name', 'Lumen')
    expect(mockCanUsePortalOrg).toHaveBeenCalledWith('admin-1', expect.objectContaining({ orgId: 'platform-org' }), 'lumen-org')
    expect(mockOrgDoc).toHaveBeenCalledWith('lumen-org')
    expect(mockToPreviewBrand).toHaveBeenCalledWith(
      { primary: '#111111', accent: '#F5A623' },
      {},
      'Lumen',
    )
  })
})
