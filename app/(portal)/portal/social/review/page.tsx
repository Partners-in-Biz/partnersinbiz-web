'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  scopedApiPath,
  scopedPortalPath,
  scopeFromSearchParams,
  type PortalOrgRouteScope,
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

interface Comment {
  id: string
  text: string
  userId: string
  userName: string
  userRole: 'admin' | 'client' | 'ai'
  kind?: 'note' | 'rejection' | 'agent_handoff'
  createdAt?: TimestampLike
}

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

type MediaItem =
  | string
  | {
      url?: string
      thumbnailUrl?: string
      previewUrl?: string
      alt?: string
    }

interface SocialPost {
  id: string
  content?: { text?: string; hashtags?: string[]; media?: MediaItem[] } | string
  platforms?: string[]
  platform?: string
  status: PostStatus
  scheduledAt?: TimestampLike
  scheduledFor?: TimestampLike
  createdAt?: TimestampLike
  media?: MediaItem[]
  approval?: {
    regenerationCount?: number
    [k: string]: unknown
  }
  comments?: Comment[]
}

const PLATFORM_COLORS: Record<string, { bg: string; label: string }> = {
  twitter: { bg: 'bg-black', label: 'X' },
  x: { bg: 'bg-black', label: 'X' },
  linkedin: { bg: 'bg-blue-700', label: 'LI' },
  facebook: { bg: 'bg-blue-600', label: 'FB' },
  instagram: { bg: 'bg-pink-600', label: 'IG' },
  reddit: { bg: 'bg-orange-600', label: 'RD' },
  tiktok: { bg: 'bg-gray-800', label: 'TT' },
  pinterest: { bg: 'bg-red-700', label: 'PI' },
  bluesky: { bg: 'bg-sky-500', label: 'BS' },
  threads: { bg: 'bg-gray-700', label: 'TH' },
}

function PlatformBadge({ platform }: { platform: string }) {
  const config = PLATFORM_COLORS[platform] ?? { bg: 'bg-gray-600', label: platform.slice(0, 2).toUpperCase() }
  return <span className={`${config.bg} text-white text-[10px] px-2 py-0.5 rounded font-bold`}>{config.label}</span>
}

function getPostText(post: SocialPost): string {
  if (typeof post.content === 'string') return post.content
  if (post.content?.text) return post.content.text
  return ''
}

function getPostPlatforms(post: SocialPost): string[] {
  if (post.platforms?.length) return post.platforms
  if (post.platform) return [post.platform]
  return []
}

