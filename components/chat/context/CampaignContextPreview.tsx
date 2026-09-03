'use client'

import { Icon } from '@/components/studio'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BlogReaderCard } from '@/components/campaign-preview'
import { SocialPlatformCard } from '@/components/campaign-preview/pickSocialCard'
import type { PreviewBlog, PreviewBrand, PreviewSocialPost } from '@/components/campaign-preview/types'
import { toPreviewBlog, toPreviewSocialPost } from '@/lib/campaign-preview/normalizeSocialPost'

type Filter = 'all' | 'social' | 'blogs' | 'videos'

function brandFromCampaign(campaign: Record<string, unknown>): PreviewBrand | undefined {
  const identity = campaign.brandIdentity
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    const name = typeof campaign.name === 'string' ? campaign.name : undefined
    return name ? {
      name,
      palette: { bg: 'var(--sc-ink)', accent: 'var(--st-warning)', alert: '#F59E0B', text: '#EDEDED' },
    } : undefined
  }
  const raw = identity as Record<string, unknown>
  const palette = raw.palette && typeof raw.palette === 'object' && !Array.isArray(raw.palette)
    ? raw.palette as Record<string, unknown>
    : undefined
  if (!palette || typeof palette.accent !== 'string') {
    return typeof campaign.name === 'string' ? {
      name: campaign.name,
      palette: { bg: 'var(--sc-ink)', accent: 'var(--st-warning)', alert: '#F59E0B', text: '#EDEDED' },
    } : undefined
  }
  return {
    name: typeof campaign.name === 'string' ? campaign.name : undefined,
    logoUrl: typeof raw.logoUrl === 'string' ? raw.logoUrl : undefined,
    palette: {
      bg: typeof palette.bg === 'string' ? palette.bg : 'var(--sc-ink)',
      accent: palette.accent,
      alert: typeof palette.alert === 'string' ? palette.alert : '#F59E0B',
      text: typeof palette.text === 'string' ? palette.text : '#EDEDED',
      ...(typeof palette.muted === 'string' ? { muted: palette.muted } : {}),
    },
  }
}

function asRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
}

export function CampaignContextPreview({
  campaignId,
  refreshRevision = 0,
}: {
  campaignId: string
  refreshRevision?: number
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [brand, setBrand] = useState<PreviewBrand | undefined>()
  const [social, setSocial] = useState<PreviewSocialPost[]>([])
  const [videos, setVideos] = useState<PreviewSocialPost[]>([])
  const [blogs, setBlogs] = useState<PreviewBlog[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const loadedKeyRef = useRef<string | null>(null)
  const [softRefreshing, setSoftRefreshing] = useState(false)

  useEffect(() => {
    loadedKeyRef.current = null
  }, [campaignId])

  useEffect(() => {
    const controller = new AbortController()
    const initial = loadedKeyRef.current !== campaignId
    if (initial) setState('loading')
    else setSoftRefreshing(true)
    Promise.all([
      fetch(`/api/v1/campaigns/${encodeURIComponent(campaignId)}`, { signal: controller.signal }),
      fetch(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/assets`, { signal: controller.signal }),
    ]).then(async ([campaignResponse, assetsResponse]) => {
      if (!campaignResponse.ok || !assetsResponse.ok) throw new Error('Campaign preview unavailable')
      const campaignBody = await campaignResponse.json()
      const assetsBody = await assetsResponse.json()
      const campaign = (campaignBody.data ?? campaignBody) as Record<string, unknown>
      const assets = (assetsBody.data ?? assetsBody) as Record<string, unknown>
      setBrand(brandFromCampaign(campaign))
      setSocial(asRecords(assets.social).map((post) => toPreviewSocialPost(post)))
      setVideos(asRecords(assets.videos).map((post) => toPreviewSocialPost(post)))
      setBlogs(asRecords(assets.blogs).map((blog) => toPreviewBlog(blog)))
      setState('ready')
      loadedKeyRef.current = campaignId
      setSoftRefreshing(false)
    }).catch((cause) => {
      if (controller.signal.aborted) return
      void cause
      setSoftRefreshing(false)
      if (initial) setState('error')
    })
    return () => controller.abort()
  }, [campaignId, refreshRevision])

  const filters = useMemo(() => ([
    { id: 'all' as const, label: 'All', count: social.length + blogs.length + videos.length },
    { id: 'social' as const, label: 'Social', count: social.length },
    { id: 'blogs' as const, label: 'Blogs', count: blogs.length },
    { id: 'videos' as const, label: 'Videos', count: videos.length },
  ]), [blogs.length, social.length, videos.length])

  if (state === 'loading') {
    return (
      <div className="grid min-h-48 place-items-center rounded-[6px] border border-[var(--color-card-border)] bg-black/10 text-xs text-[var(--color-pib-text-muted)]">
        <span className="inline-flex items-center gap-2">
          <Icon name="progress_activity" className="animate-spin text-[18px]" />
          Loading campaign previews…
        </span>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div role="status" className="rounded-[6px] border border-amber-400/20 bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)] px-3 py-4 text-xs text-[var(--st-warning)]">
        The campaign preview is unavailable. Open the full campaign cockpit to continue.
      </div>
    )
  }

  const showSocial = filter === 'all' || filter === 'social'
  const showBlogs = filter === 'all' || filter === 'blogs'
  const showVideos = filter === 'all' || filter === 'videos'
  const empty = social.length === 0 && blogs.length === 0 && videos.length === 0

  return (
    <section data-testid="context-campaign-preview" aria-label="Campaign platform previews" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
          Platform previews
        </h3>
        <span className="text-[10px] text-[var(--color-pib-text-muted)]">
          {softRefreshing ? 'Updating…' : `${filters[0].count} asset${filters[0].count === 1 ? '' : 's'}`}
        </span>
      </div>

      <div role="tablist" aria-label="Campaign asset filter" className="flex flex-wrap gap-1">
        {filters.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            disabled={item.count === 0 && item.id !== 'all'}
            onClick={() => setFilter(item.id)}
            className={`min-h-11 rounded-lg border px-2.5 text-[11px] xl:min-h-8 ${ filter === item.id ? 'border-primary/40 bg-primary/15 font-medium text-primary' : 'border-[var(--color-card-border)] text-[var(--color-pib-text-muted)] hover:bg-white/[0.05]' } disabled:opacity-40`}
          >
            {item.label} ({item.count})
          </button>
        ))}
      </div>

      {empty && (
        <div className="rounded-[6px] border border-dashed border-[var(--color-card-border)] px-3 py-4 text-xs text-[var(--color-pib-text-muted)]">
          No campaign assets yet. Ask Maya to run the content engine or attach posts to this campaign.
        </div>
      )}

      {showSocial && social.length > 0 && (
        <div className="space-y-3">
          {social.map((post) => (
            <div key={post.id} className="space-y-1">
              <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">
                {post.platform}{post.status ? ` · ${post.status.replaceAll('_', ' ')}` : ''}
              </p>
              <SocialPlatformCard post={post} brand={brand} />
            </div>
          ))}
        </div>
      )}

      {showBlogs && blogs.length > 0 && (
        <div className="space-y-3">
          {blogs.map((blog) => (
            <BlogReaderCard key={blog.id} blog={blog} brand={brand} />
          ))}
        </div>
      )}

      {showVideos && videos.length > 0 && (
        <div className="space-y-3">
          {videos.map((post) => (
            <div key={post.id} className="space-y-1">
              <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">
                video · {post.platform}{post.status ? ` · ${post.status.replaceAll('_', ' ')}` : ''}
              </p>
              <SocialPlatformCard post={post} brand={brand} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
