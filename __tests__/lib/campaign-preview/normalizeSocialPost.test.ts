import { toPreviewSocialPost, primaryPlatformOf } from '@/lib/campaign-preview/normalizeSocialPost'

describe('normalizeSocialPost', () => {
  it('maps enhanced social_posts shape onto PreviewSocialPost', () => {
    expect(toPreviewSocialPost({
      id: 'post-1',
      content: { text: 'Launch week is live', platformOverrides: {} },
      platforms: ['instagram', 'facebook'],
      hashtags: ['launch'],
      status: 'pending_approval',
      media: [{ type: 'image', url: 'https://cdn.example.com/a.jpg', altText: 'Hero' }],
      format: 'story',
      campaignId: 'camp-1',
      threadParts: ['Part one', 'Part two'],
      scheduledAt: '2026-07-23T10:00:00.000Z',
    })).toEqual({
      id: 'post-1',
      content: 'Launch week is live',
      platform: 'instagram',
      hashtags: ['launch'],
      status: 'pending_approval',
      media: [{ type: 'image', url: 'https://cdn.example.com/a.jpg', alt: 'Hero' }],
      format: 'story',
      campaignId: 'camp-1',
      thread: ['Part one', 'Part two'],
      scheduledFor: '2026-07-23T10:00:00.000Z',
    })
  })

  it('falls back to legacy string content and singular platform', () => {
    expect(toPreviewSocialPost({
      id: 'legacy-1',
      content: 'Hello LinkedIn',
      platform: 'linkedin',
      status: 'draft',
    })).toMatchObject({
      id: 'legacy-1',
      content: 'Hello LinkedIn',
      platform: 'linkedin',
      status: 'draft',
    })
  })

  it('reads primary platform from platforms[] when platform is absent', () => {
    expect(primaryPlatformOf({ platforms: ['x', 'linkedin'] })).toBe('x')
    expect(primaryPlatformOf({ platform: 'facebook' })).toBe('facebook')
    expect(primaryPlatformOf({})).toBe('linkedin')
  })
})
