'use client'

import { Icon } from '@/components/studio'
import { useEffect, useRef, useState } from 'react'
import { SocialPlatformCard } from '@/components/campaign-preview/pickSocialCard'
import type { PreviewBrand, PreviewSocialPost } from '@/components/campaign-preview/types'
import { toPreviewSocialPost } from '@/lib/campaign-preview/normalizeSocialPost'

function brandFromPayload(value: unknown): PreviewBrand | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const palette = raw.palette && typeof raw.palette === 'object' && !Array.isArray(raw.palette)
    ? raw.palette as Record<string, unknown>
    : undefined
  if (!palette) return undefined
  const accent = typeof palette.accent === 'string' ? palette.accent : undefined
  const bg = typeof palette.bg === 'string' ? palette.bg : 'var(--sc-ink)'
  const alert = typeof palette.alert === 'string' ? palette.alert : '#F59E0B'
  const text = typeof palette.text === 'string' ? palette.text : '#EDEDED'
  if (!accent) return undefined
  return {
    name: typeof raw.name === 'string' ? raw.name : undefined,
    logoUrl: typeof raw.logoUrl === 'string' ? raw.logoUrl : undefined,
    palette: {
      bg,
      accent,
      alert,
      text,
      ...(typeof palette.muted === 'string' ? { muted: palette.muted } : {}),
    },
  }
}

export function SocialContextPreview({
  postId,
  refreshRevision = 0,
}: {
  postId: string
  refreshRevision?: number
}) {
  const [post, setPost] = useState<PreviewSocialPost | null>(null)
  const [brand, setBrand] = useState<PreviewBrand | undefined>()
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [softRefreshing, setSoftRefreshing] = useState(false)
  const loadedKeyRef = useRef<string | null>(null)

  useEffect(() => {
    loadedKeyRef.current = null
  }, [postId])

  useEffect(() => {
    const controller = new AbortController()
    const initial = loadedKeyRef.current !== postId
    if (initial) setState('loading')
    else setSoftRefreshing(true)
    fetch(`/api/v1/social/posts/${encodeURIComponent(postId)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Social post unavailable')
        const body = await response.json()
        const raw = (body.data ?? body) as Record<string, unknown>
        const next = toPreviewSocialPost({ ...raw, id: typeof raw.id === 'string' ? raw.id : postId })
        setPost(next)
        setBrand(brandFromPayload(raw.brandIdentity ?? raw.brand))
        setState('ready')
        loadedKeyRef.current = postId
        setSoftRefreshing(false)

        const campaignId = typeof raw.campaignId === 'string'
          ? raw.campaignId
          : typeof raw.campaign === 'string'
            ? raw.campaign
            : ''
        if (!campaignId || brandFromPayload(raw.brandIdentity ?? raw.brand)) return
        const campaignResponse = await fetch(`/api/v1/campaigns/${encodeURIComponent(campaignId)}`, { signal: controller.signal })
        if (!campaignResponse.ok) return
        const campaignBody = await campaignResponse.json()
        const campaign = (campaignBody.data ?? campaignBody) as Record<string, unknown>
        setBrand(brandFromPayload(campaign.brandIdentity) ?? {
          name: typeof campaign.name === 'string' ? campaign.name : undefined,
          palette: { bg: 'var(--sc-ink)', accent: 'var(--st-warning)', alert: '#F59E0B', text: '#EDEDED' },
        })
      })
      .catch((cause) => {
        if (controller.signal.aborted) return
        void cause
        setSoftRefreshing(false)
        if (initial) setState('error')
      })
    return () => controller.abort()
  }, [postId, refreshRevision])

  if (state === 'loading') {
    return (
      <div className="grid min-h-48 place-items-center rounded-[6px] border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] text-xs text-[var(--color-pib-text-muted)]">
        <span className="inline-flex items-center gap-2">
          <Icon name="progress_activity" className="animate-spin text-[18px]" />
          Loading platform preview…
        </span>
      </div>
    )
  }

  if (state === 'error' || !post) {
    return (
      <div role="status" className="rounded-[6px] border border-amber-400/20 bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)] px-3 py-4 text-xs text-[var(--st-warning)]">
        The social post preview is unavailable. Open the full social workspace to continue.
      </div>
    )
  }

  return (
    <section
      data-testid="context-social-preview"
      aria-label="Social platform preview"
      className="space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
          Platform preview{softRefreshing ? ' · updating…' : ''}
        </h3>
        <span className="rounded-[4px] border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-medium capitalize text-primary">
          {post.platform}
        </span>
      </div>
      <div className="mx-auto max-w-sm">
        <SocialPlatformCard post={post} brand={brand} />
      </div>
    </section>
  )
}
