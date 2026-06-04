import { readFileSync } from 'fs'
import path from 'path'

const mockLoadCampaignWithAssets = jest.fn()
const mockResolveOrgSlugForLink = jest.fn()
const mockRedirect = jest.fn((url: string) => {
  throw new Error(`redirect:${url}`)
})

jest.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound')
  },
  redirect: (url: string) => mockRedirect(url),
}))

jest.mock('@/lib/campaigns/load', () => ({
  loadCampaignWithAssets: (id: string) => mockLoadCampaignWithAssets(id),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn() },
}))

jest.mock('@/lib/projects/links', () => ({
  resolveOrgSlugForLink: (...args: unknown[]) => mockResolveOrgSlugForLink(...args),
}))

jest.mock('@/components/campaign-cockpit/AssetGrid', () => ({
  AssetGrid: () => null,
}))

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('admin campaign detail canonical cockpit route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLoadCampaignWithAssets.mockResolvedValue({
      campaign: {
        id: 'campaign-1',
        orgId: 'org-lumen',
        description: 'June campaign',
      },
      assets: { blogs: [], videos: [], social: [] },
    })
    mockResolveOrgSlugForLink.mockResolvedValue('lumen-speeds')
  })

  it('redirects the global admin campaign detail into the org-scoped shared cockpit', async () => {
    const { default: CampaignOverviewPage } = await import('@/app/(admin)/admin/campaigns/[id]/page')

    await expect(
      CampaignOverviewPage({ params: Promise.resolve({ id: 'campaign-1' }) }),
    ).rejects.toThrow('redirect:/admin/org/lumen-speeds/social/campaign-1')

    expect(mockLoadCampaignWithAssets).toHaveBeenCalledWith('campaign-1')
    expect(mockResolveOrgSlugForLink).toHaveBeenCalledWith(expect.any(Object), 'org-lumen')
  })

  it('does not keep a second campaign detail UI on the global admin route', () => {
    const globalCampaignDetail = source('app/(admin)/admin/campaigns/[id]/page.tsx')

    expect(globalCampaignDetail).not.toContain('@/components/campaign-cockpit/AssetGrid')
    expect(globalCampaignDetail).not.toContain('function Stat')
    expect(globalCampaignDetail).toContain('redirect(')
  })
})
