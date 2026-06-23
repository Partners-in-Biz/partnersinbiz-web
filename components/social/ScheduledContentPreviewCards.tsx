import Link from 'next/link'

export interface FirestoreTimestampLike {
  _seconds?: number
  seconds?: number
}

export interface ScheduledContentMedia {
  type?: 'image' | 'video' | 'gif' | 'carousel' | string
  url?: string
  thumbnailUrl?: string
}

export interface ScheduledContentPost {
  id: string
  status?: string
  platform?: string
  platforms?: string[]
  category?: string | null
  campaignId?: string | null
  scheduledAt?: FirestoreTimestampLike | string | null
  scheduledFor?: FirestoreTimestampLike | string | null
  content?: string | { text?: string; platformOverrides?: Record<string, unknown> } | null
  media?: ScheduledContentMedia[]
}

const CHANNEL_STYLES: Record<string, { label: string; badge: string; frame: string; icon: string }> = {
  instagram_square: {
    label: 'Instagram square',
    badge: 'IG 1:1',
    frame: 'aspect-square bg-gradient-to-br from-fuchsia-500/25 via-rose-500/20 to-amber-400/25',
    icon: '◎',
  },
  instagram_reel: {
    label: 'Instagram reel',
    badge: 'IG Reel',
    frame: 'aspect-[9/16] max-h-64 bg-gradient-to-b from-purple-500/25 via-pink-500/20 to-orange-400/20',
    icon: '▶',
  },
  instagram_story: {
    label: 'Instagram story',
    badge: 'IG Story',
    frame: 'aspect-[9/16] max-h-64 bg-gradient-to-b from-indigo-500/25 via-fuchsia-500/20 to-rose-400/20',
    icon: '◌',
  },
  facebook: {
    label: 'Facebook post',
    badge: 'Facebook',
    frame: 'aspect-[4/3] bg-blue-500/15',
    icon: 'f',
  },
  linkedin: {
    label: 'LinkedIn update',
    badge: 'LinkedIn',
    frame: 'aspect-[1.91/1] bg-sky-500/15',
    icon: 'in',
  },
  x: {
    label: 'X post',
    badge: 'X',
    frame: 'aspect-[16/9] bg-neutral-900/70',
    icon: '𝕏',
  },
  bluesky: {
    label: 'Bluesky post',
    badge: 'Bluesky',
    frame: 'aspect-[16/9] bg-sky-400/15',
    icon: '☁',
  },
  pinterest: {
    label: 'Pinterest pin',
    badge: 'Pinterest',
    frame: 'aspect-[2/3] max-h-64 bg-red-500/15',
    icon: 'P',
  },
  generic: {
    label: 'Generic post',
    badge: 'Post',
    frame: 'aspect-[4/3] bg-[var(--color-surface-container)]',
    icon: '✦',
  },
}

function firstPlatform(post: ScheduledContentPost): string {
  const platform = (post.platforms?.[0] ?? post.platform ?? '').toLowerCase()
  if (platform === 'twitter') return 'x'
  return platform
}

function previewKind(post: ScheduledContentPost): keyof typeof CHANNEL_STYLES {
  const platform = firstPlatform(post)
  if (platform === 'instagram') {
    const category = (post.category ?? '').toLowerCase()
    const mediaType = post.media?.[0]?.type?.toLowerCase()
    if (category.includes('story')) return 'instagram_story'
    if (category.includes('reel') || mediaType === 'video') return 'instagram_reel'
    return 'instagram_square'
  }
  if (platform === 'facebook') return 'facebook'
  if (platform === 'linkedin') return 'linkedin'
  if (platform === 'x') return 'x'
  if (platform === 'bluesky') return 'bluesky'
  if (platform === 'pinterest') return 'pinterest'
  return 'generic'
}

function postText(post: ScheduledContentPost): string {
  if (typeof post.content === 'string') return post.content
  return post.content?.text ?? 'Scheduled content preview'
}

function scheduledDate(post: ScheduledContentPost): Date | null {
  const value = post.scheduledFor ?? post.scheduledAt
  if (!value) return null
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const seconds = value._seconds ?? value.seconds
  return seconds ? new Date(seconds * 1000) : null
}

function formatTime(post: ScheduledContentPost): string {
  const date = scheduledDate(post)
  if (!date) return 'Today'
  return date.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
}

