'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type TimestampLike = { _seconds?: number; seconds?: number } | string | number | Date | null | undefined

type PlatformResult = {
  platform?: string
  platformPostUrl?: string
}

interface HistoryPost {
  id: string
  content: string | { text?: string }
  status: string
  platform?: string
  platforms?: string[]
  category?: string
  createdAt?: TimestampLike
  publishedAt?: TimestampLike
  scheduledAt?: TimestampLike
  scheduledFor?: TimestampLike
  platformResults?: Record<string, PlatformResult>
  externalId?: string | null
  error?: string | null
}

interface SocialHistoryWorkspaceProps {
  title?: string
  description?: string
  limit?: number
  buildApiPath?: (path: string) => string
  statusOptions?: string[]
  visibleStatuses?: string[]
  showPlatformFilter?: boolean
  emptyMessage?: string
}

const PLATFORM_CONFIG: Record<string, { bg: string; label: string }> = {
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
  youtube: { bg: 'bg-red-600', label: 'YT' },
  mastodon: { bg: 'bg-purple-600', label: 'MA' },
  dribbble: { bg: 'bg-pink-500', label: 'DR' },
}

const STATUS_STYLES: Record<string, string> = {
  published: 'border-green-400/40 text-green-300',
  failed: 'border-red-400/40 text-red-300',
  scheduled: 'border-blue-400/40 text-blue-300',
  draft: 'border-[var(--color-outline-variant)] text-[var(--color-on-surface-variant)]',
  cancelled: 'border-[var(--color-outline-variant)] text-[var(--color-on-surface-variant)] line-through',
}

const DEFAULT_STATUS_OPTIONS = ['all', 'published', 'scheduled', 'draft', 'failed', 'cancelled']

function statusLabel(status: string): string {
  if (status === 'all') return 'All'
  return status.replace(/[_-]+/g, ' ')
}

function getPostText(post: HistoryPost): string {
  if (typeof post.content === 'string') return post.content
  if (post.content?.text) return post.content.text
  return ''
}

function getPostPlatforms(post: HistoryPost): string[] {
  if (post.platforms?.length) return post.platforms
  if (post.platform) return [post.platform]
  return []
}

function tsToDate(ts: TimestampLike): Date | null {
  if (!ts) return null
  if (ts instanceof Date) return ts
  if (typeof ts === 'object') {
    if (typeof ts._seconds === 'number') return new Date(ts._seconds * 1000)
    if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000)
    return null
  }
  const date = new Date(ts)
  return Number.isNaN(date.getTime()) ? null : date
}

function fmtDateTime(ts: TimestampLike) {
  const date = tsToDate(ts)
  return date
    ? date.toLocaleString('en-ZA', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Date missing'
}

function platformPostUrl(platform: string | undefined, externalId: string | null | undefined): string | null {
  if (!externalId) return null
  if (platform === 'x' || platform === 'twitter') return `https://x.com/i/web/status/${externalId}`
  return null
}

function PlatformPill({ platform }: { platform: string }) {
  const cfg = PLATFORM_CONFIG[platform] ?? { bg: 'bg-gray-600', label: platform.slice(0, 2).toUpperCase() }
  return (
    <span className={`${cfg.bg} rounded px-2 py-0.5 text-[10px] font-bold text-white`}>
      {cfg.label}
    </span>
  )
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`border px-2 py-0.5 text-[10px] font-label uppercase tracking-widest ${STATUS_STYLES[status] ?? 'border-[var(--color-outline-variant)] text-[var(--color-on-surface-variant)]'}`}>
      {statusLabel(status)}
    </span>
  )
}

function PostTimeline({ post }: { post: HistoryPost }) {
  if (post.status === 'published' && post.publishedAt) {
    return <span>Published: {fmtDateTime(post.publishedAt)}</span>
  }
  const scheduledAt = post.scheduledAt ?? post.scheduledFor
  if (post.status === 'scheduled' && scheduledAt) {
    return <span>Scheduled: {fmtDateTime(scheduledAt)}</span>
  }
  return <span>Created: {fmtDateTime(post.createdAt)}</span>
}

