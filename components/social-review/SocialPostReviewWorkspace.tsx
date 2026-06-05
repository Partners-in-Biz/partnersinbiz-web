'use client'

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'

export type SocialReviewTimestamp =
  | string
  | number
  | Date
  | {
      seconds?: number
      _seconds?: number
    }
  | null
  | undefined

export type SocialReviewMedia =
  | string
  | {
      id?: string
      url?: string
      thumbnailUrl?: string
      previewUrl?: string
      type?: string
      alt?: string
      caption?: string
    }

export interface SocialPostReviewPost {
  id: string
  content?: { text?: string; hashtags?: string[]; media?: SocialReviewMedia[] } | string
  originalContent?: { text?: string } | string
  hashtags?: string[]
  platforms?: string[]
  platform?: string
  createdBy?: string
  createdByName?: string
  status?: string
  deliveryMode?: string
  scheduledAt?: SocialReviewTimestamp
  scheduledFor?: SocialReviewTimestamp
  createdAt?: SocialReviewTimestamp
  mediaCount?: number
  media?: SocialReviewMedia[]
  comments?: SocialPostReviewComment[]
  aiPrompt?: string
  prompt?: string
  approval?: {
    regenerationCount?: number
    rejectionReason?: string
    [key: string]: unknown
  }
}

export interface SocialPostReviewComment {
  id: string
  text: string
  userId?: string
  userName?: string
  userRole?: 'admin' | 'client' | 'ai' | string
  kind?: 'note' | 'rejection' | 'qa_rejection' | 'client_rejection' | 'agent_handoff' | string
  createdAt?: SocialReviewTimestamp
  agentPickedUp?: boolean
}

interface ReviewNotice {
  type: 'success' | 'error' | 'info'
  text: string
}

interface ReviewButtonAction {
  label: string
  busyLabel?: string
  helpText?: string
  disabled?: boolean
  busy?: boolean
  onAction: () => Promise<boolean | void> | boolean | void
}

interface ReviewRejectAction {
  label: string
  submitLabel: string
  busyLabel?: string
  placeholder: string
  disabled?: boolean
  busy?: boolean
  minLength?: number
  onReject: (reason: string) => Promise<boolean | void> | boolean | void
}

export interface SocialPostReviewWorkspaceProps {
  loading: boolean
  loadError?: string | null
  post: SocialPostReviewPost | null
  comments: SocialPostReviewComment[]
  commentsLoading?: boolean
  backHref: string
  backLabel: string
  title: string
  eyebrow?: string
  statusLabel?: string
  notice?: ReviewNotice | null
  decisionTitle: string
  decisionDescription?: ReactNode
  approveAction?: ReviewButtonAction
  secondaryApproveAction?: ReviewButtonAction
  rejectAction?: ReviewRejectAction
  manualAction?: ReviewButtonAction
  unavailableActionMessage?: string | null
  conversationTitle?: string
  emptyCommentsLabel?: string
  notePlaceholder?: string
  noteSubmitLabel?: string
  noteBusyLabel?: string
  commentBusy?: boolean
  onAddComment?: (text: string) => Promise<boolean | void> | boolean | void
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
  youtube: { bg: 'bg-red-600', label: 'YT', full: 'YouTube' },
  mastodon: { bg: 'bg-purple-600', label: 'MA', full: 'Mastodon' },
  dribbble: { bg: 'bg-pink-500', label: 'DR', full: 'Dribbble' },
}

const STATUS_LABEL: Record<string, string> = {
  client_review: 'awaiting review',
  pending_approval: 'awaiting review',
  qa_review: 'QA review',
  regenerating: 'regenerating',
  approved: 'approved',
  vaulted: 'vaulted',
  scheduled: 'scheduled',
  publishing: 'publishing',
  published: 'published',
  partially_published: 'partially published',
  failed: 'failed',
  cancelled: 'cancelled',
  draft: 'draft',
}

const COMMENT_KIND_META: Record<string, { label: string; tone: string }> = {
  note: { label: 'Note', tone: 'bg-surface-container-high text-on-surface-variant' },
  rejection: { label: 'Sent back', tone: 'bg-red-500/10 text-red-300' },
  qa_rejection: { label: 'QA rejection', tone: 'bg-red-500/10 text-red-300' },
  client_rejection: { label: 'Client rejection', tone: 'bg-rose-500/10 text-rose-300' },
  agent_handoff: { label: 'Revised', tone: 'bg-indigo-500/10 text-indigo-300' },
}

