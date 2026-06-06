'use client'
export const dynamic = 'force-dynamic'

import { useMemo } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { SocialPostReviewWorkspace } from '@/components/social-review/SocialPostReviewWorkspace'
import { useSocialPostReviewDetail } from '@/components/social-review/useSocialPostReviewDetail'
import {
  scopedApiPath,
  scopedPortalPath,
  scopeFromSearchParams,
} from '@/lib/portal/scoped-routing'

function paramValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

export default function ClientReviewDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const id = paramValue(params?.id)
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const reviewQueueHref = useMemo(() => scopedPortalPath('/portal/social/review', orgScope), [orgScope])
  const {
    post,
    comments,
    loading,
    commentsLoading,
    loadError: error,
    notice,
    busy,
    runReviewAction,
    appendCommentFromBody,
  } = useSocialPostReviewDetail({
    id,
    postPath: id ? scopedApiPath(`/api/v1/social/posts/${id}`, orgScope) : '',
    commentsPath: id ? scopedApiPath(`/api/v1/social/posts/${id}/comments`, orgScope) : '',
  })

  async function handleApprove() {
    const approved = await runReviewAction({
      busyKey: 'approve',
      path: id ? scopedApiPath(`/api/v1/social/posts/${id}/client-approve`, orgScope) : '',
      successText: 'Approved - will be published.',
      errorText: 'Could not approve. Please try again.',
    })
    if (approved) {
      window.setTimeout(() => router.push(reviewQueueHref), 700)
    }
    return approved
  }

  async function handleReject(reason: string) {
    const rejected = await runReviewAction({
      busyKey: 'reject',
      path: id ? scopedApiPath(`/api/v1/social/posts/${id}/client-reject`, orgScope) : '',
      payload: { reason },
      successText: 'Sent back - your AI agent is regenerating now.',
      errorText: 'Could not send back. Please try again.',
    })
    if (rejected) {
      window.setTimeout(() => router.push(reviewQueueHref), 700)
    }
    return rejected
  }

  async function handlePostNote(text: string) {
    return runReviewAction({
      busyKey: 'comment',
      path: id ? scopedApiPath(`/api/v1/social/posts/${id}/comments`, orgScope) : '',
      payload: { text },
      errorText: 'Could not post note.',
      onSuccess: appendCommentFromBody,
    })
  }

  const supportsDownload = post?.deliveryMode === 'download_only' || post?.deliveryMode === 'both'

  return (
    <SocialPostReviewWorkspace
      loading={loading}
      loadError={error}
      post={post}
      comments={comments}
      commentsLoading={commentsLoading}
      backHref={reviewQueueHref}
      backLabel="review queue"
      title="Review post"
      statusLabel={
        post?.status === 'client_review' || post?.status === 'pending_approval'
          ? 'awaiting your review'
          : undefined
      }
      notice={notice}
      decisionTitle="Approve or send back"
      approveAction={{
        label: 'Approve & schedule',
        busyLabel: 'Approving...',
        busy: busy === 'approve',
        onAction: handleApprove,
      }}
      secondaryApproveAction={
        supportsDownload
          ? {
              label: 'Approve for download only',
              helpText: "We won't auto-publish; the post will sit in your vault for you to copy or download.",
              busy: busy === 'approve',
              onAction: handleApprove,
            }
          : undefined
      }
      rejectAction={{
        label: 'Send back with feedback',
        submitLabel: 'Send back for revision',
        busyLabel: 'Sending...',
        placeholder: 'Tell the AI what to fix - tone, facts, structure, hashtags, etc. (min 10 chars)',
        busy: busy === 'reject',
        onReject: handleReject,
      }}
      notePlaceholder="Leave a note for your team or the AI agent..."
      noteSubmitLabel="Post note"
      noteBusyLabel="Sending..."
      commentBusy={busy === 'comment'}
      onAddComment={handlePostNote}
    />
  )
}
