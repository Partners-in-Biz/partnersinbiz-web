import { render, screen } from '@testing-library/react'

const mockCampaignCockpitClient = jest.fn((props: Record<string, unknown>) => (
  <div data-testid="campaign-cockpit">{String(props.basePath)}</div>
))
const mockLoadCampaignWithAssets = jest.fn()
const mockResolveOrgIdBySlug = jest.fn()
const mockOrgGet = jest.fn()
const mockCollection = jest.fn((name: string) => {
  void name
  return {
    doc: jest.fn(() => ({
      get: mockOrgGet,
    })),
  }
})

jest.mock('@/components/campaign-cockpit/CampaignCockpitClient', () => ({
  CampaignCockpitClient: (props: Record<string, unknown>) => mockCampaignCockpitClient(props),
}))

jest.mock('@/lib/campaigns/load', () => ({
  loadCampaignWithAssets: (id: string) => mockLoadCampaignWithAssets(id),
}))

jest.mock('@/lib/organizations/resolve-by-slug', () => ({
  resolveOrgIdBySlug: (slug: string) => mockResolveOrgIdBySlug(slug),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => mockCollection(name),
  },
}))

jest.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found')
  },
}))

describe('admin org social campaign page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveOrgIdBySlug.mockResolvedValue('org-lumen')
    mockLoadCampaignWithAssets.mockResolvedValue({
      campaign: {
        id: 'campaign-1',
        orgId: 'org-lumen',
        description: 'June campaign',
        createdAt: '2026-06-01T00:00:00.000Z',
        shareEnabled: true,
      },
      assets: { blogs: [], videos: [], social: [], meta: { byStatus: { pending_approval: 0 } } },
    })
    mockOrgGet.mockResolvedValue({
      data: () => ({
        name: 'Lumen',
        settings: {
          brandColors: {
            accent: '#F5A623',
          },
        },
        brandProfile: {},
      }),
    })
  })

  it('passes only serializable props into the shared campaign cockpit client', async () => {
    const { default: OrgSocialCampaignPage } = await import('@/app/(admin)/admin/org/[slug]/social/[id]/page')
    const element = await OrgSocialCampaignPage({
      params: Promise.resolve({ slug: 'lumen', id: 'campaign-1' }),
    })

    render(element)

    expect(screen.getByTestId('campaign-cockpit')).toHaveTextContent('/admin/org/lumen/social/campaign-1')
    expect(mockCampaignCockpitClient).toHaveBeenCalledTimes(1)
    const props = mockCampaignCockpitClient.mock.calls[0][0]
    expect(props).not.toHaveProperty('blogHref')
    expect(Object.entries(props).filter(([, value]) => typeof value === 'function')).toEqual([])
  })
})
