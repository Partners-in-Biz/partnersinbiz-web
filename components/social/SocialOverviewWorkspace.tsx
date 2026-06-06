'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { PageTabs } from '@/components/ui/AppFoundation'
import { appendQueryParams } from '@/lib/portal/scoped-routing'

type Surface = 'admin' | 'portal'
type FilterTab = 'pending' | 'scheduled' | 'published'
type TimestampLike =
  | { _seconds?: number; seconds?: number; toDate?: () => Date }
  | string
  | number
  | Date
  | null
  | undefined

interface SocialPost {
  id: string
  content?: { text?: string; platformOverrides?: Record<string, unknown> } | string | null
  platforms?: string[]
  platform?: string
  status: string
  scheduledAt?: TimestampLike
  scheduledFor?: TimestampLike
  publishedAt?: TimestampLike
  createdAt?: TimestampLike
  approvedBy?: string | null
  externalId?: string | null
  error?: string | null
}

interface SocialAccount {
  id: string
  platform: string
  displayName: string
  username?: string
  status: string
}

interface SocialComment {
  id: string
  text: string
  userName: string
  userRole: 'admin' | 'client' | 'ai' | string
  createdAt: TimestampLike
}

export interface SocialOverviewAction {
  key?: string
  label: string
  href: string
  icon?: string
  primary?: boolean
}

interface SocialOverviewWorkspaceProps {
  surface: Surface
  title?: string
  eyebrow?: string
  description?: string
  postsLimit?: number
  buildApiPath?: (path: string) => string
  buildHref?: (path: string) => string
  loadOrgName?: boolean
  primaryAction?: SocialOverviewAction
  quickActions: SocialOverviewAction[]
  showConnectedAccounts?: boolean
  showApprovalTabs?: boolean
  showRecentPosts?: boolean
  showInboxCount?: boolean
}

const PLATFORM_COLORS: Record<string, { bg: string; label: string }> = {
  twitter: { bg: 'bg-black', label: 'X' },
  x: { bg: 'bg-black', label: 'X' },
  linkedin: { bg: 'bg-[#0A66C2]', label: 'LI' },
  facebook: { bg: 'bg-[#1877F2]', label: 'FB' },
  instagram: { bg: 'bg-gradient-to-br from-[#FFDC80] via-[#E1306C] to-[#5851DB]', label: 'IG' },
  reddit: { bg: 'bg-[#FF4500]', label: 'RD' },
  tiktok: { bg: 'bg-black', label: 'TT' },
  pinterest: { bg: 'bg-[#E60023]', label: 'PI' },
  bluesky: { bg: 'bg-[#0285FF]', label: 'BS' },
  threads: { bg: 'bg-[#1A1A1A]', label: 'TH' },
}

const POST_STATUS_PILL: Record<string, string> = {
  draft: 'pib-pill',
  pending_approval: 'pib-pill pib-pill-warn',
  approved: 'pib-pill pib-pill-info',
  scheduled: 'pib-pill pib-pill-info',
  published: 'pib-pill pib-pill-success',
  failed: 'pib-pill pib-pill-danger',
  cancelled: 'pib-pill',
}

const POST_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending_approval: 'Needs approval',
  approved: 'Approved',
  scheduled: 'Scheduled',
  published: 'Published',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

const ACCOUNT_STATUS_PILL: Record<string, string> = {
  active: 'pib-pill pib-pill-success',
  token_expired: 'pib-pill pib-pill-danger',
  disconnected: 'pib-pill',
  rate_limited: 'pib-pill pib-pill-warn',
}

function PlatformBadge({ platform }: { platform: string }) {
  const config = PLATFORM_COLORS[platform.toLowerCase()] ?? {
    bg: 'bg-gray-700',
    label: platform.slice(0, 2).toUpperCase(),
  }
  return (
    <span className={`${config.bg} text-white text-[10px] px-2 py-0.5 rounded-md font-bold tracking-wider`}>
      {config.label}
    </span>
  )
}

