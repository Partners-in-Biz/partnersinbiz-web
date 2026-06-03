'use client'
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type SocialPostStatus =
  | 'draft'
  | 'qa_review'
  | 'regenerating'
  | 'client_review'
  | 'pending_approval'
  | 'approved'
  | 'vaulted'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'partially_published'
  | 'failed'
  | 'cancelled'

type ViewMode = 'month' | 'week'
type SerializableTimestamp = { _seconds?: number; seconds?: number } | string | number | Date | null | undefined

interface SocialPost {
  id: string
  platform?: string
  platforms?: string[]
  content: string | { text?: string }
  scheduledFor?: SerializableTimestamp
  scheduledAt?: SerializableTimestamp
  status: SocialPostStatus
  error?: string | null
  externalId?: string | null
  category?: string
  tags?: string[]
  media?: Array<{
    id?: string
    url: string
    thumbnailUrl?: string
    type?: 'image' | 'video' | 'gif'
    altText?: string
  }>
}

const PLATFORM_ICONS: Record<string, { label: string; color: string; icon: string }> = {
  twitter: { label: 'X', color: '#000000', icon: 'X' },
  x: { label: 'X', color: '#000000', icon: 'X' },
  linkedin: { label: 'LinkedIn', color: '#0a66c2', icon: 'in' },
  facebook: { label: 'Facebook', color: '#1877f2', icon: 'f' },
  instagram: { label: 'Instagram', color: '#e4405f', icon: 'IG' },
  reddit: { label: 'Reddit', color: '#ff4500', icon: 'r/' },
  tiktok: { label: 'TikTok', color: '#111111', icon: 'TT' },
  pinterest: { label: 'Pinterest', color: '#bd081c', icon: 'P' },
  bluesky: { label: 'Bluesky', color: '#0085ff', icon: 'BS' },
  threads: { label: 'Threads', color: '#111111', icon: '@' },
  youtube: { label: 'YouTube', color: '#ff0000', icon: 'YT' },
  mastodon: { label: 'Mastodon', color: '#6364ff', icon: 'M' },
  dribbble: { label: 'Dribbble', color: '#ea4c89', icon: 'Db' },
}

