'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'

export type SocialCalendarPostStatus =
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

export type SocialCalendarTimestamp = { _seconds?: number; seconds?: number } | string | number | Date | null | undefined

export interface SocialCalendarPost {
  id: string
  platform?: string
  platforms?: string[]
  content: string | { text?: string }
  threadParts?: string[]
  scheduledFor?: SocialCalendarTimestamp
  scheduledAt?: SocialCalendarTimestamp
  status: SocialCalendarPostStatus
  publishedAt?: SocialCalendarTimestamp
  externalId?: string | null
  error?: string | null
  category?: string
  tags?: string[]
  createdBy?: string
  createdAt?: SocialCalendarTimestamp
  updatedAt?: SocialCalendarTimestamp
  media?: Array<{
    id?: string
    url: string
    thumbnailUrl?: string
    type?: 'image' | 'video' | 'gif'
    altText?: string
    width?: number
    height?: number
  }>
}

type ViewMode = 'month' | 'week'
type PanelAction = 'reschedule' | 'publish' | 'cancel'

type SocialCalendarAction = (post: SocialCalendarPost) => Promise<SocialCalendarPost | void> | SocialCalendarPost | void
type SocialCalendarRescheduleAction = (
  post: SocialCalendarPost,
  scheduledAt: Date,
) => Promise<SocialCalendarPost | void> | SocialCalendarPost | void

