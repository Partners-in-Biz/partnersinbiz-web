'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  scopedApiPath,
  scopedPortalPath,
  scopeFromSearchParams,
} from '@/lib/portal/scoped-routing'

type PostStatus =
  | 'draft'
  | 'pending_approval'
  | 'qa_review'
  | 'client_review'
  | 'approved'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'partially_published'
  | 'failed'
  | 'cancelled'

type DeliveryMode = 'auto_publish' | 'download_only' | 'both' | string

type TimestampLike =
  | string
  | number
  | Date
  | {
      seconds?: number
      _seconds?: number
    }
  | null
  | undefined

interface MediaItem {
  url?: string
  thumbnailUrl?: string
  previewUrl?: string
  type?: string
  alt?: string
}

interface SocialPost {
  id: string
  content?: { text?: string; hashtags?: string[]; media?: MediaItem[] } | string
  hashtags?: string[]
  platforms?: string[]
  platform?: string
  status: PostStatus
  deliveryMode?: DeliveryMode
  scheduledAt?: TimestampLike
  scheduledFor?: TimestampLike
  createdAt?: TimestampLike
  media?: MediaItem[]
  originalContent?: { text?: string } | string
  approval?: {
    regenerationCount?: number
    [k: string]: unknown
  }
}

interface Comment {
  id: string
  text: string
  userId: string
  userName: string
  userRole: 'admin' | 'client' | 'ai'
  kind?: 'note' | 'rejection' | 'agent_handoff'
  createdAt?: TimestampLike
}

const PLATFORM_COLORS: Record<string, { bg: string; label: string; full: string }> = {
  twitter: { bg: 'bg-black', label: 'X', full: 'X (Twitter)' },
  x: { bg: 'bg-black', label: 'X', full: 'X' },
  linkedin: { bg: 'bg-blue-700', label: 'LI', full: 'LinkedIn' },
  facebook: { bg: 'bg-blue-600', label: 'FB', full: 'Facebook' },
  instagram: { bg: 'bg-pink-600', label: 'IG', full: 'Instagram' },
  reddit: { bg: 'bg-orange-600', label: 'RD', full: 'Reddit' },
  tiktok: { bg: 'bg-gray-800', label: 'TT', full: 'TikTok' },
  pinterest: { bg: 'bg-red-700', label: 'PI', full: 'Pinterest' },
  bluesky: { bg: 'bg-sky-500', label: 'BS', full: 'Bluesky' },
  threads: { bg: 'bg-gray-700', label: 'TH', full: 'Threads' },
}

function PlatformChip({ platform }: { platform: string }) {
  const config = PLATFORM_COLORS[platform] ?? {
    bg: 'bg-gray-600',
    label: platform.slice(0, 2).toUpperCase(),
    full: platform,
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border border-[var(--color-outline-variant)] text-[var(--color-on-surface)]">
      <span className={`${config.bg} text-white text-[10px] px-1.5 py-0.5 rounded font-bold`}>
        {config.label}
      </span>
      {config.full}
    </span>
  )
}

function getPostText(post?: SocialPost | null): string {
  if (typeof post?.content === 'string') return post.content
  if (post?.content?.text) return post.content.text
  return ''
}

function getOriginalText(post?: SocialPost | null): string | null {
  if (!post?.originalContent) return null
  if (typeof post.originalContent === 'string') return post.originalContent
  if (post.originalContent?.text) return post.originalContent.text
  return null
}

function getPostPlatforms(post?: SocialPost | null): string[] {
  if (post?.platforms?.length) return post.platforms
  if (post?.platform) return [post.platform]
  return []
}

function getMedia(post?: SocialPost | null): MediaItem[] {
  if (Array.isArray(post?.media) && post.media.length) return post.media
  if (post?.content && typeof post.content !== 'string' && Array.isArray(post.content.media) && post.content.media.length) {
    return post.content.media
  }
  return []
}

function getHashtags(post?: SocialPost | null): string[] {
  if (Array.isArray(post?.hashtags) && post.hashtags.length) return post.hashtags
  if (post?.content && typeof post.content !== 'string' && Array.isArray(post.content.hashtags) && post.content.hashtags.length) {
    return post.content.hashtags
  }
  return []
}