function getPostText(post: SocialPost): string {
  if (typeof post.content === 'string') return post.content
  if (post.content?.text) return post.content.text
  return ''
}

function getPostPlatforms(post: SocialPost): string[] {
  if (Array.isArray(post.platforms) && post.platforms.length > 0) return post.platforms
  if (post.platform) return [post.platform]
  return []
}

function tsToDate(ts: TimestampLike): Date | null {
  if (!ts) return null
  if (ts instanceof Date) return ts
  if (typeof ts === 'object') {
    if (typeof ts.toDate === 'function') return ts.toDate()
    if (typeof ts._seconds === 'number') return new Date(ts._seconds * 1000)
    if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000)
    return null
  }
  const date = new Date(ts)
  return Number.isNaN(date.getTime()) ? null : date
}

function getScheduledDate(post: SocialPost): Date | null {
  return tsToDate(post.scheduledAt) ?? tsToDate(post.scheduledFor) ?? tsToDate(post.createdAt)
}

function fmtDate(ts: TimestampLike) {
  const d = tsToDate(ts)
  return d
    ? d.toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '-'
}

function formatRelativeTime(ts: TimestampLike): string {
  const d = tsToDate(ts)
  if (!d) return '-'
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

function hasQueryParam(path: string, name: string): boolean {
  try {
    return new URL(path, 'https://partnersinbiz.local').searchParams.has(name)
  } catch {
    return false
  }
}

function appendResolvedOrg(path: string, orgId?: string, orgSlug?: string): string {
  if (!orgId || hasQueryParam(path, 'orgId')) return path
  return appendQueryParams(path, { orgId, orgSlug })
}

function statusLabel(status: string): string {
  return POST_STATUS_LABEL[status] ?? status.replace(/_/g, ' ')
}

function roleClass(role: string): string {
  if (role === 'admin') return 'bg-[var(--color-pib-accent)] text-black'
  if (role === 'ai') return 'bg-[var(--color-pib-violet)] text-white'
  return 'bg-[var(--color-pib-surface-2)] text-[var(--color-pib-text)]'
}

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string | number
  sub?: string
  tone?: 'accent' | 'info' | 'success' | 'danger'
}) {
  const toneClass =
    tone === 'accent'
      ? 'text-[var(--color-pib-accent)]'
      : tone === 'info'
      ? 'text-[#A4B8FF]'
      : tone === 'success'
      ? 'text-[var(--color-pib-success)]'
      : tone === 'danger'
      ? 'text-[#FCA5A5]'
      : ''

  return (
    <div className="pib-stat-card">
      <p className="eyebrow !text-[10px]">{label}</p>
      <p className={`font-display text-4xl mt-3 ${toneClass}`}>{value}</p>
      {sub && <p className="mt-2 text-xs text-[var(--color-pib-text-muted)] font-mono">{sub}</p>}
    </div>
  )
}

function ActionLink({
  action,
  badge,
}: {
  action: SocialOverviewAction
  badge?: number | null
}) {
  const className = action.primary ? 'btn-pib-accent' : 'btn-pib-secondary !py-2 !px-4 !text-sm'

  return (
    <Link href={action.href} className={`relative ${className}`}>
      {action.icon && <span className="material-symbols-outlined text-base">{action.icon}</span>}
      {action.label}
      {typeof badge === 'number' && badge > 0 && (
        <span className="absolute top-0 right-0 flex h-5 w-5 translate-x-1/4 -translate-y-1/4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
          {badge}
        </span>
      )}
    </Link>
  )
}