interface SocialCalendarWorkspaceProps {
  posts: SocialCalendarPost[]
  loading?: boolean
  eyebrow?: string
  title: string
  description: string
  composeHref: string
  composeLabel?: string
  wrapperClassName?: string
  allowDayCreate?: boolean
  allowDragReschedule?: boolean
  closePanelAfterActions?: boolean
  failPostOnPublishError?: boolean
  publishableStatuses?: SocialCalendarPostStatus[]
  onCreateForDay?: (day: Date) => void
  onPostUpdated?: (post: SocialCalendarPost) => void
  onPublishNow?: SocialCalendarAction
  onCancelPost?: SocialCalendarAction
  onReschedulePost?: SocialCalendarRescheduleAction
  editHref?: (post: SocialCalendarPost) => string
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

function isVideoSource(value: string | undefined): boolean {
  if (!value) return false
  return /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(value)
}

function isVideoMedia(media: NonNullable<SocialCalendarPost['media']>[number]): boolean {
  return media.type === 'video' || isVideoSource(media.url) || isVideoSource(media.thumbnailUrl)
}

const STATUS_STYLES: Record<SocialCalendarPostStatus, string> = {
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
const DEFAULT_PUBLISHABLE_STATUSES: SocialCalendarPostStatus[] = ['approved', 'scheduled', 'failed']
const DRAGGABLE_STATUSES: SocialCalendarPostStatus[] = ['draft', 'scheduled']
const CANCELABLE_STATUSES: SocialCalendarPostStatus[] = ['draft', 'scheduled']

export function tsToDate(ts: SocialCalendarTimestamp): Date | null {
  if (!ts) return null
  if (ts instanceof Date) return ts
  if (typeof ts === 'object' && '_seconds' in ts && ts._seconds) return new Date(ts._seconds * 1000)
  if (typeof ts === 'object' && 'seconds' in ts && ts.seconds) return new Date(ts.seconds * 1000)
  if (typeof ts === 'object') return null
  const date = new Date(ts)
  return Number.isNaN(date.getTime()) ? null : date
}

export function getScheduledDate(post: SocialCalendarPost): Date | null {
  return tsToDate(post.scheduledAt) ?? tsToDate(post.scheduledFor)
}

export function toDatetimeLocalValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
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

function formatTime(date: Date | null) {
  return date ? date.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : ''
}

function getPostText(post: SocialCalendarPost): string {
  if (typeof post.content === 'string') return post.content
  return post.content?.text ?? ''
}

function getPostPlatforms(post: SocialCalendarPost): string[] {
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

function PostChip({
  post,
  draggable,
  onSelect,
  onDragStart,
}: {
  post: SocialCalendarPost
  draggable: boolean
  onSelect: (post: SocialCalendarPost) => void
  onDragStart: (event: DragEvent<HTMLButtonElement>, post: SocialCalendarPost) => void
}) {
  const scheduledDate = getScheduledDate(post)
  const platforms = getPostPlatforms(post)

  return (
    <button
      type="button"
      draggable={draggable}
      onClick={() => onSelect(post)}
      onDragStart={(event) => onDragStart(event, post)}
      className={`flex w-full items-center gap-1 truncate rounded border px-1.5 py-1 text-left text-[9px] font-medium transition-opacity hover:opacity-80 ${
        draggable ? 'cursor-grab active:cursor-grabbing' : ''
      } ${STATUS_STYLES[post.status] ?? STATUS_STYLES.draft}`}
    >
      {platforms.map((platform) => (
        <PlatformIcon key={platform} platform={platform} />
      ))}
      <span className="truncate">{getPostText(post).slice(0, 42)}</span>
      <span className="ml-auto shrink-0 text-[8px] opacity-70">{formatTime(scheduledDate)}</span>
    </button>
  )
}

function PostPanel({
  post,
  onClose,
  onPostUpdated,
  onPublishNow,
  onCancelPost,
  onReschedulePost,
  editHref,
  publishableStatuses,
  closePanelAfterActions,
  failPostOnPublishError,
}: {
  post: SocialCalendarPost
  onClose: () => void
  onPostUpdated?: (post: SocialCalendarPost) => void
  onPublishNow?: SocialCalendarAction
  onCancelPost?: SocialCalendarAction
  onReschedulePost?: SocialCalendarRescheduleAction
  editHref?: (post: SocialCalendarPost) => string
  publishableStatuses: SocialCalendarPostStatus[]
  closePanelAfterActions?: boolean
  failPostOnPublishError?: boolean
}) {
  const scheduledDate = getScheduledDate(post)
  const platforms = getPostPlatforms(post)
  const [rescheduleValue, setRescheduleValue] = useState(() => toDatetimeLocalValue(scheduledDate ?? new Date()))
  const [busyAction, setBusyAction] = useState<PanelAction | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const canAct = post.status !== 'published' && post.status !== 'cancelled'
  const canPublish = Boolean(onPublishNow) && publishableStatuses.includes(post.status)
  const canCancel = Boolean(onCancelPost) && CANCELABLE_STATUSES.includes(post.status)
  const canReschedule = Boolean(onReschedulePost) && canAct
  const editUrl = editHref?.(post)

  const applyUpdatedPost = (updatedPost: SocialCalendarPost | void, fallback: SocialCalendarPost) => {
    const nextPost = updatedPost ?? fallback
    onPostUpdated?.(nextPost)
    return nextPost
  }

  async function runPanelAction(action: PanelAction, work: () => Promise<SocialCalendarPost | void>, successMessage: string) {
    setBusyAction(action)
    setActionError(null)
    setActionMessage(null)
    try {
      await work()
      setActionMessage(successMessage)
      if (closePanelAfterActions) onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : `${successMessage} failed`
      setActionError(message)
      if (action === 'publish' && failPostOnPublishError) {
        onPostUpdated?.({ ...post, status: 'failed', error: message })
      }
    } finally {
      setBusyAction(null)
    }
  }

  const handleReschedule = () =>
    runPanelAction(
      'reschedule',
      async () => {
        if (!onReschedulePost) return
        const scheduledAt = new Date(rescheduleValue)
        const updatedPost = await onReschedulePost(post, scheduledAt)
        applyUpdatedPost(updatedPost, {
          ...post,
          status: 'scheduled',
          scheduledAt: scheduledAt.toISOString(),
          scheduledFor: scheduledAt.toISOString(),
          error: null,
        })
      },
      'Post rescheduled.',
    )

  const handlePublishNow = () =>
    runPanelAction(
      'publish',
      async () => {
        if (!onPublishNow) return
        const updatedPost = await onPublishNow(post)
        applyUpdatedPost(updatedPost, {
          ...post,
          status: 'published',
          error: null,
        })
      },
      'Post published.',
    )

  const handleCancel = () =>
    runPanelAction(
      'cancel',
      async () => {
        if (!onCancelPost) return
        const updatedPost = await onCancelPost(post)
        applyUpdatedPost(updatedPost, { ...post, status: 'cancelled' })
      },
      'Post cancelled.',
    )

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

          {(canReschedule || canPublish || editUrl || canCancel) && (
            <div className="rounded-lg border border-outline-variant bg-surface-container-high p-3">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-on-surface-variant">Actions</p>
              <div className="space-y-3">
                {canReschedule && (
                  <label className="block">
                    <span className="mb-1 block text-xs text-on-surface-variant">New scheduled time</span>
                    <input
                      type="datetime-local"
                      value={rescheduleValue}
                      onChange={(event) => setRescheduleValue(event.target.value)}
                      className="w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm text-on-surface outline-none transition-colors focus:border-[var(--color-pib-accent)]"
                    />
                  </label>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  {canReschedule && (
                    <button
                      type="button"
                      onClick={handleReschedule}
                      disabled={busyAction !== null || !rescheduleValue}
                      className="btn-pib-secondary justify-center !py-2 !text-xs disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-base">event_repeat</span>
                      {busyAction === 'reschedule' ? 'Rescheduling...' : 'Reschedule'}
                    </button>
                  )}
                  {canPublish && (
                    <button
                      type="button"
                      onClick={handlePublishNow}
                      disabled={busyAction !== null}
                      className="btn-pib-accent justify-center !py-2 !text-xs disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-base">send</span>
                      {busyAction === 'publish' ? 'Posting...' : 'Post now'}
                    </button>
                  )}
                  {editUrl && (
                    <Link href={editUrl} className="btn-pib-secondary justify-center !py-2 !text-xs">
                      <span className="material-symbols-outlined text-base">edit</span>
                      Edit
                    </Link>
                  )}
                  {canCancel && (
                    <button
                      type="button"
                      onClick={handleCancel}
                      disabled={busyAction !== null}
                      className="justify-center rounded-lg border border-red-500/30 bg-red-950/30 px-3 py-2 text-xs font-medium text-red-300 transition-colors hover:bg-red-950/50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busyAction === 'cancel' ? 'Cancelling...' : 'Cancel post'}
                    </button>
                  )}
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
              <p className="rounded-lg border border-red-500/30 bg-red-950/20 p-3 text-xs leading-relaxed text-red-200">{post.error}</p>
            </div>
          )}

          {post.media?.length ? (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-on-surface-variant">Media</p>
              <div className="grid grid-cols-2 gap-2">
                {post.media.map((media, index) => (
                  isVideoMedia(media) ? (
                    <video
                      key={media.id ?? `${media.url}-${index}`}
                      src={media.url || media.thumbnailUrl}
                      poster={!isVideoSource(media.thumbnailUrl) ? media.thumbnailUrl : undefined}
                      muted
                      playsInline
                      preload="metadata"
                      aria-label={media.altText || `Post media ${index + 1}`}
                      className="aspect-square w-full rounded border border-outline-variant object-cover"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={media.id ?? `${media.url}-${index}`}
                      src={media.thumbnailUrl || media.url}
                      alt={media.altText || `Post media ${index + 1}`}
                      className="aspect-square w-full rounded border border-outline-variant object-cover"
                    />
                  )
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

export function SocialCalendarWorkspace({
  posts,
  loading = false,
  eyebrow,
  title,
  description,
  composeHref,
  composeLabel = 'Compose post',
  wrapperClassName = 'space-y-6',
  allowDayCreate,
  allowDragReschedule,
  closePanelAfterActions,
  failPostOnPublishError,
  publishableStatuses = DEFAULT_PUBLISHABLE_STATUSES,
  onCreateForDay,
  onPostUpdated,
  onPublishNow,
  onCancelPost,
  onReschedulePost,
  editHref,
}: SocialCalendarWorkspaceProps) {
  const now = useMemo(() => new Date(), [])
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [weekStart, setWeekStart] = useState(now.getDate() - ((now.getDay() + 6) % 7))
  const [viewMode, setViewMode] = useState<ViewMode>('month')
  const [selectedPost, setSelectedPost] = useState<SocialCalendarPost | null>(null)
  const [dragOverDay, setDragOverDay] = useState<string | null>(null)
  const dragPostRef = useRef<SocialCalendarPost | null>(null)

  const today = useMemo(() => {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    return date
  }, [])

  const days = viewMode === 'month' ? getCalendarDays(year, month) : getWeekDays(year, month, weekStart)
  const postsForDay = (day: Date) =>
    posts.filter((post) => {
      const scheduledDate = getScheduledDate(post)
      return scheduledDate ? isSameDay(scheduledDate, day) : false
    })

  const selectedFreshPost = selectedPost ? posts.find((post) => post.id === selectedPost.id) ?? selectedPost : null
  const canDragPost = (post: SocialCalendarPost) => Boolean(allowDragReschedule && onReschedulePost && DRAGGABLE_STATUSES.includes(post.status))

  const goPrev = () => {
    if (viewMode === 'month') {
      if (month === 0) {
        setMonth(11)
        setYear((value) => value - 1)
      } else {
        setMonth((value) => value - 1)
      }
    } else {
      const date = new Date(year, month, weekStart - 7)
      setYear(date.getFullYear())
      setMonth(date.getMonth())
      setWeekStart(date.getDate())
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
      const date = new Date(year, month, weekStart + 7)
      setYear(date.getFullYear())
      setMonth(date.getMonth())
      setWeekStart(date.getDate())
    }
    setSelectedPost(null)
  }

  const goToday = () => {
    setYear(now.getFullYear())
    setMonth(now.getMonth())
    setWeekStart(now.getDate() - ((now.getDay() + 6) % 7))
    setSelectedPost(null)
  }

  const handleDragStart = (_event: DragEvent<HTMLButtonElement>, post: SocialCalendarPost) => {
    dragPostRef.current = post
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>, dayKey: string) => {
    if (!allowDragReschedule || !onReschedulePost) return
    event.preventDefault()
    setDragOverDay(dayKey)
  }

  const handleDrop = async (event: DragEvent<HTMLDivElement>, targetDay: Date) => {
    if (!allowDragReschedule || !onReschedulePost) return
    event.preventDefault()
    setDragOverDay(null)
    const post = dragPostRef.current
    dragPostRef.current = null
    if (!post || !canDragPost(post)) return

    const originalDate = getScheduledDate(post) ?? new Date()
    const newDate = new Date(
      targetDay.getFullYear(),
      targetDay.getMonth(),
      targetDay.getDate(),
      originalDate.getHours(),
      originalDate.getMinutes(),
    )

    try {
      const updatedPost = await onReschedulePost(post, newDate)
      if (updatedPost) onPostUpdated?.(updatedPost)
    } catch {
      // Route wrappers own error recovery and refresh behavior.
    }
  }

  const handlePostUpdated = (post: SocialCalendarPost) => {
    setSelectedPost(post)
    onPostUpdated?.(post)
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
          const scheduledDate = getScheduledDate(post)
          return scheduledDate && scheduledDate.getFullYear() === year && scheduledDate.getMonth() === month
        }).length
      : days.reduce((sum, day) => sum + postsForDay(day).length, 0)

  return (
    <div className={wrapperClassName}>
      {selectedFreshPost && (
        <PostPanel
          key={selectedFreshPost.id}
          post={selectedFreshPost}
          onClose={() => setSelectedPost(null)}
          onPostUpdated={handlePostUpdated}
          onPublishNow={onPublishNow}
          onCancelPost={onCancelPost}
          onReschedulePost={onReschedulePost}
          editHref={editHref}
          publishableStatuses={publishableStatuses}
          closePanelAfterActions={closePanelAfterActions}
          failPostOnPublishError={failPostOnPublishError}
        />
      )}

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1 className={eyebrow ? 'pib-page-title mt-2' : 'text-2xl font-semibold text-on-surface'}>{title}</h1>
          <p className={eyebrow ? 'pib-page-sub max-w-2xl' : 'mt-1 text-sm text-on-surface-variant'}>{description}</p>
        </div>
        <Link href={composeHref} className="btn-pib-accent">
          <span className="material-symbols-outlined text-base">edit</span>
          {composeLabel}
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
          ['Failed', STATUS_STYLES.failed],
          ['Draft', STATUS_STYLES.draft],
        ].map(([label, className]) => (
          <span key={label} className={`rounded border px-2 py-0.5 font-medium ${className}`}>
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
            const dayPosts = loading ? [] : postsForDay(day)
            const dayKey = day.toISOString().slice(0, 10)
            const isDragOver = dragOverDay === dayKey
            const visiblePosts = viewMode === 'week' ? dayPosts : dayPosts.slice(0, 3)
            const extraCount = dayPosts.length - visiblePosts.length
            const minHeight = viewMode === 'week' ? 'min-h-[200px]' : 'min-h-[96px]'

            return (
              <div
                key={day.toISOString()}
                className={`${minHeight} border-b border-r border-outline-variant/30 p-1.5 transition-colors ${
                  isCurrentMonth ? 'bg-transparent' : 'bg-surface/30'
                } ${isDragOver ? 'bg-blue-900/20 ring-1 ring-blue-500/40 ring-inset' : allowDayCreate ? 'hover:bg-surface-container-high/30' : ''}`}
                onDragOver={(event) => handleDragOver(event, dayKey)}
                onDragLeave={() => setDragOverDay(null)}
                onDrop={(event) => handleDrop(event, day)}
                onDoubleClick={allowDayCreate && onCreateForDay ? () => onCreateForDay(day) : undefined}
              >
                <span
                  className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                    !isCurrentMonth ? 'text-on-surface-variant/25' : isSameDay(day, today) ? 'bg-white text-black' : 'text-on-surface'
                  }`}
                >
                  {day.getDate()}
                </span>
                <div className="space-y-0.5">
                  {visiblePosts.map((post) => (
                    <PostChip key={post.id} post={post} draggable={canDragPost(post)} onSelect={setSelectedPost} onDragStart={handleDragStart} />
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