function tsToDate(ts: TimestampLike): Date | null {
  if (!ts) return null
  if (ts instanceof Date) return ts
  if (typeof ts === 'number' || typeof ts === 'string') return new Date(ts)
  if (ts._seconds) return new Date(ts._seconds * 1000)
  if (ts.seconds) return new Date(ts.seconds * 1000)
  return null
}

function fmtRelative(ts: TimestampLike): string {
  const d = tsToDate(ts)
  if (!d) return '—'
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
}

function fmtScheduled(ts: TimestampLike): string {
  const d = tsToDate(ts)
  return d
    ? d.toLocaleString('en-ZA', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'
}

const STATUS_LABEL: Partial<Record<PostStatus, string>> = {
  client_review: 'awaiting your review',
  pending_approval: 'awaiting your review',
  approved: 'approved',
  scheduled: 'scheduled',
  publishing: 'publishing',
  published: 'published',
  partially_published: 'partially published',
  failed: 'failed',
  cancelled: 'cancelled',
}

function visibleStatus(status?: PostStatus | string): string {
  if (!status) return 'in progress'
  if (status === 'draft' || status === 'qa_review') return 'in progress'
  return STATUS_LABEL[status as PostStatus] ?? String(status).replace(/_/g, ' ')
}

function MediaGrid({ media }: { media: MediaItem[] }) {
  if (!media.length) return null
  const visible = media.slice(0, 4)
  const cols = visible.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
  return (
    <div className={`grid ${cols} gap-2`}>
      {visible.map((m, i) => {
        const url = m?.url || m?.thumbnailUrl || m?.previewUrl
        if (!url) {
          return (
            <div
              key={i}
              className="aspect-video rounded border border-[var(--color-outline-variant)] bg-[var(--color-surface-variant)] flex items-center justify-center text-xs text-[var(--color-on-surface-variant)]"
            >
              media
            </div>
          )
        }
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={url}
            alt={m.alt || ''}
            className="w-full aspect-video rounded border border-[var(--color-outline-variant)] object-cover"
          />
        )
      })}
      {media.length > 4 && (
        <div className="aspect-video rounded border border-[var(--color-outline-variant)] bg-[var(--color-surface-variant)] flex items-center justify-center text-sm text-[var(--color-on-surface-variant)]">
          +{media.length - 4} more
        </div>
      )}
    </div>
  )
}

function CommentItem({ comment }: { comment: Comment }) {
  const isReject = comment.kind === 'rejection'
  const isHandoff = comment.kind === 'agent_handoff'

  const role = comment.userRole
  const rolePill =
    role === 'admin'
      ? { label: 'Team', bg: 'rgba(245,158,11,0.12)', color: 'var(--color-accent-v2)' }
      : role === 'ai'
        ? { label: 'AI Agent', bg: 'rgba(96,165,250,0.12)', color: '#60a5fa' }
        : { label: comment.userName || 'You', bg: 'rgba(255,255,255,0.06)', color: 'var(--color-on-surface)' }

  const containerStyle: React.CSSProperties = isReject
    ? { borderLeft: '3px solid #ef4444', paddingLeft: '0.75rem' }
    : isHandoff
      ? {
          borderLeft: '3px solid var(--color-accent-v2)',
          paddingLeft: '0.75rem',
          background: 'rgba(245,158,11,0.05)',
        }
      : { paddingLeft: '0.75rem', borderLeft: '3px solid transparent' }

  return (
    <div className="text-sm py-2" style={containerStyle}>
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <span className="font-medium text-[var(--color-on-surface)]">{comment.userName}</span>
        <span
          className="text-[10px] uppercase tracking-widest font-label px-1.5 py-0.5 rounded"
          style={{ background: rolePill.bg, color: rolePill.color }}
        >
          {rolePill.label}
        </span>
        {isReject && (
          <span className="text-[10px] uppercase tracking-widest font-label px-1.5 py-0.5 rounded text-red-300 bg-red-500/10">
            Sent back
          </span>
        )}
        {isHandoff && (
          <span className="text-[10px] uppercase tracking-widest font-label px-1.5 py-0.5 rounded text-[var(--color-accent-v2)] bg-amber-500/10">
            Revised
          </span>
        )}
        <span className="text-[var(--color-on-surface-variant)] ml-auto text-xs flex-shrink-0">
          {fmtRelative(comment.createdAt)}
        </span>
      </div>
      <p className="text-[var(--color-on-surface)] whitespace-pre-wrap break-words">{comment.text}</p>
    </div>
  )
}

