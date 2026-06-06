'use client'

import { useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { CampaignBlogDetailWorkspace } from '@/components/campaign-blog-detail/CampaignBlogDetailWorkspace'
import { useCampaignBlogDetail } from '@/components/campaign-blog-detail/useCampaignBlogDetail'
import { scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

function paramValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

export default function PortalCampaignBlogDetailPage() {
  const params = useParams()
  const campaignId = paramValue(params?.id)
  const blogId = paramValue(params?.blogId)

  return <PortalCampaignBlogDetail campaignId={campaignId} blogId={blogId} />
}

function PortalCampaignBlogDetail({
  campaignId,
  blogId,
}: {
  campaignId: string
  blogId: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [approvalBusy, setApprovalBusy] = useState(false)
  const [approvalError, setApprovalError] = useState<string | null>(null)
  const orgScope = scopeFromSearchParams(searchParams)
  const campaignAssetsEndpoint = scopedApiPath(`/api/v1/campaigns/${campaignId}/assets`, orgScope)
  const commentsEndpoint = scopedApiPath(`/api/v1/seo/content/${blogId}/comments`, orgScope)
  const approveEndpoint = scopedApiPath(`/api/v1/seo/content/${blogId}/client-approve`, orgScope)
  const {
    blog,
    setBlog,
    comments,
    loading,
    loadError,
    actionError,
    busy: commentBusy,
    postComment,
  } = useCampaignBlogDetail({
    campaignId,
    blogId,
    assetsEndpoint: campaignAssetsEndpoint,
    commentsEndpoint,
    onCommentPosted: body => {
      if (body.data?.statusFlipped) {
        setBlog(current => current ? { ...current, status: 'idea' } : current)
      }
    },
  })

  const campaignBlogsHref = scopedPortalPath(
    `/portal/campaigns/${campaignId}?tab=blogs`,
    orgScope,
  )

  async function approve() {
    if (approvalBusy || !blogId) return
    setApprovalBusy(true)
    setApprovalError(null)
    try {
      const response = await fetch(approveEndpoint, {
        method: 'POST',
      })
      const body = await response.json().catch(() => ({}))

      if (!response.ok) throw new Error(body?.error ?? 'Approval could not be recorded.')

      setBlog(current => current ? { ...current, status: body?.data?.status ?? 'client_approved' } : current)
      router.refresh()
    } catch (err: unknown) {
      setApprovalError(err instanceof Error ? err.message : 'Approval could not be recorded.')
    } finally {
      setApprovalBusy(false)
    }
  }

  const status = (blog?.status ?? '').toString()
  const isPublished = status === 'live' || status === 'published'
  const isApproved = status === 'client_approved' || status === 'approved'
  const canReview = status === 'review'

  return (
    <CampaignBlogDetailWorkspace
      loading={loading}
      blog={blog}
      comments={comments}
      loadError={loadError}
      actionError={approvalError ?? actionError}
      backHref={campaignBlogsHref}
      backLabel="Blog Posts"
      statusLabel={isPublished ? 'Published' : isApproved ? 'Approved' : canReview ? 'Awaiting Review' : undefined}
      canComment={canReview}
      helper={
        canReview
          ? 'Highlight any text to leave inline feedback, click an image to comment on it, or approve the post when it is ready.'
          : null
      }
      onComment={postComment}
      commentBusy={commentBusy === 'comment'}
      approval={
        canReview
          ? {
              title: 'Ready to approve?',
              noCommentsCopy: 'Approve this post for publishing, or leave feedback for the writer.',
              commentsCopy: count =>
                `${count} comment${count === 1 ? '' : 's'} recorded. Approve anyway if the post is ready.`,
              busy: approvalBusy,
              buttonLabel: 'Approve this post',
              busyLabel: 'Approving...',
              onApprove: approve,
            }
          : undefined
      }
      approvedMessage={!canReview && isApproved ? 'This blog post is approved and waiting for publishing.' : null}
    />
  )
}
