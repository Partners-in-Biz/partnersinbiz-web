import { fireEvent, render, screen } from '@testing-library/react'
import { CampaignCockpitClient } from '@/components/campaign-cockpit/CampaignCockpitClient'

const refresh = jest.fn()
const replace = jest.fn()
let searchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, replace }),
  useSearchParams: () => searchParams,
}))

const baseProps = {
  campaignId: 'campaign-1',
  campaign: {
    description: 'June campaign for high-value leads',
    research: { taglines: { master: 'Make every lead count' } },
  },
  assets: {
    blogs: [],
    videos: [],
    social: [
      {
        id: 'social-1',
        platform: 'linkedin',
        caption: 'LinkedIn launch post',
        status: 'pending_approval',
      },
    ],
    meta: { byStatus: { pending_approval: 1 } },
  },
  brand: undefined,
  orgName: 'Lumen',
  monthLabel: 'June 2026',
  shareEnabled: false,
  backHref: '/admin/org/lumen/social',
  backLabel: 'Lumen',
  basePath: '/admin/org/lumen/social/campaign-1',
  blogHref: (blogId: string) => `/admin/org/lumen/social/campaign-1/blog/${blogId}`,
}

describe('CampaignCockpitClient', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    searchParams = new URLSearchParams()
  })

  it('routes admin-scoped cockpit tabs through the provided base path', () => {
    render(<CampaignCockpitClient {...baseProps} />)

    expect(screen.getByRole('link', { name: /Lumen/ })).toHaveAttribute('href', '/admin/org/lumen/social')
    expect(screen.getByRole('tab', { name: /Twitter \/ X/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Bluesky/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Pinterest/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /LinkedIn/ }))

    expect(replace).toHaveBeenCalledWith('/admin/org/lumen/social/campaign-1?tab=linkedin')
  })

  it('uses the supplied blog route builder for campaign blog cards', () => {
    searchParams = new URLSearchParams('tab=blogs')

    render(
      <CampaignCockpitClient
        {...baseProps}
        assets={{
          ...baseProps.assets,
          blogs: [
            {
              id: 'blog-1',
              title: 'How Lumen Wins Local Search',
              status: 'draft',
              draft: {
                body: 'Practical search content.',
                wordCount: 430,
              },
            },
          ],
        }}
      />,
    )

    expect(screen.getByRole('link', { name: /How Lumen Wins Local Search/ })).toHaveAttribute(
      'href',
      '/admin/org/lumen/social/campaign-1/blog/blog-1',
    )
  })
})
