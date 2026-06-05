'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  SocialPostReviewWorkspace,
  type SocialPostReviewComment,
  type SocialPostReviewPost,
} from '@/components/social-review/SocialPostReviewWorkspace'
import {
  scopedApiPath,
  scopedPortalPath,
  scopeFromSearchParams,
} from '@/lib/portal/scoped-routing'

interface InlineNotice {
  type: 'success' | 'error' | 'info'
  text: string
}

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

  const [post, setPost] = useState<SocialPostReviewPost | null>(null)
  const [comments, setComments] = useState<SocialPostReviewComment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<InlineNotice | null>(null)
  const [busy, setBusy] = useState<null | 'approve' | 'reject' | 'comment'>(null)

  const showNotice = useCallback((next: InlineNotice) => {
    setNotice(next)
    window.setTimeout(() => setNotice(current => (current === next ? null : current)), 3500)
  }, [])

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const [postRes, commentsRes] = await Promise.all([
        fetch(scopedApiPath(`/api/v1/social/posts/${id}`, orgScope))
          .then(response => response.json())
          .catch(() => ({})),
        fetch(scopedApiPath(`/api/v1/social/posts/${id}/comments`, orgScope))
          .then(response => response.json())
          .catch(() => ({})),
      ])

      if (postRes?.error) {
        setError(postRes.error)
      } else {
        setPost(postRes?.data ?? null)
      }

      setComments(Array.isArray(commentsRes?.data) ? commentsRes.data : [])
    } catch {
      setError('Could not load this post.')
    } finally {
      setLoading(false)
    }
  }, [id, orgScope])

  useEffect(() => {
    load()
  }, [load])

  async function handleApprove() {
    if (!id || busy) return false
    setBusy('approve')
    try {
      const response = await fetch(scopedApiPath(`/api/v1/social/posts/${id}/client-approve`, orgScope), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        showNotice({ type: 'error', text: body?.error || 'Could not approve. Please try again.' })
        return false
      }
      showNotice({ type: 'success', text: 'Approved - will be published.' })
      window.setTimeout(() => router.push(reviewQueueHref), 700)
      return true
    } catch {
      showNotice({ type: 'error', text: 'Network error. Please try again.' })
      return false
    } finally {
      setBusy(null)
    }
  }

  async function handleReject(reason: string) {
    if (!id || busy) return false
    setBusy('reject')
    try {
      const response = await fetch(scopedApiPath(`/api/v1/social/posts/${id}/client-reject`, orgScope), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        showNotice({ type: 'error', text: body?.error || 'Could not send back. Please try again.' })
        return false
      }
      showNotice({ type: 'success', text: 'Sent back - your AI agent is regenerating now.' })
      window.setTimeout(() => router.push(reviewQueueHref), 700)
      return true
    } catch {
      showNotice({ type: 'error', text: 'Network error. Please try again.' })
      return false
    } finally {
      setBusy(null)
    }
  }

  async function handlePostNote(text: string) {
    if (!id || busy) return false
    setBusy('comment')
    try {
      const response = await fetch(scopedApiPath(`/api/v1/social/posts/${id}/comments`, orgScope), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        showNotice({ type: 'error', text: body?.error || 'Could not post note.' })
        return false
      }
      if (body?.data) setComments(current => [...current, body.data])
      return true
    } catch {
      showNotice({ type: 'error', text: 'Network error.' })
      return false
    } finally {
      setBusy(null)
    }
  }

  const supportsDownload = post?.deliveryMode === 'download_only' || post?.deliveryMode === 'both'

  return (
    <SocialPostReviewWorkspace
      loading={loading}
      loadError={error}
      post={post}
      comments={comments}
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