export default function SocialHistoryWorkspace({
  title = 'Post History',
  description = 'View all published and scheduled posts.',
  limit = 100,
  buildApiPath,
  statusOptions = DEFAULT_STATUS_OPTIONS,
  visibleStatuses,
  showPlatformFilter = false,
  emptyMessage = 'No posts found.',
}: SocialHistoryWorkspaceProps) {
  const [posts, setPosts] = useState<HistoryPost[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [platformFilter, setPlatformFilter] = useState('all')

  const apiPath = useCallback((path: string) => buildApiPath?.(path) ?? path, [buildApiPath])

  const fetchPosts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath(`/api/v1/social/posts?limit=${limit}`))
      const body = await res.json()
      setPosts(body.data ?? [])
    } catch {
      setPosts([])
    } finally {
      setLoading(false)
    }
  }, [apiPath, limit])

  useEffect(() => {
    fetchPosts()
  }, [fetchPosts])

  const visibleStatusSet = useMemo(() => visibleStatuses ? new Set(visibleStatuses) : null, [visibleStatuses])

  const platformOptions = useMemo(() => {
    const values = new Set<string>()
    posts.forEach(post => getPostPlatforms(post).forEach(platform => values.add(platform)))
    return ['all', ...Array.from(values).sort()]
  }, [posts])

  const filteredPosts = useMemo(() => {
    return posts.filter(post => {
      if (visibleStatusSet && !visibleStatusSet.has(post.status)) return false
      if (statusFilter !== 'all' && post.status !== statusFilter) return false
      if (platformFilter !== 'all' && !getPostPlatforms(post).includes(platformFilter)) return false
      return true
    })
  }, [platformFilter, posts, statusFilter, visibleStatusSet])

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="font-headline text-2xl font-bold tracking-tighter text-[var(--color-on-surface)]">{title}</h1>
        <p className="mt-1 text-sm text-[var(--color-on-surface-variant)]">{description}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {statusOptions.map(status => (
          <button
            key={status}
            type="button"
            onClick={() => setStatusFilter(status)}
            className={`px-3 py-1.5 text-xs font-label uppercase tracking-widest transition-colors ${
              statusFilter === status ? 'pib-btn-primary' : 'pib-btn-secondary'
            }`}
          >
            {statusLabel(status)}
          </button>
        ))}
      </div>

      {showPlatformFilter && (
        <div className="flex flex-wrap gap-2">
          {platformOptions.map(platform => (
            <button
              key={platform}
              type="button"
              onClick={() => setPlatformFilter(platform)}
              className={`px-3 py-1.5 text-xs font-label uppercase tracking-widest transition-colors ${
                platformFilter === platform ? 'pib-btn-primary' : 'pib-btn-secondary'
              }`}
            >
              {platform === 'all' ? 'All Platforms' : PLATFORM_CONFIG[platform]?.label ?? platform}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, index) => (
            <div key={index} className="pib-skeleton h-24" />
          ))}
        </div>
      ) : filteredPosts.length === 0 ? (
        <div className="pib-card p-8 text-center">
          <p className="text-sm text-[var(--color-on-surface-variant)]">{emptyMessage}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredPosts.map(post => {
            const text = getPostText(post)
            const platforms = getPostPlatforms(post)
            const platformResults = post.platformResults ?? {}
            const legacyUrl = platformPostUrl(post.platform, post.externalId)

            return (
              <article key={post.id} className="pib-card p-4 space-y-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-start">
                  <div className="flex flex-wrap gap-1 md:w-28">
                    {platforms.length > 0 ? (
                      platforms.map(platform => <PlatformPill key={platform} platform={platform} />)
                    ) : (
                      <span className="text-xs text-[var(--color-on-surface-variant)]">No platform</span>
                    )}
                  </div>
                  <p className="min-w-0 flex-1 text-sm text-[var(--color-on-surface)]">
                    {text ? `${text.slice(0, 160)}${text.length > 160 ? '...' : ''}` : 'No post content'}
                  </p>
                  <StatusPill status={post.status} />
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--color-on-surface-variant)]">
                  <PostTimeline post={post} />
                  {post.category && <span className="capitalize">Category: {post.category}</span>}
                  {Object.values(platformResults).map(result => (
                    result.platformPostUrl ? (
                      <a
                        key={result.platformPostUrl}
                        href={result.platformPostUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-[var(--color-on-surface)]"
                      >
                        View on {result.platform ?? 'platform'}
                      </a>
                    ) : null
                  ))}
                  {legacyUrl && (
                    <a
                      href={legacyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-[var(--color-on-surface)]"
                    >
                      View post
                    </a>
                  )}
                  {post.externalId && !legacyUrl && !Object.keys(platformResults).length && (
                    <span className="font-mono">External ID: {post.externalId}</span>
                  )}
                </div>

                {post.error && (
                  <p className="text-xs text-red-300">{post.error}</p>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