function defaultPostHref(slug: string, post: ScheduledContentPost): string {
  const surface = post.campaignId
    ? `/admin/org/${slug}/social/${post.campaignId}`
    : `/admin/org/${slug}/social/standalone`
  const param = post.status === 'pending_approval' || post.status === 'client_review' || post.status === 'qa_review'
    ? 'approvalId'
    : 'postId'
  return `${surface}?${param}=${post.id}`
}

function isVideoSource(value: string | undefined): boolean {
  if (!value) return false
  return /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(value)
}

function isVideoMedia(media: ScheduledContentMedia | undefined): boolean {
  return media?.type?.toLowerCase() === 'video' || isVideoSource(media?.url) || isVideoSource(media?.thumbnailUrl)
}

function MediaPane({ post, style }: { post: ScheduledContentPost; style: (typeof CHANNEL_STYLES)[keyof typeof CHANNEL_STYLES] }) {
  const media = post.media?.[0]
  const isVideo = isVideoMedia(media)
  const imageUrl = !isVideo ? media?.thumbnailUrl ?? media?.url : undefined
  const videoUrl = isVideo ? media?.url ?? media?.thumbnailUrl : undefined
  const posterUrl = isVideo && !isVideoSource(media?.thumbnailUrl) ? media?.thumbnailUrl : undefined

  return (
    <div className={`${style.frame} relative overflow-hidden rounded-2xl border border-white/10 flex items-center justify-center`}>
      {videoUrl ? (
        <video
          src={videoUrl}
          poster={posterUrl}
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
          aria-label="Scheduled post video preview"
        />
      ) : imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="Scheduled post media preview" className="h-full w-full object-cover" />
      ) : (
        <div className="text-4xl text-white/70 font-headline">{style.icon}</div>
      )}
      {isVideo && (
        <span className="absolute inset-0 grid place-items-center text-3xl text-white drop-shadow">▶</span>
      )}
      <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-1 text-[9px] font-label uppercase tracking-wide text-white">
        {style.badge}
      </span>
    </div>
  )
}

export function ScheduledContentPreviewCards({
  slug,
  posts,
  loading,
  composeHref,
  composeLabel = 'Compose post →',
  description = 'Channel-native previews open directly into edit or approval.',
  hrefForPost,
}: {
  slug: string
  posts: ScheduledContentPost[]
  loading: boolean
  composeHref?: string
  composeLabel?: string
  description?: string
  hrefForPost?: (post: ScheduledContentPost) => string
}) {
  const resolvedComposeHref = composeHref ?? `/admin/org/${slug}/social/standalone`

  return (
    <section className="pib-card space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Today’s scheduled content</p>
          <p className="text-sm text-on-surface-variant mt-1">{description}</p>
        </div>
        <Link href={resolvedComposeHref} className="text-[10px] font-label uppercase tracking-wide" style={{ color: 'var(--color-accent-v2)' }}>
          {composeLabel}
        </Link>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="pib-skeleton h-56" />)}
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--color-outline)]/50 p-8 text-center">
          <p className="text-sm font-medium text-on-surface">No scheduled content today.</p>
          <p className="text-xs text-on-surface-variant mt-1">Create a post or approve queued content to see native cards here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {posts.slice(0, 8).map((post) => {
            const style = CHANNEL_STYLES[previewKind(post)]
            const text = postText(post)
            return (
              <Link
                key={post.id}
                data-testid={`scheduled-preview-${post.id}`}
                href={hrefForPost?.(post) ?? defaultPostHref(slug, post)}
                className="group rounded-3xl border border-white/10 bg-[var(--color-surface-container)]/70 p-3 transition hover:-translate-y-0.5 hover:border-[var(--color-accent-v2)]/60 hover:shadow-lg"
              >
                <MediaPane post={post} style={style} />
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-label uppercase tracking-wide text-on-surface">{style.label}</p>
                    <span className="text-[10px] text-on-surface-variant">{formatTime(post)}</span>
                  </div>
                  <p className="line-clamp-3 text-sm text-on-surface-variant">{text}</p>
                  <div className="flex items-center justify-between text-[10px] font-label uppercase tracking-wide">
                    <span className="text-on-surface-variant">{post.status?.replace(/_/g, ' ') ?? 'scheduled'}</span>
                    <span style={{ color: 'var(--color-accent-v2)' }}>Open →</span>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}
