'use client'

import { Icon } from '@/components/studio'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  FacebookFeedCard,
  InstagramFeedCard,
  InstagramReelsCard,
  InstagramStoriesCard,
  LinkedInPostCard,
  TwitterPostCard,
  YouTubeCard,
  type PreviewBrand,
  type PreviewMedia,
  type PreviewSocialPost,
} from '@/components/campaign-preview'
import { appendQueryParams, scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

// NOTE: The bulk download endpoint (/api/v1/social/vault/download-bulk) does not
// exist on the backend yet, so the "Download all visible (zip)" button is
// intentionally omitted. When the backend exposes a bulk-zip endpoint, add a
// button here that opens `/api/v1/social/vault/download-bulk?ids=...` in a new tab.
// TODO: bulk-download-zip  -  wire up once backend endpoint exists.

type VaultStatus =
  | 'approved'
  | 'vaulted'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'partially_published'

interface MediaItem {
  url?: string
  thumbnailUrl?: string
  type?: string
  alt?: string
  altText?: string
  durationSec?: number
  urlYoutube?: string
  urlStories?: string
}

type DateLike = string | number | Date | { _seconds?: number; seconds?: number }

interface VaultPost {
  id: string
  content: { text: string } | string
  platforms?: string[]
  platform?: string
  status: VaultStatus
  hashtags?: string[]
  labels?: string[]
  campaign?: string | null
  media?: MediaItem[]
  scheduledAt?: DateLike
  publishedAt?: DateLike
  createdAt?: DateLike
  approvedAt?: DateLike
  category?: string | null
}

type VaultPostAction = 'post' | 'repost'

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

const PLATFORM_OPTIONS = [
  { value: '', label: 'All platforms' },
  { value: 'twitter', label: 'X / Twitter' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'pinterest', label: 'Pinterest' },
  { value: 'bluesky', label: 'Bluesky' },
  { value: 'threads', label: 'Threads' },
  { value: 'reddit', label: 'Reddit' },
]

const STATUS_PILLS: { key: VaultStatus; label: string; cls: string }[] = [
  { key: 'approved', label: 'Approved', cls: 'border-[var(--color-pib-amber)]/40 text-[var(--color-pib-amber)] bg-[var(--color-pib-amber-soft)]' },
  { key: 'scheduled', label: 'Scheduled', cls: 'border-[var(--color-pib-blue)]/40 text-[var(--color-pib-blue)] bg-[var(--color-pib-blue-soft)]' },
  { key: 'published', label: 'Published', cls: 'border-[var(--color-pib-green)]/40 text-[var(--color-pib-green)] bg-[var(--color-pib-green-soft)]' },
  { key: 'vaulted', label: 'Vaulted', cls: 'border-[var(--color-pib-line-strong)] text-[var(--color-pib-text)] bg-[var(--color-pib-surface)]' },
]

const STATUS_PILL_STYLES: Record<VaultStatus, string> = {
  approved: 'border-[var(--color-pib-amber)]/40 text-[var(--color-pib-amber)]',
  vaulted: 'border-[var(--color-pib-line-strong)] text-[var(--color-pib-text-muted)]',
  scheduled: 'border-[var(--color-pib-blue)]/40 text-[var(--color-pib-blue)]',
  publishing: 'border-[var(--color-pib-blue)]/40 text-[var(--color-pib-blue)]',
  published: 'border-[var(--color-pib-green)]/40 text-[var(--color-pib-green)]',
  partially_published: 'border-[var(--color-pib-green)]/40 text-[var(--color-pib-green)]',
}

const STATUS_LABELS: Record<VaultStatus, string> = {
  approved: 'Approved',
  vaulted: 'Vaulted',
  scheduled: 'Scheduled',
  publishing: 'Publishing',
  published: 'Published',
  partially_published: 'Partially Published',
}

const VAULT_PREVIEW_BRAND: PreviewBrand = {
  name: 'Partners in Biz',
  palette: {
    bg: 'var(--sc-ink)',
    accent: 'var(--sc-accent)',
    alert: '#FF5A5F',
    text: '#EDEDED',
    muted: '#8B8B92',
  },
}

function PlatformBadge({ platform }: { platform: string }) {
  const cfg = PLATFORM_COLORS[platform] ?? { bg: 'bg-[var(--color-pib-line-strong)]', label: platform.slice(0, 2).toUpperCase() }
  return <span className={`${cfg.bg} text-white text-[10px] px-2 py-0.5 rounded `}>{cfg.label}</span>
}

function getPostText(post: VaultPost): string {
  if (typeof post.content === 'string') return post.content
  if (post.content?.text) return post.content.text
  return ''
}

function getPostPlatforms(post: VaultPost): string[] {
  if (post.platforms?.length) return post.platforms
  if (post.platform) return [post.platform]
  return []
}

function getPrimaryPlatform(post: VaultPost): string {
  const platform = getPostPlatforms(post)[0] ?? ''
  return platform === 'twitter' ? 'x' : platform.toLowerCase()
}

function tsToDate(ts: DateLike | null | undefined): Date | null {
  if (!ts) return null
  if (typeof ts === 'object' && !(ts instanceof Date)) {
    if (ts._seconds) return new Date(ts._seconds * 1000)
    if (ts.seconds) return new Date(ts.seconds * 1000)
    return null
  }
  const d = new Date(ts)
  return isNaN(d.getTime()) ? null : d
}

function isVideoSource(value: string | undefined): boolean {
  if (!value) return false
  return /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(value)
}

function isVideoMedia(media: MediaItem): boolean {
  return media.type?.toLowerCase() === 'video' || isVideoSource(media.url) || isVideoSource(media.thumbnailUrl)
}

function dateLikeToIso(value: DateLike | null | undefined): string | undefined {
  const date = tsToDate(value)
  return date ? date.toISOString() : undefined
}

function toPreviewMedia(media: MediaItem[]): PreviewMedia[] {
  return media.flatMap((item): PreviewMedia[] => {
    const url = item.url || item.thumbnailUrl
    if (!url) return []
    if (isVideoMedia(item)) {
      return [{
        type: 'video',
        url,
        thumbnailUrl: item.thumbnailUrl,
        durationSec: item.durationSec,
        urlYoutube: item.urlYoutube,
        urlStories: item.urlStories,
      }]
    }
    return [{ type: 'image', url, alt: item.alt ?? item.altText }]
  })
}

function toPreviewSocialPost(post: VaultPost): PreviewSocialPost {
  const platform = getPrimaryPlatform(post) || 'linkedin'
  return {
    id: post.id,
    platform,
    content: getPostText(post),
    hashtags: post.hashtags,
    status: post.status,
    scheduledFor: dateLikeToIso(post.scheduledAt ?? post.publishedAt ?? post.approvedAt ?? post.createdAt),
    media: toPreviewMedia(post.media ?? []),
    campaignId: post.campaign ?? undefined,
    authorName: 'Partners in Biz',
    authorHandle: 'partnersinbiz',
  }
}

function pickCampaignPreviewCard(post: VaultPost) {
  const platform = getPrimaryPlatform(post)
  const hasVideo = (post.media ?? []).some(isVideoMedia)
  const category = (post.category ?? '').toLowerCase()

  if (platform === 'instagram') {
    if (category.includes('story')) return InstagramStoriesCard
    if (hasVideo || category.includes('reel')) return InstagramReelsCard
    return InstagramFeedCard
  }
  if (platform === 'facebook') return FacebookFeedCard
  if (platform === 'linkedin') return LinkedInPostCard
  if (platform === 'x' || platform === 'twitter') return TwitterPostCard
  if (platform === 'youtube') return YouTubeCard
  return LinkedInPostCard
}

function actionForStatus(status: VaultStatus): VaultPostAction | null {
  if (status === 'scheduled') return 'post'
  if (status === 'published' || status === 'partially_published') return 'repost'
  return null
}

function relativeTime(ts: DateLike | null | undefined): string {
  const d = tsToDate(ts)
  if (!d) return ' - '
  const diff = d.getTime() - Date.now()
  const abs = Math.abs(diff)
  const mins = Math.round(abs / 60000)
  const hours = Math.round(abs / 3600000)
  const days = Math.round(abs / 86400000)
  let phrase: string
  if (mins < 1) phrase = 'just now'
  else if (mins < 60) phrase = `${mins}m`
  else if (hours < 24) phrase = `${hours}h`
  else if (days < 7) phrase = `${days}d`
  else phrase = d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
  if (phrase === 'just now') return phrase
  return diff > 0 ? `in ${phrase}` : `${phrase} ago`
}

function buildCopyPayload(post: VaultPost): string {
  const text = getPostText(post).trim()
  const tags = (post.hashtags ?? []).filter(Boolean).map(h => h.startsWith('#') ? h : `#${h}`)
  return tags.length ? `${text}\n\n${tags.join(' ')}` : text
}

// --- inline lightweight toast (portal layout doesn't mount ToastProvider) ---
type ToastItem = { id: string; message: string; tone: 'success' | 'error' | 'info' }

function useInlineToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const push = useCallback((message: string, tone: ToastItem['tone'] = 'success') => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts(prev => [...prev.slice(-3), { id, message, tone }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3000)
  }, [])
  const node = (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-[var(--radius-card)] min-w-72 max-w-sm animate-[slideIn_0.2s_ease-out]"
          style={{
            background: 'var(--color-sidebar)',
            border: `1px solid ${t.tone === 'success' ? 'var(--color-pib-green)' : t.tone === 'error' ? 'var(--color-error)' : 'var(--color-pib-blue)'}`,
          }}
        >
          <span
            className="w-5 h-5 rounded flex items-center justify-center text-xs shrink-0"
            style={{
              background: t.tone === 'success' ? 'var(--color-pib-green-soft)' : t.tone === 'error' ? 'color-mix(in srgb, var(--color-error) 15%, transparent)' : 'var(--color-pib-blue-soft)',
              color: t.tone === 'success' ? 'var(--color-pib-green)' : t.tone === 'error' ? 'var(--color-error)' : 'var(--color-pib-blue)',
            }}
          >
            {t.tone === 'success' ? '✓' : t.tone === 'error' ? '✕' : 'i'}
          </span>
          <p className="text-sm text-[var(--color-pib-text)] flex-1">{t.message}</p>
        </div>
      ))}
    </div>
  )
  return { push, node }
}

