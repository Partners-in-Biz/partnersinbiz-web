import { buildSocialPublishFailureAlert } from '@/lib/social/publish-failure-alerts'

describe('buildSocialPublishFailureAlert', () => {
  it('creates a Pip-visible urgent notification for a terminal social publish failure', () => {
    const alert = buildSocialPublishFailureAlert({
      orgId: 'pib-platform-owner',
      postId: 'post-123',
      platform: 'instagram',
      campaignId: 'campaign-123',
      error: 'Instagram API publish error 400: Media ID is not available',
    })

    expect(alert.id).toBe('social-publish-failed-pib-platform-owner-post-123')
    expect(alert.doc).toMatchObject({
      orgId: 'pib-platform-owner',
      agentId: 'pip',
      userId: null,
      type: 'social.publish_failed',
      priority: 'urgent',
      status: 'unread',
      title: 'Social auto-publish failed: instagram',
      link: '/admin/org/partners-in-biz/social/campaign-123',
      data: {
        postId: 'post-123',
        campaignId: 'campaign-123',
        platform: 'instagram',
        requiredCapability: 'public-publishing',
        approvalRequired: true,
      },
    })
    expect(alert.doc.body).toContain('post-123')
    expect(alert.doc.body).toContain('Do not retry/publish publicly until an operator reviews the account/media issue.')
  })

  it('uses a resolved org slug when building the campaign link', () => {
    const alert = buildSocialPublishFailureAlert({
      orgId: 'org-lumen-123',
      orgSlug: 'lumen-speeds',
      postId: 'post-123',
      platform: 'instagram',
      campaignId: 'campaign-123',
      error: 'Publish failed',
    })

    expect(alert.doc.link).toBe('/admin/org/lumen-speeds/social/campaign-123')
  })
})
