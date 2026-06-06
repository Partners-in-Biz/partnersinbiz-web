'use client'
export const dynamic = 'force-dynamic'

import { useParams, useRouter } from 'next/navigation'
import { SocialPostReviewWorkspace } from '@/components/social-review/SocialPostReviewWorkspace'
import { useSocialPostReviewDetail } from '@/components/social-review/useSocialPostReviewDetail'
import { useOrg } from '@/lib/contexts/OrgContext'

function paramValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

export default function QaDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = paramValue(params?.id)
  const { orgId } = useOrg()

  const orgQs = orgId ? `?orgId=${orgId}` : ''
  const {
    post,
    comments,
    loading: postLoading,
    commentsLoading,
    loadError: postError,
    notice,
    busy,
    loadPost,
    loadComments,
    runReviewAction,
  } = useSocialPostReviewDetail({
    id,
    postPath: id ? `/api/v1/social/posts/${id}${orgQs}` : '',
    commentsPath: id ? `/api/v1/social/posts/${id}/comments${orgQs}` : '',
  })

  async function handleApprove() {
    const approved = await runReviewAction({
      busyKey: 'approve',
      path: id ? `/api/v1/social/posts/${id}/qa-approve${orgQs}` : '',
      successText: 'Approved - sent to client review.',
      errorText: 'Failed to approve',
    })
    if (approved) {
      router.push('/admin/social/qa')
    }
    return approved
  }

  async function handleReject(reason: string) {
    const rejected = await runReviewAction({
      busyKey: 'reject',
      path: id ? `/api/v1/social/posts/${id}/qa-reject${orgQs}` : '',
      payload: { reason },
      successText: 'Sent back for regeneration.',
      errorText: 'Failed to reject',
    })
    if (rejected) {
      router.push('/admin/social/qa')
    }
    return rejected
  }

  async function handleManualRegenerate() {
    if (!id) return false
    if (
      !window.confirm(
        'Trigger a manual regenerate for this post? Use this only if the regenerating call appears stuck.',
      )
    ) {
      return false
    }

    return runReviewAction({
      busyKey: 'manual',
      path: `/api/v1/social/posts/${id}/regenerate${orgQs}`,
      successText: 'Regeneration triggered.',
      errorText: 'Failed to regenerate',
      onSuccess: loadPost,
    })
  }

  async function handlePostComment(text: string) {
    return runReviewAction({
      busyKey: 'comment',
      path: id ? `/api/v1/social/posts/${id}/comments${orgQs}` : '',
      payload: { text },
      errorText: 'Failed to post note.',
      onSuccess: loadComments,
    })
  }

  const status = (post?.status ?? '').toString()
  const isQaReview = status === 'qa_review'

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <SocialPostReviewWorkspace
        loading={postLoading}
        loadError={postError}
        post={post}
        comments={comments}
        commentsLoading={commentsLoading}
        backHref="/admin/social/qa"
        backLabel="QA queue"
        title="QA Review"
        statusLabel={status ? status.replace(/_/g, ' ') : undefined}
        notice={notice}
        decisionTitle="Approve or send back"
        decisionDescription={
          <>
            Approving sends the post to <span className="text-violet-400">client review</span>.
          </>
        }
        approveAction={{
          label: 'Approve for client review',
          busyLabel: 'Approving...',
          busy: busy === 'approve',
          disabled: !isQaReview,
          onAction: handleApprove,
        }}
        rejectAction={{
          label: 'Reject + regenerate',
          submitLabel: 'Send back for regeneration',
          busyLabel: 'Sending...',
          placeholder: 'Tell the agent what to fix. Mention tone, facts, structure, hashtags, or media direction.',
          busy: busy === 'reject',
          disabled: !isQaReview,
          onReject: handleReject,
        }}
        manualAction={{
          label: 'Manual regenerate',
          busyLabel: 'Triggering...',
          busy: busy === 'manual',
          onAction: handleManualRegenerate,
        }}
        unavailableActionMessage={
          !isQaReview && status
            ? `Status is ${status.replace(/_/g, ' ')} - approve/reject is only available while in QA review.`
            : null
        }
        conversationTitle="Comments"
        emptyCommentsLabel="No comments yet."
        notePlaceholder="Leave context for the team or the agent..."
        noteSubmitLabel="Post note"
        noteBusyLabel="Posting..."
        commentBusy={busy === 'comment'}
        onAddComment={handlePostComment}
      />
    </div>
  )
}