function ConnectedAccounts({
  loading,
  accounts,
  accountsHref,
}: {
  loading: boolean
  accounts: SocialAccount[]
  accountsHref: string
}) {
  const activeAccounts = accounts.filter((a) => a.status === 'active')

  return (
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
          <Link href={accountsHref} className="btn-pib-accent !py-2 !px-4 !text-sm">
            Connect an account
            <span className="material-symbols-outlined text-base">arrow_outward</span>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {activeAccounts.map((account) => (
            <div key={account.id} className="pib-stat-card flex items-center gap-3">
              <PlatformBadge platform={account.platform} />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{account.displayName}</p>
                <p className="text-xs text-[var(--color-pib-text-muted)] truncate font-mono">
                  @{account.username || account.displayName}
                </p>
              </div>
              <span className={ACCOUNT_STATUS_PILL[account.status] ?? 'pib-pill'}>{account.status}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function RecentPostsList({
  loading,
  posts,
}: {
  loading: boolean
  posts: SocialPost[]
}) {
  const recent = [...posts]
    .sort((a, b) => (getScheduledDate(b)?.getTime() ?? 0) - (getScheduledDate(a)?.getTime() ?? 0))
    .slice(0, 10)

  return (
    <section>
      <h2 className="eyebrow mb-4">Recent posts</h2>
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="pib-skeleton h-12" />
          ))}
        </div>
      ) : recent.length === 0 ? (
        <div className="bento-card p-8 text-center text-sm text-[var(--color-pib-text-muted)]">No posts yet.</div>
      ) : (
        <div className="bento-card !p-0 overflow-hidden">
          {recent.map((post, index) => {
            const text = getPostText(post)
            const platforms = getPostPlatforms(post)
            const scheduledDate = post.scheduledAt ?? post.scheduledFor ?? post.createdAt

            return (
              <div
                key={post.id}
                className={`flex items-center gap-4 px-5 py-3 ${index > 0 ? 'border-t border-[var(--color-pib-line)]' : ''}`}
              >
                <div className="flex items-center gap-1 shrink-0">
                  {platforms.map((platform) => (
                    <PlatformBadge key={platform} platform={platform} />
                  ))}
                </div>
                <p className="flex-1 text-sm text-[var(--color-pib-text)] truncate min-w-0">
                  {text.slice(0, 80)}
                  {text.length > 80 ? '...' : ''}
                </p>
                <span className={POST_STATUS_PILL[post.status] ?? 'pib-pill'}>{statusLabel(post.status)}</span>
                <span className="text-xs text-[var(--color-pib-text-muted)] flex-shrink-0 w-28 text-right">
                  {fmtDate(scheduledDate)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function ReviewPostCard({
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
  comments: SocialComment[]
  isExpanded: boolean
  onToggleExpand: () => void
  onAddComment: () => void
  commentText: string
  onCommentTextChange: (text: string) => void
  commentLoading: boolean
}) {
  const text = getPostText(post)
  const isPending = post.status === 'pending_approval'

  return (
    <div className="bento-card !p-5 space-y-3 flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-1.5 flex-wrap">
          {getPostPlatforms(post).map((platform) => (
            <PlatformBadge key={platform} platform={platform} />
          ))}
        </div>
        <span className={POST_STATUS_PILL[post.status] ?? 'pib-pill'}>{statusLabel(post.status)}</span>
      </div>

      <p className="text-sm text-[var(--color-pib-text)] leading-relaxed line-clamp-4 flex-1">
        {text.slice(0, 280)}
      </p>

      {post.scheduledAt && (
        <p className="text-xs text-[var(--color-pib-text-muted)] font-mono">
          <span className="material-symbols-outlined text-sm align-middle mr-1">schedule</span>
          Scheduled - {fmtDate(post.scheduledAt)}
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
            {loading ? 'Saving...' : 'Approve'}
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
                className={`${roleClass(comment.userRole)} rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0 text-[11px] font-bold`}
              >
                {comment.userName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium text-[var(--color-pib-text)]">{comment.userName}</span>
                  <span className="pill !text-[9px] !py-0.5 !px-1.5">{comment.userRole}</span>
                  <span className="text-[var(--color-pib-text-muted)] ml-auto font-mono">
                    {formatRelativeTime(comment.createdAt)}
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
              onChange={(event) => onCommentTextChange(event.target.value)}
              placeholder="Add a comment..."
              className="pib-input !rounded-full !py-1.5 !text-xs"
              disabled={commentLoading}
            />
            <button
              onClick={onAddComment}
              disabled={commentLoading || !commentText.trim()}
              className="pib-btn-primary !py-1.5 !px-3 !text-xs disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {commentLoading ? '...' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ApprovalPosts({
  loading,
  posts,
  actionError,
  actionLoading,
  commentsByPostId,
  expandedPostId,
  commentTextByPostId,
  commentLoading,
  onAction,
  onToggleCommentThread,
  onAddComment,
  onCommentTextChange,
}: {
  loading: boolean
  posts: SocialPost[]
  actionError: string | null
  actionLoading: string | null
  commentsByPostId: Record<string, SocialComment[]>
  expandedPostId: string | null
  commentTextByPostId: Record<string, string>
  commentLoading: string | null
  onAction: (postId: string, action: 'approve' | 'reject') => void
  onToggleCommentThread: (postId: string) => void
  onAddComment: (postId: string) => void
  onCommentTextChange: (postId: string, text: string) => void
}) {
  const [tab, setTab] = useState<FilterTab>('pending')
  const pendingPosts = posts.filter((post) => post.status === 'pending_approval')
  const scheduledPosts = posts.filter((post) => post.status === 'scheduled')
  const publishedPosts = posts.filter((post) => post.status === 'published')
  const displayPosts = tab === 'pending' ? pendingPosts : tab === 'scheduled' ? scheduledPosts : publishedPosts

  return (
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
              ? 'All caught up - no posts waiting for your approval.'
              : tab === 'scheduled'
              ? 'No posts scheduled yet.'
              : 'No published posts yet.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {displayPosts.map((post) => (
            <ReviewPostCard
              key={post.id}
              post={post}
              onApprove={() => onAction(post.id, 'approve')}
              onReject={() => onAction(post.id, 'reject')}
              loading={actionLoading === post.id}
              comments={commentsByPostId[post.id] ?? []}
              isExpanded={expandedPostId === post.id}
              onToggleExpand={() => onToggleCommentThread(post.id)}
              onAddComment={() => onAddComment(post.id)}
              commentText={commentTextByPostId[post.id] ?? ''}
              onCommentTextChange={(text) => onCommentTextChange(post.id, text)}
              commentLoading={commentLoading === post.id}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export default function SocialOverviewWorkspace({
  surface,
  title = surface === 'admin' ? 'Social Overview' : 'Social',
  eyebrow = surface === 'portal' ? 'Social media' : undefined,
  description = surface === 'admin'
    ? 'Monitor and manage your social media presence'
    : 'Approve content, monitor your queue, and keep every platform in sync.',
  postsLimit = surface === 'admin' ? 200 : 100,
  buildApiPath,
  buildHref,
  loadOrgName = false,
  primaryAction,
  quickActions,
  showConnectedAccounts = surface === 'portal',
  showApprovalTabs = surface === 'portal',
  showRecentPosts = surface === 'admin',
  showInboxCount = surface === 'admin',
}: SocialOverviewWorkspaceProps) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([])
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [loading, setLoading] = useState(true)
  const [orgName, setOrgName] = useState('')
  const [resolvedOrgId, setResolvedOrgId] = useState('')
  const [resolvedOrgSlug, setResolvedOrgSlug] = useState('')
  const [unreadInboxCount, setUnreadInboxCount] = useState<number | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [commentsByPostId, setCommentsByPostId] = useState<Record<string, SocialComment[]>>({})
  const [expandedPostId, setExpandedPostId] = useState<string | null>(null)
  const [commentTextByPostId, setCommentTextByPostId] = useState<Record<string, string>>({})
  const [commentLoading, setCommentLoading] = useState<string | null>(null)

  const apiPath = useCallback((path: string) => (buildApiPath ? buildApiPath(path) : path), [buildApiPath])
  const hrefFor = useCallback((path: string) => (buildHref ? buildHref(path) : path), [buildHref])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const orgBody = loadOrgName
          ? await fetch(apiPath('/api/v1/portal/org')).then((response) => response.json()).catch(() => null)
          : null
        const nextOrg = orgBody?.org ?? orgBody?.data?.[0]
        const nextOrgId = typeof nextOrg?.id === 'string' ? nextOrg.id : ''
        const nextOrgSlug = typeof nextOrg?.slug === 'string' ? nextOrg.slug : ''
        const socialApiPath = (path: string) => appendResolvedOrg(apiPath(path), nextOrgId)

        const [accountBody, postBody, inboxBody] = await Promise.all([
          fetch(socialApiPath('/api/v1/social/accounts')).then((response) => response.json()).catch(() => null),
          fetch(socialApiPath(`/api/v1/social/posts?limit=${postsLimit}`)).then((response) => response.json()).catch(() => null),
          showInboxCount
            ? fetch(socialApiPath('/api/v1/social/inbox?status=unread&limit=1')).then((response) => response.json()).catch(() => null)
            : Promise.resolve(null),
        ])

        if (cancelled) return

        const nextAccounts = accountBody?.data ?? accountBody?.accounts ?? []
        setAccounts(Array.isArray(nextAccounts) ? nextAccounts : [])
        setPosts(Array.isArray(postBody?.data) ? postBody.data : [])

        const nextOrgName = nextOrg?.name
        if (nextOrgName) setOrgName(nextOrgName)
        setResolvedOrgId(nextOrgId)
        setResolvedOrgSlug(nextOrgSlug)

        if (showInboxCount) {
          const items = inboxBody?.items ?? []
          setUnreadInboxCount(Array.isArray(items) ? items.length : null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [apiPath, loadOrgName, postsLimit, showInboxCount])

  async function handleAction(postId: string, action: 'approve' | 'reject') {
    setActionLoading(postId)
    setActionError(null)
    try {
      const res = await fetch(apiPath(`/api/v1/social/posts/${postId}/approve`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const body = await res.json()
      if (!res.ok) {
        setActionError(body.error || 'Action failed')
      } else if (body.data?.status) {
        setPosts((prev) => prev.map((post) => (post.id === postId ? { ...post, status: body.data.status } : post)))
      }
    } catch {
      setActionError('Network error')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleToggleCommentThread(postId: string) {
    if (expandedPostId === postId) {
      setExpandedPostId(null)
      return
    }

    setExpandedPostId(postId)
    if (postId in commentsByPostId) return

    try {
      const res = await fetch(apiPath(`/api/v1/social/posts/${postId}/comments`))
      const body = await res.json()
      if (Array.isArray(body.data)) {
        setCommentsByPostId((prev) => ({ ...prev, [postId]: body.data }))
      }
    } catch {
      setCommentsByPostId((prev) => ({ ...prev, [postId]: [] }))
    }
  }

  async function handleAddComment(postId: string) {
    const text = commentTextByPostId[postId]?.trim()
    if (!text) return

    setCommentLoading(postId)
    try {
      const res = await fetch(apiPath(`/api/v1/social/posts/${postId}/comments`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const body = await res.json()
      if (body.data) {
        setCommentsByPostId((prev) => ({ ...prev, [postId]: [...(prev[postId] ?? []), body.data] }))
        setCommentTextByPostId((prev) => ({ ...prev, [postId]: '' }))
      }
    } finally {
      setCommentLoading(null)
    }
  }

  const stats = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const pending = posts.filter((post) => post.status === 'pending_approval').length
    const scheduled = posts.filter((post) => post.status === 'scheduled').length
    const published = posts.filter((post) => post.status === 'published').length
    const publishedToday = posts.filter((post) => {
      if (post.status !== 'published') return false
      const date = tsToDate(post.publishedAt)
      return date && date >= today && date < tomorrow
    }).length
    const failed = posts.filter((post) => post.status === 'failed').length
    const drafts = posts.filter((post) => post.status === 'draft').length

    return { pending, scheduled, published, publishedToday, failed, drafts }
  }, [posts])

  const primary = primaryAction ? { ...primaryAction, href: hrefFor(primaryAction.href) } : null
  const primaryHref = primary ? appendResolvedOrg(primary.href, resolvedOrgId, resolvedOrgSlug) : null
  const primaryWithResolvedOrg = primary && primaryHref ? { ...primary, href: primaryHref } : primary
  const actions = quickActions.map((action) => ({
    ...action,
    href: appendResolvedOrg(hrefFor(action.href), resolvedOrgId, resolvedOrgSlug),
  }))
  const accountsHref = appendResolvedOrg(hrefFor('/portal/social/accounts'), resolvedOrgId, resolvedOrgSlug)

  return (
    <div className="space-y-10">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1 className="pib-page-title mt-2">{title}</h1>
          {orgName && <p className="text-sm text-[var(--color-pib-text-muted)] mt-1.5 font-mono">{orgName}</p>}
          <p className="pib-page-sub max-w-xl">{description}</p>
        </div>
        {primaryWithResolvedOrg && <ActionLink action={{ ...primaryWithResolvedOrg, primary: true }} />}
      </header>

      {loading ? (
        <section className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[...Array(surface === 'admin' ? 5 : 3)].map((_, i) => (
            <div key={i} className="pib-skeleton h-28" />
          ))}
        </section>
      ) : surface === 'admin' ? (
        <section className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard label="Scheduled" value={stats.scheduled} sub="upcoming posts" tone="info" />
          <StatCard label="Published Today" value={stats.publishedToday} sub="posts live today" tone="success" />
          <StatCard label="Failed" value={stats.failed} sub="need attention" tone="danger" />
          <StatCard label="Drafts" value={stats.drafts} sub="in progress" />
          <StatCard label="Accounts" value={accounts.length || '-'} sub="connected" />
        </section>
      ) : (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            label="Pending approval"
            value={stats.pending}
            sub={stats.pending > 0 ? 'awaiting your nod' : 'all caught up'}
            tone={stats.pending > 0 ? 'accent' : undefined}
          />
          <StatCard label="Scheduled" value={stats.scheduled} sub="queued for publish" tone="info" />
          <StatCard label="Published" value={stats.published} sub={`last ${postsLimit} posts`} tone="success" />
        </section>
      )}

      <section>
        <h2 className="eyebrow mb-4">Quick actions</h2>
        <div className="flex gap-3 flex-wrap">
          {actions.map((action) => (
            <ActionLink
              key={`${action.href}:${action.label}`}
              action={action}
              badge={action.key === 'inbox' ? unreadInboxCount : null}
            />
          ))}
        </div>
      </section>

      {showConnectedAccounts && (
        <ConnectedAccounts loading={loading} accounts={accounts} accountsHref={accountsHref} />
      )}

      {showApprovalTabs && (
        <ApprovalPosts
          loading={loading}
          posts={posts}
          actionError={actionError}
          actionLoading={actionLoading}
          commentsByPostId={commentsByPostId}
          expandedPostId={expandedPostId}
          commentTextByPostId={commentTextByPostId}
          commentLoading={commentLoading}
          onAction={handleAction}
          onToggleCommentThread={handleToggleCommentThread}
          onAddComment={handleAddComment}
          onCommentTextChange={(postId, text) =>
            setCommentTextByPostId((prev) => ({ ...prev, [postId]: text }))
          }
        />
      )}

      {showRecentPosts && <RecentPostsList loading={loading} posts={posts} />}
    </div>
  )
}
