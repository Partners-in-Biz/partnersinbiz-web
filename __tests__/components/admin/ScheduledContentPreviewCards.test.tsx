import { render, screen } from '@testing-library/react'
import { ScheduledContentPreviewCards, type ScheduledContentPost } from '@/components/admin/ScheduledContentPreviewCards'

const basePost: ScheduledContentPost = {
  id: 'post_1',
  status: 'scheduled',
  scheduledAt: { _seconds: 1779655200 },
  content: { text: 'Today we are launching the new client growth sprint with a quick story hook and a useful CTA.' },
  media: [{ type: 'image', url: 'https://example.com/launch.jpg' }],
}

describe('ScheduledContentPreviewCards', () => {
  it('renders today scheduled posts as channel-native card variants linked to edit or approval surfaces', () => {
    const posts: ScheduledContentPost[] = [
      { ...basePost, id: 'ig-square', platform: 'instagram', platforms: ['instagram'] },
      { ...basePost, id: 'ig-reel', platform: 'instagram', platforms: ['instagram'], media: [{ type: 'video', url: 'https://example.com/reel.mp4' }] },
      { ...basePost, id: 'ig-story', platform: 'instagram', platforms: ['instagram'], category: 'story' },
      { ...basePost, id: 'facebook', platform: 'facebook', platforms: ['facebook'] },
      { ...basePost, id: 'linkedin', platform: 'linkedin', platforms: ['linkedin'] },
      { ...basePost, id: 'x', platform: 'x', platforms: ['twitter'] },
      { ...basePost, id: 'generic', platform: 'mastodon', platforms: ['mastodon'] },
      { ...basePost, id: 'approval', status: 'pending_approval', platform: 'linkedin', platforms: ['linkedin'] },
    ]

    render(<ScheduledContentPreviewCards slug="acme" posts={posts} loading={false} />)

    expect(screen.getByText('Instagram square')).toBeInTheDocument()
    expect(screen.getByText('Instagram reel')).toBeInTheDocument()
    expect(screen.getByText('Instagram story')).toBeInTheDocument()
    expect(screen.getByText('Facebook post')).toBeInTheDocument()
    expect(screen.getByText('LinkedIn update')).toBeInTheDocument()
    expect(screen.getByText('X post')).toBeInTheDocument()
    expect(screen.getByText('Generic post')).toBeInTheDocument()

    expect(screen.getByTestId('scheduled-preview-ig-square')).toHaveAttribute('href', '/admin/org/acme/social/ig-square')
    expect(screen.getByTestId('scheduled-preview-approval')).toHaveAttribute('href', '/admin/org/acme/social/approval?approvalId=approval')
  })

  it('shows an empty state that still links to the social composer', () => {
    render(<ScheduledContentPreviewCards slug="acme" posts={[]} loading={false} />)

    expect(screen.getByText('No scheduled content today.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Compose post →' })).toHaveAttribute('href', '/admin/org/acme/social/standalone')
  })
})
