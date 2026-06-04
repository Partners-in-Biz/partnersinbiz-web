'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  CampaignBlogDetailWorkspace,
  type CampaignBlogCommentAnchor,
  type CampaignBlogDetailComment,
  type CampaignBlogDetailRecord,
} from '@/components/campaign-blog-detail/CampaignBlogDetailWorkspace'
import { scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any

function paramValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function commentPayload(text: string, anchor: CampaignBlogCommentAnchor): AnyObj {
  const payload: AnyObj = { text: text.trim() }

  if (anchor.kind === 'text') {
    payload.anchor = { type: 'text', text: anchor.text }
    if (typeof anchor.offset === 'number') payload.anchor.offset = anchor.offset
  }

  if (anchor.kind === 'image') {
    payload.anchor = { type: 'image', mediaUrl: anchor.mediaUrl }
  }

  return payload
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
  const [blog, setBlog] = useState<CampaignBlogDetailRecord | null>(null)
  const [comments, setComments] = useState<CampaignBlogDetailComment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'approve' | 'comment'>(null)

  useEffect(() => {
    if (!campaignId || !blogId) {
      setLoading(false)
      setLoadError('Blog post not found.')
      return
    }

    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setActionError(null)

    Promise.all([
      fetch(`/api/v1/campaigns/${campaignId}/assets`).then(async response => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body?.error ?? 'Campaign assets could not load.')
        return body
      }),
      fetch(`/api/v1/seo/content/${blogId}/comments`).then(async response => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body?.error ?? 'Comments could not load.')
        return body
      }),
    ])
      .then(([assetsBody, commentsBody]) => {
        if (cancelled) return
        const blogs = (assetsBody.data?.blogs ?? []) as CampaignBlogDetailRecord[]
        setBlog(blogs.find(item => item.id === blogId) ?? null)
        setComments((commentsBody.data ?? []) as CampaignBlogDetailComment[])
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'Blog post could not load.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [campaignId, blogId])

  const campaignBlogsHref = scopedPortalPath(
    `/portal/campaigns/${campaignId}?tab=blogs`,
    scopeFromSearchParams(searchParams),
  )

  async function refreshComments() {
    const refreshed = await fetch(`/api/v1/seo/content/${blogId}/comments`).then(response => response.json())
    setComments((refreshed.data ?? []) as CampaignBlogDetailComment[])
  }

  async function postComment(text: string, anchor: CampaignBlogCommentAnchor) {
    if (!text.trim() || busy) return
    setBusy('comment')
    setActionError(null)
    try {
      const response = await fetch(`/api/v1/seo/content/${blogId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(commentPayload(text, anchor)),
      })
      const body = await response.json().catch(() => ({}))

      if (!response.ok) throw new Error(body?.error ?? 'Comment could not be sent.')

      if (body?.data?.statusFlipped) {
        setBlog(current => current ? { ...current, status: 'idea' } : current)
      }

      await refreshComments()
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Comment could not be sent.')
      throw err
    } finally {
      setBusy(null)
    }
  }

  async function approve() {
    if (busy || !blogId) return
    setBusy('approve')
    setActionError(null)
    try {
      const response = await fetch(`/api/v1/seo/content/${blogId}/client-approve`, {
        method: 'POST',
      })
      const body = await response.json().catch(() => ({}))

      if (!response.ok) throw new Error(body?.error ?? 'Approval could not be recorded.')

      setBlog(current => current ? { ...current, status: body?.data?.status ?? 'client_approved' } : current)
      router.refresh()
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Approval could not be recorded.')
    } finally {
      setBusy(null)
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
      actionError={actionError}
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
      commentBusy={busy === 'comment'}
      approval={
        canReview
          ? {
              title: 'Ready to approve?',
              noCommentsCopy: 'Approve this post for publishing, or leave feedback for the writer.',
              commentsCopy: count =>
                `${count} comment${count === 1 ? '' : 's'} recorded. Approve anyway if the post is ready.`,
              busy: busy === 'approve',
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