const STATUS_STYLES: Record<SocialPostStatus, string> = {
  draft: 'border-outline-variant bg-surface-container-high text-on-surface-variant',
  qa_review: 'border-amber-500/40 bg-amber-900/30 text-amber-300',
  regenerating: 'border-purple-500/40 bg-purple-900/30 text-purple-300',
  client_review: 'border-amber-500/40 bg-amber-900/30 text-amber-300',
  pending_approval: 'border-amber-500/40 bg-amber-900/30 text-amber-300',
  approved: 'border-teal-500/40 bg-teal-900/30 text-teal-300',
  vaulted: 'border-purple-500/40 bg-purple-900/30 text-purple-300',
  scheduled: 'border-blue-500/40 bg-blue-900/40 text-blue-300',
  publishing: 'border-blue-500/40 bg-blue-900/40 text-blue-300',
  published: 'border-green-500/40 bg-green-900/40 text-green-300',
  partially_published: 'border-green-500/40 bg-green-900/40 text-green-300',
  failed: 'border-red-500/40 bg-red-900/40 text-red-300',
  cancelled: 'border-outline-variant/30 bg-surface-container text-on-surface-variant/50',
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function tsToDate(ts: SerializableTimestamp): Date | null {
  if (!ts) return null
  if (ts instanceof Date) return ts
  if (typeof ts === 'object' && '_seconds' in ts && ts._seconds) return new Date(ts._seconds * 1000)
  if (typeof ts === 'object' && 'seconds' in ts && ts.seconds) return new Date(ts.seconds * 1000)
  if (typeof ts === 'object') return null
  const date = new Date(ts)
  return Number.isNaN(date.getTime()) ? null : date
}

function getScheduledDate(post: SocialPost): Date | null {
  return tsToDate(post.scheduledAt) ?? tsToDate(post.scheduledFor)
}

function getPostText(post: SocialPost): string {
  if (typeof post.content === 'string') return post.content
  return post.content?.text ?? ''
}

function getPostPlatforms(post: SocialPost): string[] {
  if (post.platforms?.length) return post.platforms
  if (post.platform) return [post.platform]
  return []
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function getCalendarDays(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1)
  let startDow = firstDay.getDay() - 1
  if (startDow < 0) startDow = 6
  const days: Date[] = []
  for (let i = startDow; i > 0; i -= 1) days.push(new Date(year, month, 1 - i))
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  for (let i = 1; i <= daysInMonth; i += 1) days.push(new Date(year, month, i))
  const remaining = 42 - days.length
  for (let i = 1; i <= remaining; i += 1) days.push(new Date(year, month + 1, i))
  return days
}

function getWeekDays(year: number, month: number, day: number): Date[] {
  const d = new Date(year, month, day)
  let dow = d.getDay() - 1
  if (dow < 0) dow = 6
  return Array.from({ length: 7 }, (_, i) => new Date(year, month, day - dow + i))
}

function formatDateTime(date: Date) {
  return date.toLocaleString('en-ZA', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function toDatetimeLocalValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function portalSocialPostUrl(path = '', orgId?: string | null) {
  const params = new URLSearchParams()
  if (orgId) params.set('orgId', orgId)
  const query = params.toString()
  return `/api/v1/portal/social/posts${path}${query ? `?${query}` : ''}`
}

function socialPostsListUrl(orgId?: string | null) {
  const params = new URLSearchParams({ limit: '500' })
  if (orgId) params.set('orgId', orgId)
  return `/api/v1/social/posts?${params.toString()}`
}

function PlatformIcon({ platform }: { platform: string }) {
  const cfg = PLATFORM_ICONS[platform.toLowerCase()]
  if (!cfg) return null
  return (
    <span
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[8px] font-bold leading-none text-white"
      style={{ backgroundColor: cfg.color }}
      title={cfg.label}
    >
      {cfg.icon}
    </span>
  )
}

function PostChip({ post, onSelect }: { post: SocialPost; onSelect: (post: SocialPost) => void }) {
  const scheduledDate = getScheduledDate(post)
  const platforms = getPostPlatforms(post)
  return (
    <button
      type="button"
      onClick={() => onSelect(post)}
      className={`flex w-full items-center gap-1 truncate rounded border px-1.5 py-1 text-left text-[9px] font-medium transition-opacity hover:opacity-80 ${STATUS_STYLES[post.status] ?? STATUS_STYLES.draft}`}
    >
      {platforms.map((platform) => (
        <PlatformIcon key={platform} platform={platform} />
      ))}
      <span className="truncate">{getPostText(post).slice(0, 42)}</span>
      <span className="ml-auto shrink-0 text-[8px] opacity-70">
        {scheduledDate ? scheduledDate.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : ''}
      </span>
    </button>
  )
}

function PostPanel({
  post,
  onClose,
  onPostUpdated,
  orgId,
}: {
  post: SocialPost
  onClose: () => void
  onPostUpdated: (post: SocialPost) => void
  orgId?: string | null
}) {
  const scheduledDate = getScheduledDate(post)
  const platforms = getPostPlatforms(post)
  const [rescheduleValue, setRescheduleValue] = useState(() => toDatetimeLocalValue(scheduledDate ?? new Date()))
  const [busyAction, setBusyAction] = useState<'reschedule' | 'publish' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const canAct = post.status !== 'published' && post.status !== 'cancelled'

  async function handleReschedule() {
    setBusyAction('reschedule')
    setActionError(null)
    setActionMessage(null)
    try {
      const scheduledAt = new Date(rescheduleValue).toISOString()
      const res = await fetch(portalSocialPostUrl(`/${post.id}/reschedule`, orgId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledAt }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? 'Reschedule failed')
      const nextPost = {
        ...post,
        status: 'scheduled' as SocialPostStatus,
        scheduledAt,
        scheduledFor: scheduledAt,
        error: null,
      }
      onPostUpdated(nextPost)
      setActionMessage('Post rescheduled.')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Reschedule failed')
    } finally {
      setBusyAction(null)
    }
  }

  async function handlePublishNow() {
    setBusyAction('publish')
    setActionError(null)
    setActionMessage(null)
    try {
      const res = await fetch(portalSocialPostUrl(`/${post.id}/publish-now`, orgId), {
        method: 'POST',
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? 'Publish failed')
      const nextPost = {
        ...post,
        status: 'published' as SocialPostStatus,
        error: null,
        externalId: body?.data?.externalId ?? post.externalId ?? null,
      }
      onPostUpdated(nextPost)
      setActionMessage('Post published.')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Publish failed'
      setActionError(message)
      onPostUpdated({ ...post, status: 'failed', error: message })
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button className="absolute inset-0 bg-black/40" type="button" aria-label="Close post details" onClick={onClose} />
      <aside className="relative z-50 flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-outline-variant bg-surface-container">
        <div className="flex items-center justify-between border-b border-outline-variant px-5 py-4">
          <h2 className="text-sm font-semibold text-on-surface">Scheduled post</h2>
          <button type="button" onClick={onClose} className="text-xl leading-none text-on-surface-variant transition-colors hover:text-on-surface">
            x
          </button>
        </div>
        <div className="flex-1 space-y-5 p-5">
          <div className="flex flex-wrap items-center gap-2">
            {platforms.map((platform) => (
              <PlatformIcon key={platform} platform={platform} />
            ))}
            <span className={`rounded border px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_STYLES[post.status] ?? STATUS_STYLES.draft}`}>
              {post.status.replaceAll('_', ' ')}
            </span>
          </div>

          {canAct && (
            <div className="rounded-lg border border-outline-variant bg-surface-container-high p-3">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-on-surface-variant">Actions</p>
              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs text-on-surface-variant">New scheduled time</span>
                  <input
                    type="datetime-local"
                    value={rescheduleValue}
                    onChange={(event) => setRescheduleValue(event.target.value)}
                    className="w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm text-on-surface outline-none transition-colors focus:border-[var(--color-pib-accent)]"
                  />
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={handleReschedule}
                    disabled={busyAction !== null || !rescheduleValue}
                    className="btn-pib-secondary justify-center !py-2 !text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-base">event_repeat</span>
                    {busyAction === 'reschedule' ? 'Rescheduling...' : 'Reschedule'}
                  </button>
                  <button
                    type="button"
                    onClick={handlePublishNow}
                    disabled={busyAction !== null}
                    className="btn-pib-accent justify-center !py-2 !text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-base">send</span>
                    {busyAction === 'publish' ? 'Posting...' : 'Post now'}
                  </button>
                </div>
              </div>
              {actionMessage && <p className="mt-3 text-xs text-green-300">{actionMessage}</p>}
              {actionError && <p className="mt-3 text-xs leading-relaxed text-red-300">{actionError}</p>}
            </div>
          )}

          {scheduledDate && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-on-surface-variant">Scheduled for</p>
              <p className="text-sm text-on-surface">{formatDateTime(scheduledDate)}</p>
            </div>
          )}

          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-on-surface-variant">Content</p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-on-surface">{getPostText(post)}</p>
          </div>

          {post.error && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-on-surface-variant">Last error</p>
              <p className="rounded-lg border border-red-500/30 bg-red-950/20 p-3 text-xs leading-relaxed text-red-200">
                {post.error}
              </p>
            </div>
          )}

          {post.media?.length ? (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-on-surface-variant">Media</p>
              <div className="grid grid-cols-2 gap-2">
                {post.media.map((media, index) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={media.id ?? `${media.url}-${index}`}
                    src={media.thumbnailUrl || media.url}
                    alt={media.altText || `Post media ${index + 1}`}
                    className="aspect-square w-full rounded border border-outline-variant object-cover"
                  />
                ))}
              </div>
            </div>
          ) : null}

          {post.category && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-on-surface-variant">Category</p>
              <p className="text-sm capitalize text-on-surface">{post.category}</p>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

export default function PortalSocialCalendarPage() {
  const now = useMemo(() => new Date(), [])
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [weekStart, setWeekStart] = useState(now.getDate() - ((now.getDay() + 6) % 7))
  const [viewMode, setViewMode] = useState<ViewMode>('month')
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPost, setSelectedPost] = useState<SocialPost | null>(null)
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadPosts() {
      try {
        const orgRes = await fetch('/api/v1/portal/org')
        const orgBody = orgRes.ok ? await orgRes.json().catch(() => null) : null
        const orgId = typeof orgBody?.org?.id === 'string' ? orgBody.org.id : null
        if (!cancelled) setActiveOrgId(orgId)

        const postsRes = await fetch(socialPostsListUrl(orgId))
        const postsBody = await postsRes.json().catch(() => ({}))
        if (cancelled) return
        const datedPosts = ((postsBody.data ?? []) as SocialPost[]).filter((post) => getScheduledDate(post))
        setPosts(datedPosts)
      } catch {
        if (!cancelled) setPosts([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadPosts()
    return () => {
      cancelled = true
    }
  }, [])

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const days = viewMode === 'month' ? getCalendarDays(year, month) : getWeekDays(year, month, weekStart)
  const postsForDay = (day: Date) =>
    posts.filter((post) => {
      const scheduledDate = getScheduledDate(post)
      return scheduledDate ? isSameDay(scheduledDate, day) : false
    })

  const handlePostUpdated = (updatedPost: SocialPost) => {
    setPosts((current) => current.map((post) => (post.id === updatedPost.id ? updatedPost : post)))
    setSelectedPost(updatedPost)
  }

  const goPrev = () => {
    if (viewMode === 'month') {
      if (month === 0) {
        setMonth(11)
        setYear((value) => value - 1)
      } else {
        setMonth((value) => value - 1)
      }
    } else {
      const d = new Date(year, month, weekStart - 7)
      setYear(d.getFullYear())
      setMonth(d.getMonth())
      setWeekStart(d.getDate())
    }
    setSelectedPost(null)
  }

  const goNext = () => {
    if (viewMode === 'month') {
      if (month === 11) {
        setMonth(0)
        setYear((value) => value + 1)
      } else {
        setMonth((value) => value + 1)
      }
    } else {
      const d = new Date(year, month, weekStart + 7)
      setYear(d.getFullYear())
      setMonth(d.getMonth())
      setWeekStart(d.getDate())
    }
    setSelectedPost(null)
  }

  const goToday = () => {
    setYear(now.getFullYear())
    setMonth(now.getMonth())
    setWeekStart(now.getDate() - ((now.getDay() + 6) % 7))
    setSelectedPost(null)
  }

  const weekRangeLabel =
    viewMode === 'week' && days.length >= 7
      ? `${days[0].toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })} - ${days[6].toLocaleDateString('en-ZA', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })}`
      : ''

  const visibleCount =
    viewMode === 'month'
      ? posts.filter((post) => {
          const d = getScheduledDate(post)
          return d && d.getFullYear() === year && d.getMonth() === month
        }).length
      : days.reduce((sum, day) => sum + postsForDay(day).length, 0)

  return (
    <div className="space-y-6">
      {selectedPost && (
        <PostPanel
          post={selectedPost}
          onClose={() => setSelectedPost(null)}
          onPostUpdated={handlePostUpdated}
          orgId={activeOrgId}
        />
      )}

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Social calendar</p>
          <h1 className="pib-page-title mt-2">Scheduled posts</h1>
          <p className="pib-page-sub max-w-2xl">See what is planned across your connected social channels.</p>
        </div>
        <Link href="/portal/social/compose" className="btn-pib-accent">
          <span className="material-symbols-outlined text-base">edit</span>
          Compose post
        </Link>
      </header>

      <section className="bento-card !p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={goPrev} className="btn-pib-secondary !px-3 !py-1.5 !text-sm">
            <span className="material-symbols-outlined text-base">chevron_left</span>
            Prev
          </button>
          <h2 className="min-w-[170px] text-center text-sm font-semibold text-on-surface">
            {viewMode === 'month' ? `${MONTH_NAMES[month]} ${year}` : weekRangeLabel}
          </h2>
          <button type="button" onClick={goNext} className="btn-pib-secondary !px-3 !py-1.5 !text-sm">
            Next
            <span className="material-symbols-outlined text-base">chevron_right</span>
          </button>
          <button type="button" onClick={goToday} className="btn-pib-secondary !px-3 !py-1.5 !text-xs">
            Today
          </button>

          <div className="ml-auto flex rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-1">
            {(['month', 'week'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setViewMode(mode)
                  if (mode === 'week') setWeekStart(now.getDate() - ((now.getDay() + 6) % 7))
                }}
                className={[
                  'rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors',
                  viewMode === mode
                    ? 'bg-[var(--color-pib-accent)] text-black'
                    : 'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]',
                ].join(' ')}
              >
                {mode}
              </button>
            ))}
          </div>

          {loading && <span className="text-xs text-on-surface-variant/60">Loading...</span>}
        </div>
      </section>

      <div className="flex flex-wrap gap-2 text-[11px]">
        {[
          ['Scheduled', STATUS_STYLES.scheduled],
          ['Publishing', STATUS_STYLES.publishing],
          ['Approved', STATUS_STYLES.approved],
          ['Published', STATUS_STYLES.published],
          ['Needs review', STATUS_STYLES.client_review],
        ].map(([label, cls]) => (
          <span key={label} className={`rounded border px-2 py-0.5 font-medium ${cls}`}>
            {label}
          </span>
        ))}
      </div>

      <section className="overflow-hidden rounded-xl border border-outline-variant/50 bg-surface-container">
        <div className="grid grid-cols-7 border-b border-outline-variant">
          {DAY_HEADERS.map((day) => (
            <div key={day} className="py-2 text-center text-[10px] font-medium uppercase tracking-wide text-on-surface-variant">
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {days.map((day) => {
            const isCurrentMonth = day.getMonth() === month
            const isToday = isSameDay(day, today)
            const dayPosts = loading ? [] : postsForDay(day)
            const visiblePosts = viewMode === 'week' ? dayPosts : dayPosts.slice(0, 3)
            const extraCount = dayPosts.length - visiblePosts.length
            const minH = viewMode === 'week' ? 'min-h-[200px]' : 'min-h-[96px]'

            return (
              <div
                key={day.toISOString()}
                className={`${minH} border-b border-r border-outline-variant/30 p-1.5 transition-colors ${
                  isCurrentMonth ? 'bg-transparent' : 'bg-surface/30'
                }`}
              >
                <span
                  className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                    !isCurrentMonth ? 'text-on-surface-variant/25' : isToday ? 'bg-white text-black' : 'text-on-surface'
                  }`}
                >
                  {day.getDate()}
                </span>
                <div className="space-y-0.5">
                  {visiblePosts.map((post) => (
                    <PostChip key={post.id} post={post} onSelect={setSelectedPost} />
                  ))}
                  {extraCount > 0 && <span className="pl-1 text-[9px] text-on-surface-variant/60">+{extraCount} more</span>}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {!loading && (
        <p className="text-right text-xs text-on-surface-variant">
          {visibleCount} {visibleCount === 1 ? 'post' : 'posts'} {viewMode === 'month' ? `in ${MONTH_NAMES[month]}` : 'this week'}
        </p>
      )}
    </div>
  )
}