interface InlineToast {
  type: 'success' | 'error' | 'info'
  text: string
}

export default function ClientReviewDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const id = params?.id
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const reviewQueueHref = useMemo(() => scopedPortalPath('/portal/social/review', orgScope), [orgScope])

  const [post, setPost] = useState<SocialPost | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showOriginal, setShowOriginal] = useState(false)
  const [actionLoading, setActionLoading] = useState<null | 'approve' | 'reject'>(null)
  const [showRejectPanel, setShowRejectPanel] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const [commentText, setCommentText] = useState('')
  const [commentLoading, setCommentLoading] = useState(false)

  const [toast, setToast] = useState<InlineToast | null>(null)

  const showToast = useCallback((t: InlineToast) => {
    setToast(t)
    setTimeout(() => setToast((current) => (current === t ? null : current)), 3500)
  }, [])

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const [postRes, commentsRes] = await Promise.all([
        fetch(scopedApiPath(`/api/v1/social/posts/${id}`, orgScope)).then((r) => r.json()).catch(() => ({})),
        fetch(scopedApiPath(`/api/v1/social/posts/${id}/comments`, orgScope)).then((r) => r.json()).catch(() => ({})),
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

  const platforms = useMemo(() => getPostPlatforms(post), [post])
  const text = useMemo(() => getPostText(post), [post])
  const original = useMemo(() => getOriginalText(post), [post])
  const media = useMemo(() => getMedia(post), [post])
  const hashtags = useMemo(() => getHashtags(post), [post])
  const regenerationCount = post?.approval?.regenerationCount ?? 0
  const supportsDownload =
    post?.deliveryMode === 'download_only' || post?.deliveryMode === 'both'

  async function handleApprove() {
    if (!id || actionLoading) return
    setActionLoading('approve')
    try {
      const res = await fetch(scopedApiPath(`/api/v1/social/posts/${id}/client-approve`, orgScope), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message = body?.error || 'Could not approve. Please try again.'
        showToast({ type: 'error', text: message })
        setActionLoading(null)
        return
      }
      showToast({ type: 'success', text: 'Approved — will be published.' })
      setTimeout(() => router.push(reviewQueueHref), 700)
    } catch {
      showToast({ type: 'error', text: 'Network error. Please try again.' })
      setActionLoading(null)
    }
  }

  async function handleReject() {
    if (!id || actionLoading) return
    const reason = rejectReason.trim()
    if (reason.length < 10) {
      showToast({ type: 'error', text: 'Please write at least 10 characters of feedback.' })
      return
    }
    setActionLoading('reject')
    try {
      const res = await fetch(scopedApiPath(`/api/v1/social/posts/${id}/client-reject`, orgScope), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message = body?.error || 'Could not send back. Please try again.'
        showToast({ type: 'error', text: message })
        setActionLoading(null)
        return
      }
      showToast({ type: 'success', text: 'Sent back — your AI agent is regenerating now.' })
      setTimeout(() => router.push(reviewQueueHref), 700)
    } catch {
      showToast({ type: 'error', text: 'Network error. Please try again.' })
      setActionLoading(null)
    }
  }

  async function handlePostNote() {
    if (!id || commentLoading) return
    const text = commentText.trim()
    if (!text) return
    setCommentLoading(true)
    try {
      const res = await fetch(scopedApiPath(`/api/v1/social/posts/${id}/comments`, orgScope), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast({ type: 'error', text: body?.error || 'Could not post note.' })
        return
      }
      if (body?.data) {
        setComments((prev) => [...prev, body.data])
      }
      setCommentText('')
    } catch {
      showToast({ type: 'error', text: 'Network error.' })
    } finally {
      setCommentLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="pib-skeleton h-6 w-40" />
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 pib-skeleton h-96" />
          <div className="lg:col-span-2 pib-skeleton h-96" />
        </div>
      </div>
    )
  }

  if (error || !post) {
    return (
      <div className="space-y-4">
        <Link
          href={reviewQueueHref}
          className="text-xs text-[var(--color-on-surface-variant)] hover:text-[var(--color-accent-v2)] transition-colors"
        >
          ← Back to review queue
        </Link>
        <div className="pib-card p-8 text-center">
          <p className="text-[var(--color-on-surface-variant)]">
            {error || 'This post is no longer available.'}
          </p>
        </div>
      </div>
    )
  }

  const statusLabel = visibleStatus(post.status)

  return (
    <div className="space-y-6 relative">
      {toast && (
        <div className="fixed top-20 right-4 z-50 max-w-sm">
          <div
            className="px-4 py-3 rounded-[var(--radius-card)] shadow-lg text-sm"
            style={{
              background: 'var(--color-sidebar)',
              border: `1px solid ${
                toast.type === 'success'
                  ? '#4ade80'
                  : toast.type === 'error'
                    ? '#ef4444'
                    : 'var(--color-accent-v2)'
              }`,
              color: 'var(--color-on-surface)',
            }}
          >
            {toast.text}
          </div>
        </div>
      )}

      <div>
        <Link
          href={reviewQueueHref}
          className="text-xs text-[var(--color-on-surface-variant)] hover:text-[var(--color-accent-v2)] transition-colors"
        >
          ← Back to review queue
        </Link>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <h1 className="font-headline text-2xl font-bold tracking-tighter">Review post</h1>
          <span
            className="text-[10px] font-label uppercase tracking-widest border px-2 py-0.5"
            style={{
              borderColor: 'rgba(245, 158, 11, 0.4)',
              color: 'var(--color-accent-v2)',
            }}
          >
            {statusLabel}
          </span>
          {regenerationCount > 0 && (
            <span
              className="text-[10px] font-label uppercase tracking-widest px-2 py-0.5 rounded"
              style={{
                background: 'rgba(245, 158, 11, 0.12)',
                color: 'var(--color-accent-v2)',
              }}
            >
              Revision {regenerationCount}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left: preview */}
        <div className="lg:col-span-3 space-y-4">
          <div
            className="rounded-[var(--radius-card)] p-5 space-y-4"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-outline-variant)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            }}
          >
            <div className="flex items-center gap-2 flex-wrap">
              {platforms.map((p) => (
                <PlatformChip key={p} platform={p} />
              ))}
            </div>

            {(post.scheduledAt || post.scheduledFor) && (
              <p className="text-xs text-[var(--color-on-surface-variant)]">
                Scheduled for {fmtScheduled(post.scheduledAt ?? post.scheduledFor)}
              </p>
            )}

            <div className="text-[15px] leading-relaxed text-[var(--color-on-surface)] whitespace-pre-wrap break-words">
              {text || (
                <span className="text-[var(--color-on-surface-variant)] italic">No content yet.</span>
              )}
            </div>

            {hashtags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {hashtags.map((h, i) => {
                  const tag = h.startsWith('#') ? h : `#${h}`
                  return (
                    <span
                      key={`${tag}-${i}`}
                      className="text-xs px-2 py-0.5 rounded-full border border-[var(--color-outline-variant)] text-[var(--color-accent-v2)]"
                    >
                      {tag}
                    </span>
                  )
                })}
              </div>
            )}

            {media.length > 0 && (
              <div className="pt-1">
                <MediaGrid media={media} />
              </div>
            )}
          </div>

          {original && original !== text && (
            <div className="pib-card p-4">
              <button
                onClick={() => setShowOriginal((s) => !s)}
                className="text-xs font-label uppercase tracking-widest text-[var(--color-on-surface-variant)] hover:text-[var(--color-accent-v2)] transition-colors"
              >
                {showOriginal ? 'Hide original' : 'See original'}
              </button>
              {showOriginal && (
                <div className="mt-3 p-3 rounded border border-dashed border-[var(--color-outline-variant)] text-sm text-[var(--color-on-surface-variant)] whitespace-pre-wrap break-words">
                  {original}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: actions + thread */}
        <div className="lg:col-span-2 space-y-5">
          <div className="pib-card p-5 space-y-3">
            <button
              onClick={handleApprove}
              disabled={actionLoading !== null}
              className="pib-btn-primary w-full text-sm py-2.5"
              style={{
                opacity: actionLoading !== null ? 0.7 : 1,
                cursor: actionLoading !== null ? 'not-allowed' : 'pointer',
              }}
            >
              {actionLoading === 'approve' ? 'Approving…' : 'Approve & schedule'}
            </button>

            {supportsDownload && (
              <div>
                <button
                  onClick={handleApprove}
                  disabled={actionLoading !== null}
                  className="pib-btn-secondary w-full text-sm py-2"
                  style={{
                    opacity: actionLoading !== null ? 0.7 : 1,
                    cursor: actionLoading !== null ? 'not-allowed' : 'pointer',
                  }}
                >
                  Approve for download only
                </button>
                <p className="text-[11px] text-[var(--color-on-surface-variant)] mt-1.5 leading-snug">
                  We won&apos;t auto-publish; the post will sit in your vault for you to copy or download.
                </p>
              </div>
            )}

            <button
              onClick={() => setShowRejectPanel((s) => !s)}
              disabled={actionLoading !== null}
              className="w-full text-sm py-2 rounded-[var(--radius-btn)] transition-colors text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)] hover:bg-[var(--color-surface-container)] font-label"
              style={{
                opacity: actionLoading !== null ? 0.7 : 1,
                cursor: actionLoading !== null ? 'not-allowed' : 'pointer',
              }}
            >
              Send back with feedback
            </button>

            {showRejectPanel && (
              <div className="pt-2 border-t border-[var(--color-outline-variant)] space-y-2">
                <label className="pib-label">What should be changed?</label>
                <textarea
                  className="pib-textarea w-full text-sm"
                  rows={4}
                  placeholder="Tell the AI what to fix — tone, facts, structure, hashtags, etc. (min 10 chars)"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  disabled={actionLoading !== null}
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-[var(--color-on-surface-variant)]">
                    {rejectReason.trim().length}/10 min
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setShowRejectPanel(false)
                        setRejectReason('')
                      }}
                      disabled={actionLoading !== null}
                      className="pib-btn-secondary text-xs px-3 py-1.5"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleReject}
                      disabled={actionLoading !== null || rejectReason.trim().length < 10}
                      className="text-xs px-3 py-1.5 rounded-[var(--radius-btn)] font-label uppercase tracking-widest transition-colors"
                      style={{
                        background: '#ef4444',
                        color: '#fff',
                        opacity:
                          actionLoading !== null || rejectReason.trim().length < 10 ? 0.6 : 1,
                        cursor:
                          actionLoading !== null || rejectReason.trim().length < 10
                            ? 'not-allowed'
                            : 'pointer',
                      }}
                    >
                      {actionLoading === 'reject' ? 'Sending…' : 'Send back for revision'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Comment thread */}
          <div className="pib-card p-5">
            <h3 className="text-xs font-label uppercase tracking-widest text-[var(--color-on-surface-variant)] mb-3">
              Conversation
            </h3>

            {comments.length === 0 ? (
              <p className="text-xs text-[var(--color-on-surface-variant)] py-2">
                No notes yet. Add a comment to leave context for your team or AI agent.
              </p>
            ) : (
              <div className="space-y-1 divide-y divide-[var(--color-outline-variant)]/40">
                {comments.map((c) => (
                  <CommentItem key={c.id} comment={c} />
                ))}
              </div>
            )}

            <div className="pt-3 mt-3 border-t border-[var(--color-outline-variant)] space-y-2">
              <label className="pib-label">Add a note</label>
              <textarea
                className="pib-textarea w-full text-sm"
                rows={3}
                placeholder="Leave a note for your team or the AI agent…"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                disabled={commentLoading}
              />
              <div className="flex justify-end">
                <button
                  onClick={handlePostNote}
                  disabled={commentLoading || !commentText.trim()}
                  className="pib-btn-primary text-xs px-3 py-1.5"
                  style={{
                    opacity: commentLoading || !commentText.trim() ? 0.6 : 1,
                    cursor: commentLoading || !commentText.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {commentLoading ? 'Sending…' : 'Post note'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
