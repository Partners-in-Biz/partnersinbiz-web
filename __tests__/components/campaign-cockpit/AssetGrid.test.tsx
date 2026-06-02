import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AssetGrid } from '@/components/campaign-cockpit/AssetGrid'

const mockRefresh = jest.fn()
type TestSocialPost = React.ComponentProps<typeof AssetGrid>['social'][number] & { orgId: string }

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

jest.mock('@/components/campaign-cockpit/VideoTriptych', () => ({
  VideoTriptych: () => <div>Video preview</div>,
}))

jest.mock('@/components/campaign-preview', () => ({
  InstagramFeedCard: ({ post }: { post: { content: string } }) => <div>{post.content}</div>,
  InstagramReelsCard: ({ post }: { post: { content: string } }) => <div>{post.content}</div>,
  InstagramStoriesCard: ({ post }: { post: { content: string } }) => <div>{post.content}</div>,
  FacebookFeedCard: ({ post }: { post: { content: string } }) => <div>{post.content}</div>,
  LinkedInPostCard: ({ post }: { post: { content: string } }) => <div>{post.content}</div>,
  TwitterPostCard: ({ post }: { post: { content: string } }) => <div>{post.content}</div>,
  YouTubeCard: ({ post }: { post: { content: string } }) => <div>{post.content}</div>,
  BlogReaderCard: ({ blog }: { blog: { title: string } }) => <div>{blog.title}</div>,
  AssetActions: ({ onApprove }: { onApprove: () => void }) => (
    <button type="button" onClick={onApprove}>
      Approve
    </button>
  ),
}))

describe('AssetGrid campaign approval actions', () => {
  beforeEach(() => {
    mockRefresh.mockClear()
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { status: 'approved' } }),
    }) as jest.Mock
  })

  it('scopes direct social approval requests to the asset organisation', async () => {
    render(
      <AssetGrid
        campaignId="campaign-1"
        social={[
          {
            id: 'post-1',
            orgId: 'org-1',
            content: 'Direct approval post',
            platform: 'linkedin',
            status: 'pending_approval',
          } as TestSocialPost,
        ]}
        blogs={[]}
        videos={[]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/social/posts/post-1/approve?orgId=org-1',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'approve' }),
        }),
      )
    })
  })

  it('uses the client approval endpoint for portal campaign approvals', async () => {
    render(
      <AssetGrid
        campaignId="campaign-1"
        approvalMode="client"
        social={[
          {
            id: 'post-1',
            orgId: 'org-1',
            content: 'Client approval post',
            platform: 'linkedin',
            status: 'pending_approval',
          } as TestSocialPost,
        ]}
        blogs={[]}
        videos={[]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/social/posts/post-1/client-approve?orgId=org-1',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({}),
        }),
      )
    })
  })
})
