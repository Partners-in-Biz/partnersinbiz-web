import { render, screen } from '@testing-library/react'

import { InstagramReelsCard } from '@/components/campaign-preview/InstagramReelsCard'
import type { PreviewSocialPost } from '@/components/campaign-preview/types'

describe('InstagramReelsCard', () => {
  it('keeps video controls playable under the preview chrome', () => {
    const post: PreviewSocialPost = {
      id: 'post-1',
      platform: 'instagram',
      content:
        'Capture the lead\nAttach the campaign\nMeasure the source\nBrief the next task\nReport the outcome\n\nNo more tool-hopping.',
      hashtags: ['PartnersInBiz', 'AIAgents', 'MarketingAutomation'],
      media: [
        {
          type: 'video',
          url: 'https://example.com/reel.mp4',
          thumbnailUrl: 'https://example.com/reel.jpg',
        },
      ],
      authorHandle: 'partnersinbiz',
    }

    render(<InstagramReelsCard post={post} />)

    expect(screen.getByLabelText('Instagram reel video preview')).toHaveAttribute('controls')
    expect(screen.getByTestId('instagram-reels-caption-overlay')).toHaveStyle({
      bottom: '64px',
      pointerEvents: 'none',
    })
    expect(screen.getByTestId('instagram-reels-right-rail')).toHaveStyle({
      bottom: '128px',
      pointerEvents: 'none',
    })
  })
})