function VaultCard({ post, onCopy, onDownload, onPostAction, actionBusy }: {
  post: VaultPost
  onCopy: (post: VaultPost) => void
  onDownload: (post: VaultPost) => void
  onPostAction: (post: VaultPost, action: VaultPostAction) => void
  actionBusy?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const text = getPostText(post)
  const platforms = getPostPlatforms(post)
  const hashtags = (post.hashtags ?? []).filter(Boolean)
  const media = post.media ?? []
  const visibleMedia = media.slice(0, 4)
  const status = post.status
  const headerAction = actionForStatus(status)
  const CampaignPreviewCard = pickCampaignPreviewCard(post)
  const previewPost = toPreviewSocialPost(post)
  const lineCount = text.split('\n').length

  // Heuristic for "needs read more": if visual lines > 6 or character count high.
  const needsReadMore = lineCount > 6 || text.length > 360

  // Pick the most relevant date.
  let dateLabel: string | null = null
  if (status === 'published' || status === 'partially_published') {
    if (post.publishedAt) dateLabel = `Published ${relativeTime(post.publishedAt)}`
  } else if (status === 'scheduled' || status === 'publishing') {
    if (post.scheduledAt) dateLabel = `Scheduled ${relativeTime(post.scheduledAt)}`
  } else if (status === 'approved' || status === 'vaulted') {
    if (post.approvedAt) dateLabel = `Approved ${relativeTime(post.approvedAt)}`
    else if (post.createdAt) dateLabel = `Added ${relativeTime(post.createdAt)}`
  }

  return (
    <div className="pib-card p-4 space-y-3 flex flex-col">
      {/* Header: platforms + status pill */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-1 flex-wrap">
          {platforms.map(p => <PlatformBadge key={p} platform={p} />)}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="grid h-7 w-7 place-items-center rounded border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] transition hover:border-[var(--color-accent-v2)] hover:text-[var(--color-accent-v2)]"
            aria-label="Preview post"
            title="Preview post"
          >
            <Icon name="visibility" />
          </button>
          {headerAction && (
            <button
              type="button"
              onClick={() => onPostAction(post, headerAction)}
              disabled={actionBusy}
              className="grid h-7 w-7 place-items-center rounded border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] transition hover:border-[var(--color-accent-v2)] hover:text-[var(--color-accent-v2)] disabled:cursor-wait disabled:opacity-50"
              aria-label={headerAction === 'post' ? 'Post scheduled post' : 'Repost published post'}
              title={headerAction === 'post' ? 'Post now' : 'Repost'}
            >
              <Icon name={headerAction === 'post' ? 'publish' : 'repeat'} />
            </button>
          )}
          <span className={`text-[10px] font-label uppercase tracking-widest border px-2 py-0.5 rounded flex-shrink-0 ${STATUS_PILL_STYLES[status] ?? 'border-white/10 text-white/40'}`}>
            {STATUS_LABELS[status] ?? status}
          </span>
        </div>
      </div>

      {previewOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Post preview"
          className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/75 p-4"
          onClick={() => setPreviewOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-[6px] border border-[var(--color-pib-line)] bg-[var(--color-surface)] p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                  Platform preview
                </p>
                <p className="text-sm font-medium text-[var(--color-pib-text)]">
                  {STATUS_LABELS[status] ?? status}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="grid h-8 w-8 place-items-center rounded border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]"
                aria-label="Close preview"
              >
                <Icon name="close" />
              </button>
            </div>
            <div className="mx-auto max-w-md">
              <CampaignPreviewCard post={previewPost} brand={VAULT_PREVIEW_BRAND} />
            </div>
          </div>
        </div>
      )}

      {/* Media preview */}
      {visibleMedia.length > 0 && (
        <div className={`grid gap-2 ${visibleMedia.length === 1 ? '' : 'grid-cols-2'}`}>
          {visibleMedia.map((m, i) => {
            const src = m.thumbnailUrl || m.url
            const isFeature = visibleMedia.length === 3 && i === 0
            const isVideo = isVideoMedia(m)
            return (
              <div
                key={i}
                className={`relative overflow-hidden rounded-[var(--radius-card)] bg-[var(--color-surface-variant)] border border-[var(--color-pib-line)] ${visibleMedia.length === 1 ? 'aspect-[4/3]' : 'aspect-square'} ${isFeature ? 'col-span-2 aspect-[16/9]' : ''}`}
              >
                {isVideo && (m.url || m.thumbnailUrl) ? (
                  <video
                    src={m.url || m.thumbnailUrl}
                    poster={!isVideoSource(m.thumbnailUrl) ? m.thumbnailUrl : undefined}
                    muted
                    playsInline
                    preload="metadata"
                    aria-label={m.alt ?? 'Post video preview'}
                    className="w-full h-full object-cover"
                  />
                ) : src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt={m.alt ?? ''} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-[var(--color-pib-text-muted)]">
                    {(m.type ?? 'file').slice(0, 3)}
                  </div>
                )}
                {isVideo && (
                  <span className="pointer-events-none absolute inset-0 grid place-items-center text-3xl text-white drop-shadow">
                    ▶
                  </span>
                )}
                {i === visibleMedia.length - 1 && media.length > visibleMedia.length && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-sm text-white">
                    +{media.length - visibleMedia.length} more
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Content */}
      <div className="relative">
        <p
          className={`text-sm text-[var(--color-pib-text)] whitespace-pre-wrap ${expanded ? '' : 'max-h-[10rem] overflow-hidden'}`}
        >
          {text}
        </p>
        {needsReadMore && !expanded && (
          <>
            <div className="absolute bottom-6 left-0 right-0 h-8 bg-[var(--sc-surface)]/80 pointer-events-none" />
            <button
              onClick={() => setExpanded(true)}
              className="text-xs text-[var(--color-accent-v2)] hover:underline mt-1"
            >
              Read more
            </button>
          </>
        )}
        {needsReadMore && expanded && (
          <button
            onClick={() => setExpanded(false)}
            className="text-xs text-[var(--color-accent-v2)] hover:underline mt-1"
          >
            Show less
          </button>
        )}
      </div>

      {/* Hashtags */}
      {hashtags.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {hashtags.map(tag => (
            <span
              key={tag}
              className="pib-pill pib-pill-rose !text-[10px] !px-2 !py-0.5"
            >
              {tag.startsWith('#') ? tag : `#${tag}`}
            </span>
          ))}
        </div>
      )}

      {/* Labels / campaign */}
      {(post.labels?.length || post.campaign) && (
        <div className="flex gap-1 flex-wrap text-[10px]">
          {post.campaign && (
            <span className="pib-pill pib-pill-rose !text-[10px] !px-2 !py-0.5">
              {post.campaign}
            </span>
          )}
          {(post.labels ?? []).map(label => (
            <span
              key={label}
              className="pib-pill !text-[10px] !px-2 !py-0.5"
            >
              {label}
            </span>
          ))}
        </div>
      )}

      {/* Date */}
      {dateLabel && (
        <p className="text-xs text-[var(--color-pib-text-muted)]">{dateLabel}</p>
      )}

      {/* Action bar */}
      <div className="flex gap-2 pt-3 mt-auto border-t border-[var(--color-pib-line)]">
        <button
          onClick={() => onCopy(post)}
          className="btn-pib-secondary text-xs px-3 py-1.5 flex-1 inline-flex items-center justify-center text-center"
          title="Copy text + hashtags"
        >
          Copy text
        </button>
        <button
          onClick={() => onDownload(post)}
          className="btn-pib-primary text-xs px-3 py-1.5 flex-1 inline-flex items-center justify-center text-center"
          title="Download bundle"
        >
          Download
        </button>
      </div>
    </div>
  )
}

export function SocialVaultWorkspace({
  personal = false,
  title = 'Vault',
  description = 'Your approved social content. Copy text, download images, or grab the full bundle.',
  composeHref = '/portal/social/compose',
}: {
  personal?: boolean
  title?: string
  description?: string
  composeHref?: string
}) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const [posts, setPosts] = useState<VaultPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeOrgId, setActiveOrgId] = useState<string | null>(orgScope.orgId ?? orgScope.id ?? null)
  const [actionBusyPostId, setActionBusyPostId] = useState<string | null>(null)
  const { push: pushToast, node: toastNode } = useInlineToast()

  // Filters
  const [search, setSearch] = useState('')
  const [platform, setPlatform] = useState('')
  const [statusSelected, setStatusSelected] = useState<Set<VaultStatus>>(new Set())
  const [labelQuery, setLabelQuery] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const fetchVault = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let resolvedOrgId = orgScope.orgId ?? orgScope.id ?? null
      if (!resolvedOrgId) {
        const orgRes = await fetch(scopedApiPath('/api/v1/portal/org', orgScope))
        const orgBody = orgRes.ok ? await orgRes.json().catch(() => null) : null
        resolvedOrgId = typeof orgBody?.org?.id === 'string' ? orgBody.org.id : null
      }
      setActiveOrgId(resolvedOrgId)

      const params = new URLSearchParams()
      if (platform) params.set('platform', platform)
      if (fromDate) params.set('from', new Date(fromDate).toISOString())
      if (toDate) params.set('to', new Date(toDate).toISOString())
      if (personal) params.set('scope', 'personal')
      const url = scopedApiPath(
        `/api/v1/social/vault${params.toString() ? `?${params.toString()}` : ''}`,
        { ...orgScope, orgId: resolvedOrgId },
      )
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(`Failed to load vault (${res.status})`)
      }
      const body = await res.json()
      setPosts(body.data ?? [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load vault')
      setPosts([])
    } finally {
      setLoading(false)
    }
  }, [platform, fromDate, toDate, orgScope, personal])

  useEffect(() => { fetchVault() }, [fetchVault])

  // Client-side filters: search, status pills, label/campaign substring
  const visiblePosts = useMemo(() => {
    const q = search.trim().toLowerCase()
    const labelQ = labelQuery.trim().toLowerCase()
    return posts.filter(p => {
      // status pill multi-select
      if (statusSelected.size > 0 && !statusSelected.has(p.status)) return false
      // text search
      if (q) {
        const text = getPostText(p).toLowerCase()
        const hashTagText = (p.hashtags ?? []).join(' ').toLowerCase()
        if (!text.includes(q) && !hashTagText.includes(q)) return false
      }
      // label/campaign substring
      if (labelQ) {
        const labels = (p.labels ?? []).map(l => l.toLowerCase())
        const camp = (p.campaign ?? '').toLowerCase()
        if (!labels.some(l => l.includes(labelQ)) && !camp.includes(labelQ)) return false
      }
      return true
    })
  }, [posts, search, statusSelected, labelQuery])

  function toggleStatus(s: VaultStatus) {
    setStatusSelected(prev => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  function resetFilters() {
    setSearch('')
    setPlatform('')
    setStatusSelected(new Set())
    setLabelQuery('')
    setFromDate('')
    setToDate('')
  }

  async function handleCopy(post: VaultPost) {
    try {
      await navigator.clipboard.writeText(buildCopyPayload(post))
      pushToast('Copied!', 'success')
    } catch {
      pushToast('Copy failed', 'error')
    }
  }

  const activeScope = useMemo(() => ({ ...orgScope, orgId: activeOrgId ?? orgScope.orgId ?? orgScope.id }), [activeOrgId, orgScope])

  function handleDownload(post: VaultPost) {
    // Backend sends Content-Disposition: attachment, so the browser downloads.
    window.open(scopedApiPath(`/api/v1/social/posts/${post.id}/download`, activeScope), '_blank', 'noopener,noreferrer')
  }

  async function handlePostAction(post: VaultPost, action: VaultPostAction) {
    if (action === 'repost') {
      const href = appendQueryParams(personal ? composeHref : scopedPortalPath(composeHref, activeScope), {
        draft: buildCopyPayload(post),
      })
      router.push(href)
      return
    }

    setActionBusyPostId(post.id)
    try {
      const res = await fetch(scopedApiPath(`/api/v1/portal/social/posts/${post.id}/publish-now`, activeScope), {
        method: 'POST',
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(body?.error ?? 'Publish failed')
      }
      setPosts((current) => current.map((item) => (
        item.id === post.id
          ? { ...item, status: 'published', publishedAt: new Date().toISOString() }
          : item
      )))
      pushToast('Post published.', 'success')
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Publish failed', 'error')
    } finally {
      setActionBusyPostId(null)
    }
  }

  async function handleCopyAllVisible() {
    if (visiblePosts.length === 0) return
    const merged = visiblePosts.map(buildCopyPayload).join('\n\n')
    try {
      await navigator.clipboard.writeText(merged)
      pushToast(`Copied ${visiblePosts.length} post${visiblePosts.length === 1 ? '' : 's'}`, 'success')
    } catch {
      pushToast('Copy failed', 'error')
    }
  }

  const hasActiveFilters =
    !!search ||
    !!platform ||
    statusSelected.size > 0 ||
    !!labelQuery ||
    !!fromDate ||
    !!toDate

  return (
    <div className="space-y-8">
      {toastNode}

      {/* Header */}
      <header>
        <p className="sc-tiny">Social · Vault</p>
        <h1 className="pib-page-title mt-2">{title}</h1>
        <p className="pib-page-sub">
          {description}
        </p>
      </header>

      {/* Filters */}
      <div className="pib-card p-4 space-y-3 sticky top-2 z-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search content…"
            aria-label="Search content"
            className="pib-input"
          />
          <select
            value={platform}
            onChange={e => setPlatform(e.target.value)}
            aria-label="Platform filter"
            className="pib-input"
          >
            {PLATFORM_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <input
            type="text"
            value={labelQuery}
            onChange={e => setLabelQuery(e.target.value)}
            placeholder="Label or campaign…"
            aria-label="Label or campaign"
            className="pib-input"
          />
          <div className="flex gap-2">
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="pib-input flex-1"
              aria-label="From date"
            />
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="pib-input flex-1"
              aria-label="To date"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)] mr-1">
            Status
          </span>
          {STATUS_PILLS.map(p => {
            const active = statusSelected.has(p.key)
            return (
              <button
                key={p.key}
                onClick={() => toggleStatus(p.key)}
                className={`text-[10px] font-label uppercase tracking-widest border px-2.5 py-1 rounded transition-colors ${
                  active
                    ? p.cls
                    : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]'
                }`}
              >
                {p.label}
              </button>
            )
          })}

          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="ml-auto text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-accent-v2)] underline"
            >
              Reset filters
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-[var(--color-error)]/40 p-3 text-sm text-[var(--color-error)]">
          {error}
        </div>
      )}

      {/* Bulk actions */}
      {!loading && posts.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-label uppercase tracking-widest border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] px-2.5 py-1 rounded">
            {visiblePosts.length} of {posts.length} {posts.length === 1 ? 'post' : 'posts'}
          </span>
          <button
            onClick={handleCopyAllVisible}
            disabled={visiblePosts.length === 0}
            className="btn-pib-secondary text-xs px-3 py-1.5"
            style={{
              opacity: visiblePosts.length === 0 ? 0.5 : 1,
              cursor: visiblePosts.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            Copy all visible
          </button>
          <Link
            href={scopedPortalPath('/portal/social', orgScope)}
            className="ml-auto text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-accent-v2)] underline"
          >
            ← Back to Social
          </Link>
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}
        >
          {[...Array(6)].map((_, i) => (
            <div key={i} className="pib-skeleton h-72" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="pib-card text-center py-12">
          <p className="text-[var(--color-pib-text)] font-headline text-lg mb-2">Your vault is empty.</p>
          <p className="text-sm text-[var(--color-pib-text-muted)]">
            Once your team approves posts, they&apos;ll show up here for you to grab any time.
          </p>
        </div>
      ) : visiblePosts.length === 0 ? (
        <div className="pib-card text-center py-10">
          <p className="text-sm text-[var(--color-pib-text-muted)]">
            No posts match your filters.
          </p>
          <button
            onClick={resetFilters}
            className="mt-3 text-xs text-[var(--color-accent-v2)] underline"
          >
            Reset filters
          </button>
        </div>
      ) : (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}
        >
          {visiblePosts.map(post => (
            <VaultCard
              key={post.id}
              post={post}
              onCopy={handleCopy}
              onDownload={handleDownload}
              onPostAction={handlePostAction}
              actionBusy={actionBusyPostId === post.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}


export default function VaultPage() {
  return <SocialVaultWorkspace />
}