export function tsToDate(ts: SocialReviewTimestamp): Date | null {
  if (!ts) return null
  if (ts instanceof Date) return ts
  if (typeof ts === 'number' || typeof ts === 'string') return new Date(ts)
  if (ts._seconds) return new Date(ts._seconds * 1000)
  if (ts.seconds) return new Date(ts.seconds * 1000)
  return null
}

export function fmtRelative(ts: SocialReviewTimestamp): string {
  const date = tsToDate(ts)
  if (!date) return '-'

  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })
}

export function fmtScheduled(ts: SocialReviewTimestamp): string {
  const date = tsToDate(ts)
  return date
    ? date.toLocaleString('en-ZA', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '-'
}

export function getPostText(post?: SocialPostReviewPost | null): string {
  if (typeof post?.content === 'string') return post.content
  if (post?.content?.text) return post.content.text
  return ''
}

function getOriginalText(post?: SocialPostReviewPost | null): string {
  if (!post?.originalContent) return ''
  if (typeof post.originalContent === 'string') return post.originalContent
  if (post.originalContent.text) return post.originalContent.text
  return ''
}

export function getPostPlatforms(post?: SocialPostReviewPost | null): string[] {
  if (post?.platforms?.length) return post.platforms
  if (post?.platform) return [post.platform]
  return []
}

export function getMedia(post?: SocialPostReviewPost | null): SocialReviewMedia[] {
  if (Array.isArray(post?.media) && post.media.length) return post.media
  if (post?.content && typeof post.content !== 'string' && Array.isArray(post.content.media)) {
    return post.content.media
  }
  return []
}

function getHashtags(post?: SocialPostReviewPost | null): string[] {
  if (Array.isArray(post?.hashtags) && post.hashtags.length) return post.hashtags
  if (post?.content && typeof post.content !== 'string' && Array.isArray(post.content.hashtags)) {
    return post.content.hashtags
  }
  return []
}

export function mediaUrl(media: SocialReviewMedia): string {
  if (typeof media === 'string') return media
  return media.url ?? media.thumbnailUrl ?? media.previewUrl ?? ''
}

function mediaType(media: SocialReviewMedia): string {
  if (typeof media === 'string') return /\.(mp4|mov|webm)$/i.test(media) ? 'video' : 'image'
  return media.type ?? (/\.(mp4|mov|webm)$/i.test(mediaUrl(media)) ? 'video' : 'image')
}

function visibleStatus(status?: string): string {
  if (!status) return 'in progress'
  return STATUS_LABEL[status] ?? status.replace(/_/g, ' ')
}

export function PlatformChip({ platform }: { platform: string }) {
  const config = PLATFORM_COLORS[platform] ?? {
    bg: 'bg-surface-container-high',
    label: platform.slice(0, 2).toUpperCase(),
    full: platform,
  }

  return (
    <span className="inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full bg-surface-container-high text-xs">
      <span className={`${config.bg} text-white text-[9px] px-1.5 py-0.5 rounded font-bold`}>
        {config.label}
      </span>
      <span className="text-on-surface">{config.full}</span>
    </span>
  )
}

function Notice({ notice }: { notice: ReviewNotice }) {
  const border =
    notice.type === 'success' ? '#4ade80' : notice.type === 'error' ? '#ef4444' : 'var(--color-accent-v2)'

  return (
    <div className="fixed top-20 right-4 z-50 max-w-sm">
      <div
        className="px-4 py-3 rounded-[var(--radius-card)] shadow-lg text-sm"
        style={{
          background: 'var(--color-sidebar, var(--color-surface))',
          border: `1px solid ${border}`,
          color: 'var(--color-on-surface, var(--color-pib-text))',
        }}
      >
        {notice.text}
      </div>
    </div>
  )
}

function MediaGrid({ media }: { media: SocialReviewMedia[] }) {
  if (!media.length) return null

  return (
    <div>
      <p className="eyebrow mb-2">
        Media - {media.length} {media.length === 1 ? 'item' : 'items'}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {media.map((item, index) => {
          const url = mediaUrl(item)
          if (!url) return null

          const isVideo = /^video/i.test(mediaType(item))
          return (
            <div
              key={(typeof item === 'object' && item.id) || `${url}-${index}`}
              className="aspect-square rounded-lg overflow-hidden bg-surface-container-high border border-outline-variant/30"
            >
              {isVideo ? (
                <video src={url} className="w-full h-full object-cover" muted playsInline />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url}
                  alt={typeof item === 'object' ? item.alt ?? `media ${index + 1}` : `media ${index + 1}`}
                  className="w-full h-full object-cover"
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RolePill({ role }: { role?: string }) {
  if (!role) return null

  const normalized = role.toLowerCase()
  const tone =
    normalized === 'admin'
      ? 'bg-amber-500/10 text-amber-300'
      : normalized === 'client'
        ? 'bg-violet-500/10 text-violet-300'
        : normalized === 'ai'
          ? 'bg-sky-500/10 text-sky-300'
          : 'bg-surface-container-high text-on-surface-variant'

  return (
    <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${tone}`}>
      {role}
    </span>
  )
}

function CommentThread({
  comments,
  loading,
  emptyLabel,
}: {
  comments: SocialPostReviewComment[]
  loading: boolean
  emptyLabel: string
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(2)].map((_, index) => (
          <div key={index} className="pib-skeleton h-16 w-full" />
        ))}
      </div>
    )
  }

  if (comments.length === 0) {
    return <p className="text-xs text-on-surface-variant py-2">{emptyLabel}</p>
  }

  return (
    <div className="space-y-1 divide-y divide-[var(--color-outline-variant)]/40">
      {comments.map(comment => {
        const kind = comment.kind ?? 'note'
        const meta = COMMENT_KIND_META[kind] ?? COMMENT_KIND_META.note
        const isHighlighted = kind !== 'note' || comment.agentPickedUp || comment.userRole === 'ai'
        const style: CSSProperties = isHighlighted
          ? {
              borderLeft: '3px solid var(--color-accent-v2)',
              paddingLeft: '0.75rem',
              background: 'rgba(245,158,11,0.05)',
            }
          : { borderLeft: '3px solid transparent', paddingLeft: '0.75rem' }

        return (
          <div key={comment.id} className="text-sm py-3" style={style}>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-medium text-on-surface">
                {comment.userName || comment.userId || 'Unknown'}
              </span>
              <RolePill role={comment.userRole} />
              {kind !== 'note' ? (
                <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${meta.tone}`}>
                  {meta.label}
                </span>
              ) : null}
              {comment.agentPickedUp ? (
                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-green-500/10 text-green-400">
                  agent picked up
                </span>
              ) : null}
              <span className="text-on-surface-variant ml-auto text-xs flex-shrink-0">
                {fmtRelative(comment.createdAt)}
              </span>
            </div>
            <p className="text-on-surface whitespace-pre-wrap break-words">{comment.text}</p>
          </div>
        )
      })}
    </div>
  )
}

export function SocialPostReviewWorkspace({
  loading,
  loadError,
  post,
  comments,
  commentsLoading = false,
  backHref,
  backLabel,
  title,
  eyebrow = 'social',
  statusLabel,
  notice,
  decisionTitle,
  decisionDescription,
  approveAction,
  secondaryApproveAction,
  rejectAction,
  manualAction,
  unavailableActionMessage,
  conversationTitle = 'Conversation',
  emptyCommentsLabel = 'No notes yet. Add a comment to leave context for your team or AI agent.',
  notePlaceholder = 'Leave a note for your team or the AI agent...',
  noteSubmitLabel = 'Post note',
  noteBusyLabel = 'Posting...',
  commentBusy = false,
  onAddComment,
}: SocialPostReviewWorkspaceProps) {
  const [showOriginal, setShowOriginal] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectError, setRejectError] = useState('')
  const [noteText, setNoteText] = useState('')

  const text = useMemo(() => getPostText(post), [post])
  const original = useMemo(() => getOriginalText(post), [post])
  const platforms = useMemo(() => getPostPlatforms(post), [post])
  const media = useMemo(() => getMedia(post), [post])
  const hashtags = useMemo(() => getHashtags(post), [post])
  const aiPrompt = post?.aiPrompt || post?.prompt || ''
  const regenerationCount = post?.approval?.regenerationCount ?? 0
  const sortedComments = useMemo(
    () =>
      [...comments].sort((a, b) => {
        const left = tsToDate(a.createdAt)?.getTime() ?? 0
        const right = tsToDate(b.createdAt)?.getTime() ?? 0
        return left - right
      }),
    [comments],
  )

  async function runButtonAction(action?: ReviewButtonAction) {
    if (!action || action.disabled || action.busy) return
    await action.onAction()
  }

  async function submitReject() {
    if (!rejectAction || rejectAction.disabled || rejectAction.busy) return

    const minLength = rejectAction.minLength ?? 10
    const reason = rejectReason.trim()
    if (reason.length < minLength) {
      setRejectError(`Please write at least ${minLength} characters of feedback.`)
      return
    }

    setRejectError('')
    const result = await rejectAction.onReject(reason)
    if (result !== false) {
      setRejectReason('')
      setRejectOpen(false)
    }
  }

  async function submitNote() {
    if (!onAddComment || commentBusy) return

    const text = noteText.trim()
    if (!text) return

    const result = await onAddComment(text)
    if (result !== false) setNoteText('')
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

  if (loadError || !post) {
    return (
      <div className="space-y-4">
        <Link href={backHref} className="text-xs text-on-surface-variant hover:text-on-surface transition-colors">
          &larr; Back to {backLabel}
        </Link>
        <div className="pib-card p-8 text-center">
          <p className="text-on-surface-variant">{loadError || 'This post is no longer available.'}</p>
        </div>
      </div>
    )
  }

  const resolvedStatus = statusLabel ?? visibleStatus(post.status)
  const scheduled = post.scheduledAt ?? post.scheduledFor

  return (
    <div className="space-y-6 relative">
      {notice ? <Notice notice={notice} /> : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={backHref} className="text-xs text-on-surface-variant hover:text-on-surface transition-colors">
            &larr; Back to {backLabel}
          </Link>
          <p className="eyebrow mt-2">{eyebrow}</p>
          <h1 className="font-headline text-2xl md:text-3xl text-on-surface mt-1">{title}</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-[10px] font-label uppercase tracking-widest border px-2 py-1 rounded"
            style={{
              borderColor: 'rgba(245, 158, 11, 0.4)',
              color: 'var(--color-accent-v2, var(--color-pib-accent))',
            }}
          >
            {resolvedStatus}
          </span>
          {regenerationCount > 0 ? (
            <span className="text-[10px] uppercase tracking-wider text-on-surface-variant bg-surface-container-high px-2 py-1 rounded">
              Revision {regenerationCount}
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-4">
          <div className="pib-card space-y-5">
            <div>
              <p className="eyebrow mb-2">Platforms</p>
              <div className="flex flex-wrap gap-2">
                {platforms.length === 0 ? (
                  <span className="text-xs text-on-surface-variant">No platforms set</span>
                ) : (
                  platforms.map(platform => <PlatformChip key={platform} platform={platform} />)
                )}
              </div>
            </div>

            {scheduled ? (
              <div>
                <p className="eyebrow mb-2">Scheduled for</p>
                <p className="text-sm text-on-surface">{fmtScheduled(scheduled)}</p>
              </div>
            ) : null}

            <div>
              <p className="eyebrow mb-2">Content</p>
              <div className="rounded-xl bg-surface-container-low border border-outline-variant/40 p-4 text-sm text-on-surface leading-relaxed whitespace-pre-wrap break-words">
                {text || <span className="text-on-surface-variant italic">(empty content)</span>}
              </div>
            </div>

            <MediaGrid media={media} />

            {hashtags.length > 0 ? (
              <div>
                <p className="eyebrow mb-2">Hashtags</p>
                <div className="flex flex-wrap gap-1.5">
                  {hashtags.map((hashtag, index) => {
                    const tag = hashtag.startsWith('#') ? hashtag : `#${hashtag}`
                    return (
                      <span
                        key={`${tag}-${index}`}
                        className="text-xs px-2 py-1 rounded-full bg-surface-container-high text-on-surface"
                      >
                        {tag}
                      </span>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {aiPrompt ? (
              <div>
                <p className="eyebrow mb-2">Original prompt</p>
                <p className="text-xs font-mono text-on-surface-variant bg-surface-container-high rounded-lg px-3 py-2 leading-relaxed whitespace-pre-wrap break-words">
                  {aiPrompt}
                </p>
              </div>
            ) : null}
          </div>

          {original && original !== text ? (
            <div className="pib-card">
              <button
                type="button"
                onClick={() => setShowOriginal(value => !value)}
                className="w-full flex items-center justify-between text-left"
              >
                <div>
                  <p className="eyebrow">previous version</p>
                  <p className="text-sm text-on-surface mt-1">View original before regeneration</p>
                </div>
                <span className="text-on-surface-variant text-lg">{showOriginal ? '-' : '+'}</span>
              </button>
              {showOriginal ? (
                <div className="mt-3 rounded-xl bg-surface-container-low border border-outline-variant/40 p-4 text-sm text-on-surface-variant leading-relaxed whitespace-pre-wrap break-words">
                  {original}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="pib-card space-y-3">
            <div>
              <p className="eyebrow">decision</p>
              <h2 className="font-headline text-lg text-on-surface mt-1">{decisionTitle}</h2>
              {decisionDescription ? (
                <p className="text-xs text-on-surface-variant mt-1">{decisionDescription}</p>
              ) : null}
            </div>

            {approveAction ? (
              <button
                type="button"
                onClick={() => runButtonAction(approveAction)}
                disabled={approveAction.disabled || approveAction.busy}
                className="w-full pib-btn-primary justify-center text-sm disabled:opacity-50"
              >
                {approveAction.busy ? approveAction.busyLabel ?? 'Working...' : approveAction.label}
              </button>
            ) : null}

            {secondaryApproveAction ? (
              <div>
                <button
                  type="button"
                  onClick={() => runButtonAction(secondaryApproveAction)}
                  disabled={secondaryApproveAction.disabled || secondaryApproveAction.busy}
                  className="w-full pib-btn-secondary justify-center text-sm disabled:opacity-50"
                >
                  {secondaryApproveAction.busy
                    ? secondaryApproveAction.busyLabel ?? 'Working...'
                    : secondaryApproveAction.label}
                </button>
                {secondaryApproveAction.helpText ? (
                  <p className="text-[11px] text-on-surface-variant mt-1.5 leading-snug">
                    {secondaryApproveAction.helpText}
                  </p>
                ) : null}
              </div>
            ) : null}

            {rejectAction ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setRejectOpen(value => !value)
                    setRejectError('')
                  }}
                  disabled={rejectAction.disabled || rejectAction.busy}
                  className="w-full pib-btn-secondary justify-center text-sm disabled:opacity-50"
                >
                  {rejectAction.label}
                </button>

                {rejectOpen ? (
                  <div className="pt-2 border-t border-outline-variant/40 space-y-2">
                    <label className="pib-label" htmlFor="social-review-reject-reason">
                      What should be changed?
                    </label>
                    <textarea
                      id="social-review-reject-reason"
                      className="pib-textarea w-full text-sm"
                      rows={4}
                      placeholder={rejectAction.placeholder}
                      value={rejectReason}
                      onChange={event => setRejectReason(event.target.value)}
                      disabled={rejectAction.busy}
                    />
                    {rejectError ? <p className="text-xs text-red-400">{rejectError}</p> : null}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-on-surface-variant">
                        {rejectReason.trim().length}/{rejectAction.minLength ?? 10} min
                      </span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setRejectOpen(false)
                            setRejectReason('')
                            setRejectError('')
                          }}
                          disabled={rejectAction.busy}
                          className="pib-btn-secondary text-xs px-3 py-1.5"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={submitReject}
                          disabled={rejectAction.busy || rejectReason.trim().length < (rejectAction.minLength ?? 10)}
                          className="text-xs px-3 py-1.5 rounded-[var(--radius-btn)] font-label uppercase tracking-widest transition-colors disabled:opacity-60"
                          style={{ background: '#ef4444', color: '#fff' }}
                        >
                          {rejectAction.busy ? rejectAction.busyLabel ?? 'Sending...' : rejectAction.submitLabel}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}

            {unavailableActionMessage ? (
              <p className="text-[11px] text-on-surface-variant">{unavailableActionMessage}</p>
            ) : null}

            {manualAction ? (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => runButtonAction(manualAction)}
                  disabled={manualAction.disabled || manualAction.busy}
                  className="text-xs text-on-surface-variant hover:text-on-surface underline underline-offset-2 disabled:opacity-50"
                >
                  {manualAction.busy ? manualAction.busyLabel ?? 'Working...' : manualAction.label}
                </button>
              </div>
            ) : null}
          </div>

          <div className="pib-card space-y-4">
            <div>
              <p className="eyebrow">activity</p>
              <h2 className="font-headline text-lg text-on-surface mt-1">{conversationTitle}</h2>
            </div>

            <CommentThread
              comments={sortedComments}
              loading={commentsLoading}
              emptyLabel={emptyCommentsLabel}
            />

            {onAddComment ? (
              <div className="pt-2 border-t border-outline-variant/40 space-y-2">
                <label className="pib-label" htmlFor="social-review-note">
                  Add a note
                </label>
                <textarea
                  id="social-review-note"
                  rows={3}
                  value={noteText}
                  onChange={event => setNoteText(event.target.value)}
                  placeholder={notePlaceholder}
                  className="pib-textarea"
                  disabled={commentBusy}
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={submitNote}
                    disabled={commentBusy || !noteText.trim()}
                    className="pib-btn-primary text-sm disabled:opacity-50"
                  >
                    {commentBusy ? noteBusyLabel : noteSubmitLabel}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
