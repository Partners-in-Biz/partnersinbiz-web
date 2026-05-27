'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PageTabs } from '@/components/ui/AppFoundation'

type PostStatus = 'draft' | 'pending_approval' | 'approved' | 'scheduled' | 'published' | 'failed' | 'cancelled'
type FilterTab = 'pending' | 'scheduled' | 'published'

interface SocialPost {
  id: string
  content: { text: string; platformOverrides?: Record<string, any> } | string
  platforms: string[]
  status: PostStatus
  scheduledAt?: any
  createdAt?: any
  approvedBy?: string | null
}

interface Comment {
  id: string
  text: string
  userId: string
  userName: string
  userRole: 'admin' | 'client' | 'ai'
  createdAt: any
  agentPickedUp: boolean
  agentPickedUpAt?: any
}

const PLATFORM_COLORS: Record<string, { bg: string; label: string }> = {
  twitter:   { bg: 'bg-black',          label: 'X' },
  x:         { bg: 'bg-black',          label: 'X' },
  linkedin:  { bg: 'bg-[#0A66C2]',      label: 'LI' },
  facebook:  { bg: 'bg-[#1877F2]',      label: 'FB' },
  instagram: { bg: 'bg-gradient-to-br from-[#FFDC80] via-[#E1306C] to-[#5851DB]', label: 'IG' },
  reddit:    { bg: 'bg-[#FF4500]',      label: 'RD' },
  tiktok:    { bg: 'bg-black',          label: 'TT' },
  pinterest: { bg: 'bg-[#E60023]',      label: 'PI' },
  bluesky:   { bg: 'bg-[#0285FF]',      label: 'BS' },
  threads:   { bg: 'bg-[#1A1A1A]',      label: 'TH' },
}

const POST_STATUS_PILL: Record<PostStatus, string> = {
  draft:            'pib-pill',
  pending_approval: 'pib-pill pib-pill-warn',
  approved:         'pib-pill pib-pill-info',
  scheduled:        'pib-pill pib-pill-info',
  published:        'pib-pill pib-pill-success',
  failed:           'pib-pill pib-pill-danger',
  cancelled:        'pib-pill',
}

const POST_STATUS_LABEL: Record<PostStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Needs approval',
  approved: 'Approved',
  scheduled: 'Scheduled',
  published: 'Published',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

const ACCOUNT_STATUS_PILL: Record<string, string> = {
  active:         'pib-pill pib-pill-success',
  token_expired:  'pib-pill pib-pill-danger',
  disconnected:   'pib-pill',
  rate_limited:   'pib-pill pib-pill-warn',
}

function PlatformBadge({ platform }: { platform: string }) {
  const config = PLATFORM_COLORS[platform] ?? { bg: 'bg-gray-700', label: platform.slice(0, 2).toUpperCase() }
  return (
    <span className={`${config.bg} text-white text-[10px] px-2 py-0.5 rounded-md font-bold tracking-wider`}>
      {config.label}
    </span>
  )
}

function getPostText(post: any): string {
  if (typeof post.content === 'string') return post.content
  if (post.content?.text) return post.content.text
  return ''
}

function getPostPlatforms(post: any): string[] {
  if (post.platforms?.length) return post.platforms
  if (post.platform) return [post.platform]
  return []
}

function tsToDate(ts: any): Date | null {
  if (!ts) return null
  if (ts._seconds) return new Date(ts._seconds * 1000)
  if (ts.seconds) return new Date(ts.seconds * 1000)
  return new Date(ts)
}

function fmtDate(ts: any) {
  const d = tsToDate(ts)
  return d
    ? d.toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—'
}