function getMedia(post: SocialPost): MediaItem[] {
  if (Array.isArray(post.media) && post.media.length) return post.media
  if (post.content && typeof post.content !== 'string' && Array.isArray(post.content.media) && post.content.media.length) {
    return post.content.media
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
    ? d.toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—'
}

function MediaThumbs({ media }: { media: MediaItem[] }) {
  if (!media.length) return null
  const visible = media.slice(0, 4)
  return (
    <div className="flex gap-1.5 mt-2">
      {visible.map((m, i) => {
        const url = typeof m === 'string' ? m : m?.url || m?.thumbnailUrl || m?.previewUrl
        if (!url) {
          return (
            <div
              key={i}
              className="w-12 h-12 rounded border border-[var(--color-outline-variant)] bg-[var(--color-surface-variant)] flex items-center justify-center text-[10px] text-[var(--color-on-surface-variant)]"
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
            alt=""
            className="w-12 h-12 rounded border border-[var(--color-outline-variant)] object-cover"
          />
        )
      })}
      {media.length > 4 && (
        <div className="w-12 h-12 rounded border border-[var(--color-outline-variant)] bg-[var(--color-surface-variant)] flex items-center justify-center text-[10px] text-[var(--color-on-surface-variant)]">
          +{media.length - 4}
        </div>
      )}
    </div>
  )
}

function ReviewCard({ post, orgScope }: { post: SocialPost; orgScope: PortalOrgRouteScope }) {
  const text = getPostText(post)
  const platforms = getPostPlatforms(post)
  const media = getMedia(post)
  const regenerationCount = post.approval?.regenerationCount ?? 0
  const hasHandoff =
    Array.isArray(post.comments) && post.comments.some((c) => c.kind === 'agent_handoff')

  return (
    <div className="pib-card p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-1.5 flex-wrap">
          {platforms.map((p) => (
            <PlatformBadge key={p} platform={p} />
          ))}
        </div>
        {(hasHandoff || regenerationCount > 0) && (
          <span
            className="text-[10px] font-label uppercase tracking-widest border px-2 py-0.5 flex-shrink-0"
            style={{
              borderColor: 'rgba(245, 158, 11, 0.4)',
              color: 'var(--color-accent-v2)',
              background: 'rgba(245, 158, 11, 0.08)',
            }}
          >
            Revised{regenerationCount > 0 ? ` ×${regenerationCount}` : ''}
          </span>
        )}
      </div>

      <p className="text-sm text-[var(--color-on-surface)] line-clamp-3">
        {text.slice(0, 200)}
        {text.length > 200 ? '…' : ''}
      </p>

      <MediaThumbs media={media} />

      <div className="flex items-center justify-between gap-3 pt-1">
        <div className="text-xs text-[var(--color-on-surface-variant)] space-y-0.5">
          {(post.scheduledAt || post.scheduledFor) && (
            <p>Scheduled: {fmtScheduled(post.scheduledAt ?? post.scheduledFor)}</p>
          )}
          <p>Created {fmtRelative(post.createdAt)}</p>
        </div>
        <Link
          href={scopedPortalPath(`/portal/social/review/${post.id}`, orgScope)}
          className="pib-btn-primary text-xs px-3 py-1.5"
        >
          Open
        </Link>
      </div>
    </div>
  )
}

export default function ClientReviewQueuePage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const socialHref = useMemo(() => scopedPortalPath('/portal/social', orgScope), [orgScope])
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    setError(null)
    try {
      const [clientReviewRes, pendingRes] = await Promise.all([
        fetch(scopedApiPath('/api/v1/social/posts?status=client_review&limit=100', orgScope))
          .then((r) => r.json())
          .catch(() => ({})),
        fetch(scopedApiPath('/api/v1/social/posts?status=pending_approval&limit=100', orgScope))
          .then((r) => r.json())
          .catch(() => ({})),
      ])
      const a: SocialPost[] = clientReviewRes?.data ?? []
      const b: SocialPost[] = pendingRes?.data ?? []
      const merged = new Map<string, SocialPost>()
      for (const p of [...a, ...b]) merged.set(p.id, p)
      const list = Array.from(merged.values()).sort((x, y) => {
        const dx = tsToDate(x.createdAt)?.getTime() ?? 0
        const dy = tsToDate(y.createdAt)?.getTime() ?? 0
        return dy - dx
      })
      setPosts(list)
    } catch {
      setError('Could not load posts. Try refreshing.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [orgScope])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 text-xs text-[var(--color-on-surface-variant)] mb-2">
            <Link href={socialHref} className="hover:text-[var(--color-accent-v2)] transition-colors">
              ← Social
            </Link>
          </div>
          <h1 className="font-headline text-2xl font-bold tracking-tighter">Posts to review</h1>
          <p className="text-sm text-[var(--color-on-surface-variant)] mt-1 max-w-xl">
            Approve, comment on, or send back posts your team has prepared. Once approved, they go to the vault and (if scheduled) into your queue.
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={loading || refreshing}
          className="pib-btn-secondary text-xs px-3 py-1.5 flex-shrink-0"
          style={{
            opacity: loading || refreshing ? 0.6 : 1,
            cursor: loading || refreshing ? 'not-allowed' : 'pointer',
          }}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-900/30 border border-red-400/40 text-red-300 text-sm rounded">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="pib-skeleton p-5 h-36" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="pib-card p-8 text-center">
          <p className="text-[var(--color-on-surface-variant)]">All caught up — no posts waiting for your review.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {posts.map((post) => (
            <ReviewCard key={post.id} post={post} orgScope={orgScope} />
          ))}
        </div>
      )}
    </div>
  )
}
