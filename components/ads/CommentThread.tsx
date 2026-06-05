'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { scopedApiPath } from '@/lib/portal/scoped-routing'

interface AdComment {
  id: string
  orgId: string
  adId: string
  authorUid: string
  authorName: string
  authorRole: 'admin' | 'member' | 'viewer' | 'owner' | 'client'
  text: string
  resolved: boolean
  parentCommentId?: string
  createdAt?: { seconds?: number; nanoseconds?: number }
  updatedAt?: { seconds?: number; nanoseconds?: number }
  deletedAt?: { seconds?: number; nanoseconds?: number }
}

interface CommentThreadProps {
  adId: string
  orgId?: string
  currentUserUid: string
  isAdmin: boolean
}

function tsMillis(ts?: { seconds?: number; nanoseconds?: number }): number {
  if (!ts) return 0
  return (ts.seconds ?? 0) * 1000 + Math.floor((ts.nanoseconds ?? 0) / 1e6)
}

function relativeTime(ts?: { seconds?: number; nanoseconds?: number }): string {
  const ms = tsMillis(ts)
  if (!ms) return ''
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

export function CommentThread({ adId, orgId, currentUserUid, isAdmin }: CommentThreadProps) {
  const [comments, setComments] = useState<AdComment[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [replyParentId, setReplyParentId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const apiBase = scopedApiPath(`/api/v1/portal/ads/ads/${adId}/comments`, { orgId })

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiBase, { cache: 'no-store' })
      const body = await res.json()
      const list: AdComment[] = body?.data ?? body ?? []
      setComments(Array.isArray(list) ? list : [])
    } catch {
      setError('Failed to load comments')
    } finally {
      setLoading(false)
    }
  }, [apiBase])

  useEffect(() => {
    refresh()
  }, [refresh])

  const grouped = useMemo(() => {
    const topLevel = comments.filter((c) => !c.parentCommentId)
    const replies = comments.filter((c) => c.parentCommentId)
    return topLevel.map((c) => ({
      comment: c,
      replies: replies
        .filter((r) => r.parentCommentId === c.id)
        .sort((a, b) => tsMillis(a.createdAt) - tsMillis(b.createdAt)),
    }))
  }, [comments])

  async function submitTopLevel() {
    if (!text.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body?.error ?? 'Failed to post comment')
        return
      }
      setText('')
      await refresh()
    } finally {
      setSubmitting(false)
    }
  }

  async function submitReply(parentId: string) {
    if (!replyText.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: replyText.trim(), parentCommentId: parentId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body?.error ?? 'Failed to post reply')
        return
      }
      setReplyText('')
      setReplyParentId(null)
      await refresh()
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleResolved(c: AdComment) {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved: !c.resolved }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body?.error ?? 'Failed to update')
        return
      }
      await refresh()
    } finally {
      setSubmitting(false)
    }
  }

  function canMutate(c: AdComment): boolean {
    return c.authorUid === currentUserUid || isAdmin
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <textarea
          aria-label="New comment"
          className="w-full rounded border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-2 text-sm"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a comment…"
          disabled={submitting}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--color-pib-text-muted)]">
            {text.trim().length}/1000
          </span>
          <button
            type="button"
            onClick={submitTopLevel}
            disabled={submitting || !text.trim()}
            className="rounded bg-[var(--color-pib-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/5 p-2 text-xs text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-[var(--color-pib-text-muted)]">Loading…</div>
      ) : comments.length === 0 ? (
        <div className="rounded border border-dashed border-[var(--color-pib-line)] p-4 text-sm text-[var(--color-pib-text-muted)]">
          No comments yet.
        </div>
      ) : (
        <ul className="space-y-3">
          {grouped.map(({ comment, replies }) => (
            <li
              key={comment.id}
              className="rounded border border-[var(--color-pib-line)] p-3"
              data-testid={`comment-${comment.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-baseline gap-2 text-xs text-[var(--color-pib-text-muted)]">
                    <span className="font-medium text-[var(--color-pib-text)]">
                      {comment.authorName}
                    </span>
                    <span>·</span>
                    <span>{relativeTime(comment.createdAt)}</span>
                    {comment.resolved && (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">
                        resolved
                      </span>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--color-pib-text)]">
                    {comment.text}
                  </p>
                </div>
              </div>

              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setReplyParentId(replyParentId === comment.id ? null : comment.id)
                  }
                  className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]"
                  disabled={submitting}
                >
                  Reply
                </button>
                {canMutate(comment) && (
                  <button
                    type="button"
                    onClick={() => toggleResolved(comment)}
                    className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]"
                    disabled={submitting}
                  >
                    {comment.resolved ? 'Reopen' : 'Resolve'}
                  </button>
                )}
              </div>

              {replies.length > 0 && (
                <ul className="mt-3 space-y-2 border-l border-[var(--color-pib-line)] pl-3">
                  {replies.map((r) => (
                    <li key={r.id} data-testid={`comment-${r.id}`}>
                      <div className="flex items-baseline gap-2 text-xs text-[var(--color-pib-text-muted)]">
                        <span className="font-medium text-[var(--color-pib-text)]">
                          {r.authorName}
                        </span>
                        <span>·</span>
                        <span>{relativeTime(r.createdAt)}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--color-pib-text)]">
                        {r.text}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              {replyParentId === comment.id && (
                <div className="mt-3 space-y-2">
                  <textarea
                    aria-label={`Reply to ${comment.authorName}`}
                    className="w-full rounded border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-2 text-sm"
                    rows={2}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Write a reply…"
                    disabled={submitting}
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setReplyParentId(null)
                        setReplyText('')
                      }}
                      className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]"
                      disabled={submitting}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => submitReply(comment.id)}
                      disabled={submitting || !replyText.trim()}
                      className="rounded bg-[var(--color-pib-accent)] px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                    >
                      Reply
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