function PostCard({
  post,
  onApprove,
  onReject,
  loading,
  comments,
  isExpanded,
  onToggleExpand,
  onAddComment,
  commentText,
  onCommentTextChange,
  commentLoading,
}: {
  post: SocialPost
  onApprove: () => void
  onReject: () => void
  loading: boolean
  comments: Comment[]
  isExpanded: boolean
  onToggleExpand: () => void
  onAddComment: () => void
  commentText: string
  onCommentTextChange: (text: string) => void
  commentLoading: boolean
}) {
  const text = getPostText(post)
  const isPending = post.status === 'pending_approval'

  function getRoleColor(role: string): string {
    if (role === 'admin') return 'bg-[var(--color-pib-accent)] text-black'
    if (role === 'ai') return 'bg-[var(--color-pib-violet)] text-white'
    return 'bg-[var(--color-pib-surface-2)] text-[var(--color-pib-text)]'
  }

  function formatCommentTime(ts: any): string {
    const d = tsToDate(ts)
    if (!d) return '—'
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)
    if (diffMins < 1) return 'now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
  }

  return (
    <div className="bento-card !p-5 space-y-3 flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-1.5 flex-wrap">
          {getPostPlatforms(post).map((p) => (
            <PlatformBadge key={p} platform={p} />
          ))}
        </div>
        <span className={POST_STATUS_PILL[post.status]}>
          {POST_STATUS_LABEL[post.status]}
        </span>
      </div>

      <p className="text-sm text-[var(--color-pib-text)] leading-relaxed line-clamp-4 flex-1">
        {text.slice(0, 280)}
      </p>

      {post.scheduledAt && (
        <p className="text-xs text-[var(--color-pib-text-muted)] font-mono">
          <span className="material-symbols-outlined text-sm align-middle mr-1">schedule</span>
          Scheduled · {fmtDate(post.scheduledAt)}
        </p>
      )}

      {isPending && (
        <div className="flex gap-2 pt-3 border-t border-[var(--color-pib-line)]">
          <button
            onClick={onApprove}
            disabled={loading}
            className="flex-1 pib-btn-primary !py-2 !text-xs disabled:opacity-50 disabled:cursor-not-allowed justify-center"
          >
            <span className="material-symbols-outlined text-base">check</span>
            {loading ? 'Saving…' : 'Approve'}
          </button>
          <button
            onClick={onReject}
            disabled={loading}
            className="flex-1 pib-btn-secondary !py-2 !text-xs disabled:opacity-50 disabled:cursor-not-allowed justify-center hover:!border-[#FCA5A5]/40 hover:!text-[#FCA5A5]"
          >
            <span className="material-symbols-outlined text-base">close</span>
            Reject
          </button>
        </div>
      )}

      <button
        onClick={onToggleExpand}
        className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors inline-flex items-center gap-1 self-start"
      >
        <span className="material-symbols-outlined text-sm">forum</span>
        Comments ({comments.length})
        <span className="material-symbols-outlined text-sm">{isExpanded ? 'expand_less' : 'expand_more'}</span>
      </button>

      {isExpanded && (
        <div className="border-t border-[var(--color-pib-line)] pt-3 space-y-3">
          {comments.map((comment) => (
            <div key={comment.id} className="flex gap-2.5 text-xs">
              <div
                className={`${getRoleColor(comment.userRole)} rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0 text-[11px] font-bold`}
              >
                {comment.userName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium text-[var(--color-pib-text)]">{comment.userName}</span>
                  <span className="pill !text-[9px] !py-0.5 !px-1.5">{comment.userRole}</span>
                  <span className="text-[var(--color-pib-text-muted)] ml-auto font-mono">
                    {formatCommentTime(comment.createdAt)}
                  </span>
                </div>
                <p className="text-[var(--color-pib-text)] mt-1.5 leading-relaxed">{comment.text}</p>
              </div>
            </div>
          ))}

          <div className="flex gap-2 pt-2 border-t border-[var(--color-pib-line)]">
            <input
              type="text"
              value={commentText}
              onChange={(e) => onCommentTextChange(e.target.value)}
              placeholder="Add a comment…"
              className="pib-input !rounded-full !py-1.5 !text-xs"
              disabled={commentLoading}
            />
            <button
              onClick={onAddComment}
              disabled={commentLoading || !commentText.trim()}
              className="pib-btn-primary !py-1.5 !px-3 !text-xs disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {commentLoading ? '…' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function PortalSocialDashboard() {
  const [accounts, setAccounts] = useState<any[]>([])
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')
  const [tab, setTab] = useState<FilterTab>('pending')
  const [commentsByPostId, setCommentsByPostId] = useState<Record<string, Comment[]>>({})
  const [expandedPostId, setExpandedPostId] = useState<string | null>(null)
  const [commentTextByPostId, setCommentTextByPostId] = useState<Record<string, string>>({})
  const [commentLoading, setCommentLoading] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/social/accounts').then((r) => r.json()),
      fetch('/api/v1/social/posts?limit=100').then((r) => r.json()),
      fetch('/api/v1/organizations').then((r) => r.json()),
    ])
      .then(([accBody, postBody, orgBody]) => {
        setAccounts(accBody.data ?? [])
        setPosts(postBody.data ?? [])
        if (orgBody.data?.[0]?.name) setOrgName(orgBody.data[0].name)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleAction(postId: string, action: 'approve' | 'reject') {
    setActionLoading(postId)
    setActionError(null)
    try {
      const res = await fetch(`/api/v1/social/posts/${postId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const body = await res.json()
      if (body.data?.status) {
        setPosts((prev) =>
          prev.map((p) => (p.id === postId ? { ...p, status: body.data.status as PostStatus } : p)),
        )
      } else if (!res.ok) {
        setActionError(body.error || 'Action failed')
      }
    } catch (err) {
      setActionError('Network error')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleToggleCommentThread(postId: string) {
    if (expandedPostId === postId) {
      setExpandedPostId(null)
    } else {
      setExpandedPostId(postId)
      if (!(postId in commentsByPostId)) {
        try {
          const res = await fetch(`/api/v1/social/posts/${postId}/comments`)
          const body = await res.json()
          if (body.data) {
            setCommentsByPostId((prev) => ({ ...prev, [postId]: body.data }))
          }
        } catch (err) {
          console.error('Failed to fetch comments:', err)
        }
      }
    }
  }

  async function handleAddComment(postId: string) {
    const text = commentTextByPostId[postId]?.trim()
    if (!text) return

    setCommentLoading(postId)
    try {
      const res = await fetch(`/api/v1/social/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const body = await res.json()
      if (body.data) {
        setCommentsByPostId((prev) => ({
          ...prev,
          [postId]: [...(prev[postId] ?? []), body.data],
        }))
        setCommentTextByPostId((prev) => ({ ...prev, [postId]: '' }))
      }
    } catch (err) {
      console.error('Failed to add comment:', err)
    } finally {
      setCommentLoading(null)
    }
  }

  const activeAccounts = accounts.filter((a) => a.status === 'active')
  const pendingPosts = posts.filter((p) => p.status === 'pending_approval')
  const scheduledPosts = posts.filter((p) => p.status === 'scheduled')
  const publishedPosts = posts.filter((p) => p.status === 'published')

  const displayPosts =
    tab === 'pending' ? pendingPosts : tab === 'scheduled' ? scheduledPosts : publishedPosts

  return (
    <div className="space-y-10">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="eyebrow">Social media</p>
          <h1 className="pib-page-title mt-2">Social</h1>
          {orgName && (
            <p className="text-sm text-[var(--color-pib-text-muted)] mt-1.5 font-mono">{orgName}</p>
          )}
          <p className="pib-page-sub max-w-xl">
            Approve content, monitor your queue, and keep every platform in sync.
          </p>
        </div>
        <Link href="/portal/social/compose" className="btn-pib-accent">
          <span className="material-symbols-outlined text-base">edit</span>
          Compose post
        </Link>
      </header>

      {/* Summary stats */}
      {!loading && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="pib-stat-card">
            <p className="eyebrow !text-[10px]">Pending approval</p>
            <p
              className="font-display text-4xl mt-3"
              style={{ color: pendingPosts.length > 0 ? 'var(--color-pib-accent)' : undefined }}
            >
              {pendingPosts.length}
            </p>
            <p className="mt-2 text-xs text-[var(--color-pib-text-muted)] font-mono">
              {pendingPosts.length > 0 ? 'awaiting your nod' : 'all caught up'}
            </p>
          </div>
          <div className="pib-stat-card">
            <p className="eyebrow !text-[10px]">Scheduled</p>
            <p className="font-display text-4xl mt-3 text-[#A4B8FF]">{scheduledPosts.length}</p>
            <p className="mt-2 text-xs text-[var(--color-pib-text-muted)] font-mono">queued for publish</p>
          </div>
          <div className="pib-stat-card">
            <p className="eyebrow !text-[10px]">Published</p>
            <p className="font-display text-4xl mt-3 text-[var(--color-pib-success)]">{publishedPosts.length}</p>
            <p className="mt-2 text-xs text-[var(--color-pib-text-muted)] font-mono">last 100 posts</p>
          </div>
        </section>
      )}

      {/* Quick links */}
      <div className="flex gap-3 flex-wrap">
        <Link href="/portal/social/vault" className="btn-pib-secondary !py-2 !px-4 !text-sm">
          <span className="material-symbols-outlined text-base">folder</span>
          Vault
        </Link>
        <Link href="/portal/social/history" className="btn-pib-secondary !py-2 !px-4 !text-sm">
          <span className="material-symbols-outlined text-base">history</span>
          Post history
        </Link>
        <Link href="/portal/social/calendar" className="btn-pib-secondary !py-2 !px-4 !text-sm">
          <span className="material-symbols-outlined text-base">calendar_month</span>
          Calendar
        </Link>
        <Link href="/portal/social/accounts" className="btn-pib-secondary !py-2 !px-4 !text-sm">
          <span className="material-symbols-outlined text-base">link</span>
          Accounts
        </Link>
        <Link href="/portal/social/links" className="btn-pib-secondary !py-2 !px-4 !text-sm">
          <span className="material-symbols-outlined text-base">link</span>
          Links
        </Link>
      </div>

      {/* Connected accounts */}
      <section>
        <h2 className="eyebrow mb-4">Connected accounts</h2>
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="pib-skeleton h-16" />
            ))}
          </div>
        ) : activeAccounts.length === 0 ? (
          <div className="bento-card p-7 text-center">
            <p className="text-[var(--color-pib-text-muted)] mb-4 text-sm">No accounts connected yet.</p>
            <Link href="/portal/social/accounts" className="btn-pib-accent !py-2 !px-4 !text-sm">
              Connect an account
              <span className="material-symbols-outlined text-base">arrow_outward</span>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {activeAccounts.map((acc: any) => (
              <div key={acc.id} className="pib-stat-card flex items-center gap-3">
                <PlatformBadge platform={acc.platform} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{acc.displayName}</p>
                  <p className="text-xs text-[var(--color-pib-text-muted)] truncate font-mono">
                    @{acc.username || acc.displayName}
                  </p>
                </div>
                <span className={ACCOUNT_STATUS_PILL[acc.status] ?? 'pib-pill'}>{acc.status}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Posts */}
      <section>
        <h2 className="eyebrow mb-4">Posts</h2>

        <PageTabs
          className="mb-6"
          ariaLabel="Social post filters"
          value={tab}
          onValueChange={(value) => setTab(value as FilterTab)}
          tabs={[
            { value: 'pending', label: 'Needs approval', badge: pendingPosts.length },
            { value: 'scheduled', label: 'Scheduled', badge: scheduledPosts.length },
            { value: 'published', label: 'Published', badge: publishedPosts.length },
          ]}
        />

        {actionError && (
          <div className="mb-4 bento-card !p-4 !border-[#FCA5A5]/30 !bg-[#FCA5A5]/10 text-[#FECACA] text-sm">
            {actionError}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="pib-skeleton h-40" />
            ))}
          </div>
        ) : displayPosts.length === 0 ? (
          <div className="bento-card p-10 text-center">
            <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]">
              {tab === 'pending' ? 'check_circle' : tab === 'scheduled' ? 'schedule' : 'rocket_launch'}
            </span>
            <p className="text-[var(--color-pib-text-muted)] mt-4">
              {tab === 'pending'
                ? 'All caught up — no posts waiting for your approval.'
                : tab === 'scheduled'
                ? 'No posts scheduled yet.'
                : 'No published posts yet.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {displayPosts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onApprove={() => handleAction(post.id, 'approve')}
                onReject={() => handleAction(post.id, 'reject')}
                loading={actionLoading === post.id}
                comments={commentsByPostId[post.id] ?? []}
                isExpanded={expandedPostId === post.id}
                onToggleExpand={() => handleToggleCommentThread(post.id)}
                onAddComment={() => handleAddComment(post.id)}
                commentText={commentTextByPostId[post.id] ?? ''}
                onCommentTextChange={(text) =>
                  setCommentTextByPostId((prev) => ({ ...prev, [post.id]: text }))
                }
                commentLoading={commentLoading === post.id}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
