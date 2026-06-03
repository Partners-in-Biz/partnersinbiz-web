import React from 'react'
import { render, screen } from '@testing-library/react'
import { VideoTriptych } from '@/components/campaign-cockpit/VideoTriptych'

jest.mock('@/components/campaign-preview', () => ({
  InstagramReelsCard: () => <div data-testid="reel-card">Reel</div>,
  InstagramStoriesCard: () => <div data-testid="stories-card">Stories</div>,
  YouTubeCard: () => <div data-testid="youtube-card">YouTube</div>,
}))

describe('VideoTriptych preview containment', () => {
  it('keeps each video format inside a shrinkable overflow-safe grid column', () => {
    render(
      <VideoTriptych
        post={{
          id: 'video-1',
          platform: 'instagram',
          content: 'Campaign video',
          media: [{
            type: 'video',
            url: 'https://cdn.example.com/reel.mp4',
            urlYoutube: 'https://cdn.example.com/youtube.mp4',
            urlStories: 'https://cdn.example.com/stories.mp4',
          }],
        }}
      />,
    )

    const reelColumn = screen.getByText('Reel · 9:16').closest('div')
    const youtubeColumn = screen.getByText('YouTube · 16:9').closest('div')
    const storiesColumn = screen.getByText('Stories · 15s').closest('div')

    for (const column of [reelColumn, youtubeColumn, storiesColumn]) {
      expect(column).toHaveClass('min-w-0')
      expect(column).toHaveClass('overflow-hidden')
    }
  })
})
