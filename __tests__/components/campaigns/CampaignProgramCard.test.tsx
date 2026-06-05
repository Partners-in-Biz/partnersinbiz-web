import { render, screen } from '@testing-library/react'
import { CampaignProgramCard } from '@/components/campaigns/CampaignProgramCard'

describe('CampaignProgramCard', () => {
  it('renders a reusable rich campaign card with review state, route, and asset counts', () => {
    render(
      <CampaignProgramCard
        href="/admin/org/lumen/social/campaign-1"
        campaign={{
          id: 'campaign-1',
          name: 'Lumen June Growth Campaign',
          status: 'in_review',
          createdAt: '2026-06-04T10:00:00.000Z',
          assetCounts: {
            socialPosts: 12,
            blogPosts: 4,
            shorts: 2,
          },
        }}
      />,
    )

    expect(screen.getByRole('link', { name: /Lumen June Growth Campaign/ })).toHaveAttribute(
      'href',
      '/admin/org/lumen/social/campaign-1',
    )
    expect(screen.getByText('Awaiting review')).toBeInTheDocument()
    expect(screen.getByText('June 2026')).toBeInTheDocument()
    expect(screen.getByText('12 social · 4 blogs · 2 videos')).toBeInTheDocument()
  })
})
