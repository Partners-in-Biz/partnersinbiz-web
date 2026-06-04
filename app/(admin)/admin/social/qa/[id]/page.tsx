'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  SocialPostReviewWorkspace,
  type SocialPostReviewComment,
  type SocialPostReviewPost,
} from '@/components/social-review/SocialPostReviewWorkspace'
import { useOrg } from '@/lib/contexts/OrgContext'

interface InlineNotice {
  type: 'success' | 'error' | 'info'
  text: string
}

function paramValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

export default function QaDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = paramValue(params?.id)
  const { orgId } = useOrg()

  const [post, setPost] = useState<SocialPostReviewPost | null>(null)
  const [postLoading, setPostLoading] = useState(true)
  const [postError, setPostError] = useState('')
  const [comments, setComments] = useState<SocialPostReviewComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(true)
  const [notice, setNotice] = useState<InlineNotice | null>(null)
  const [busy, setBusy] = useState<null | 'approve' | 'reject' | 'comment' | 'manual'>(null)

  const orgQs = orgId ? `?orgId=${orgId}` : ''

  const showNotice = useCallback((next: InlineNotice) => {
    setNotice(next)
    window.setTimeout(() => setNotice(current => (current === next ? null : current)), 3500)
  }, [])

  const fetchPost = useCallback(async () => {
    if (!id) return
    setPostLoading(true)
    setPostError('')
    try {
      const response = await fetch(`/api/v1/social/posts/${id}${orgQs}`)
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Failed to load post')
      setPost(body.data ?? body)
    } catch (err: unknown) {
      setPostError(err instanceof Error ? err.message : 'Failed to load post')
    } finally {
      setPostLoading(false)
    }
  }, [id, orgQs])

  const fetchComments = useCallback(async () => {
    if (!id) return
    setCommentsLoading(true)
    try {
      const response = await fetch(`/api/v1/social/posts/${id}/comments${orgQs}`)
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Failed to load comments')
      setComments((body.data ?? body ?? []) as SocialPostReviewComment[])
    } catch {
      setComments([])
    } finally {
      setCommentsLoading(false)
    }
  }, [id, orgQs])

  useEffect(() => {
    fetchPost()
    fetchComments()
  }, [fetchPost, fetchComments])

  async function handleApprove() {
    if (!id) return false
    setBusy('approve')
    try {
      const response = await fetch(`/api/v1/social/posts/${id}/qa-approve${orgQs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Failed to approve')
      showNotice({ type: 'success', text: 'Approved - sent to client review.' })
      router.push('/admin/social/qa')
      return true
    } catch (err: unknown) {
      showNotice({ type: 'error', text: err instanceof Error ? err.message : 'Failed to approve.' })
      return false
    } finally {
      setBusy(null)
    }
  }

  async function handleReject(reason: string) {
    if (!id) return false
    setBusy('reject')
    try {
      const response = await fetch(`/api/v1/social/posts/${id}/qa-reject${orgQs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Failed to reject')
      showNotice({ type: 'success', text: 'Sent back for regeneration.' })
      router.push('/admin/social/qa')
      return true
    } catch (err: unknown) {
      showNotice({ type: 'error', text: err instanceof Error ? err.message : 'Failed to reject.' })
      return false
    } finally {
      setBusy(null)
    }
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

    setBusy('manual')
    try {
      const response = await fetch(`/api/v1/social/posts/${id}/regenerate${orgQs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Failed to regenerate')
      showNotice({ type: 'success', text: 'Regeneration triggered.' })
      await fetchPost()
      return true
    } catch (err: unknown) {
      showNotice({ type: 'error', text: err instanceof Error ? err.message : 'Failed to regenerate.' })
      return false
    } finally {
      setBusy(null)
    }
  }

  async function handlePostComment(text: string) {
    if (!id) return false
    setBusy('comment')
    try {
      const response = await fetch(`/api/v1/social/posts/${id}/comments${orgQs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Failed to post note')
      await fetchComments()
      return true
    } catch (err: unknown) {
      showNotice({ type: 'error', text: err instanceof Error ? err.message : 'Failed to post note.' })
      return false
    } finally {
      setBusy(null)
    }
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
