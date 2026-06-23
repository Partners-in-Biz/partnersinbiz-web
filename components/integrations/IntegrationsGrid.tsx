'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

// Only providers with a REAL connect path on the platform are listed here.
//
// Social platforms connect via GET /api/v1/social/oauth/{platform} which
// redirects the browser into the provider's OAuth consent screen. Analytics
// connects through the portal Properties page, which initiates the
// /api/v1/properties/{id}/connections/{provider}/authorize OAuth flow per
// property. Slack and WhatsApp are intentionally omitted — no connect route
// exists for them.

type SocialPlatform = 'facebook' | 'instagram' | 'linkedin' | 'twitter'

interface SocialTile {
  kind: 'social'
  platform: SocialPlatform
  name: string
  icon: string
  accent: string
  description: string
}

interface AnalyticsTile {
  kind: 'analytics'
  name: string
  icon: string
  accent: string
  description: string
}

type Tile = SocialTile | AnalyticsTile

const SOCIAL_TILES: SocialTile[] = [
  {
    kind: 'social',
    platform: 'facebook',
    name: 'Facebook',
    icon: 'thumb_up',
    accent: '#1877F2',
    description: 'Publish to Pages and read engagement.',
  },
  {
    kind: 'social',
    platform: 'instagram',
    name: 'Instagram',
    icon: 'photo_camera',
    accent: '#E4405F',
    description: 'Schedule posts and reels to business accounts.',
  },
  {
    kind: 'social',
    platform: 'linkedin',
    name: 'LinkedIn',
    icon: 'business_center',
    accent: '#0A66C2',
    description: 'Post to personal or company profiles.',
  },
  {
    kind: 'social',
    platform: 'twitter',
    name: 'X (Twitter)',
    icon: 'tag',
    accent: '#000000',
    description: 'Publish tweets and threads.',
  },
]

const ANALYTICS_TILE: AnalyticsTile = {
  kind: 'analytics',
  name: 'Google Analytics & Ads',
  icon: 'monitoring',
  accent: '#E37400',
  description: 'Connect a property to pull traffic, revenue and ad metrics.',
}

const ALL_TILES: Tile[] = [...SOCIAL_TILES, ANALYTICS_TILE]

function unwrap(body: unknown): unknown {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    return (body as { data?: unknown }).data
  }
  return body
}

function scopedSuffix(orgId?: string): string {
  return orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''
}

export function IntegrationsGrid({ orgId }: { orgId?: string }) {
  const [connectedPlatforms, setConnectedPlatforms] = useState<Set<string>>(new Set())
  const [analyticsConnected, setAnalyticsConnected] = useState(false)
  const [loading, setLoading] = useState(true)

  const suffix = useMemo(() => scopedSuffix(orgId), [orgId])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [accounts, dashboard] = await Promise.all([
        fetch(`/api/v1/social/accounts${suffix}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`/api/v1/portal/dashboard${suffix}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ])
      if (cancelled) return

      const accountsData = unwrap(accounts)
      const platforms = new Set<string>()
      if (Array.isArray(accountsData)) {
        for (const acc of accountsData as Array<{ platform?: unknown; status?: unknown }>) {
          if (typeof acc.platform === 'string') platforms.add(acc.platform)
        }
      }
      setConnectedPlatforms(platforms)

      const dashboardData = unwrap(dashboard) as { connections?: unknown[] } | null
      setAnalyticsConnected(Array.isArray(dashboardData?.connections) && dashboardData!.connections.length > 0)

      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [suffix])

  function isConnected(tile: Tile): boolean {
    if (tile.kind === 'social') {
      // 'x' is stored as 'twitter' on the platform.
      return connectedPlatforms.has(tile.platform) || (tile.platform === 'twitter' && connectedPlatforms.has('x'))
    }
    return analyticsConnected
  }

  function connectHref(tile: Tile): string {
    if (tile.kind === 'social') {
      const redirect = encodeURIComponent('/portal/integrations')
      const orgParam = orgId ? `&orgId=${encodeURIComponent(orgId)}` : ''
      return `/api/v1/social/oauth/${tile.platform}?redirectUrl=${redirect}${orgParam}`
    }
    return `/portal/properties${scopedSuffix(orgId)}`
  }

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-sm font-medium text-[var(--color-pib-text)]">Connect your channels</h2>
        <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
          Link social platforms and analytics. Each tile starts a real connection flow.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ALL_TILES.map((tile) => {
          const connected = isConnected(tile)
          const href = connectHref(tile)
          const key = tile.kind === 'social' ? `social-${tile.platform}` : 'analytics'
          // Social OAuth is a full-page redirect to the platform → plain anchor.
          // Analytics opens the in-app properties page → Next.js Link.
          const isAnchor = tile.kind === 'social'
          const body = (
            <>
              <div className="flex items-center justify-between gap-2">
                <span
                  className="grid h-10 w-10 place-items-center rounded-lg border border-[var(--color-pib-line)]"
                  style={{ color: tile.accent, background: `${tile.accent}14` }}
                >
                  <span className="material-symbols-outlined text-[20px]" aria-hidden>{tile.icon}</span>
                </span>
                {loading ? (
                  <span className="h-5 w-16 rounded-full bg-[var(--color-pib-line)] animate-pulse" aria-hidden />
                ) : connected ? (
                  <span className="rounded-full border border-emerald-500/25 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
                    Connected
                  </span>
                ) : (
                  <span className="rounded-full border border-[var(--color-pib-line-strong)] bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-pib-text-muted)]">
                    Not connected
                  </span>
                )}
              </div>
              <div className="mt-3">
                <p className="font-medium text-[var(--color-pib-text)]">{tile.name}</p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--color-pib-text-muted)]">{tile.description}</p>
              </div>
              <p className="mt-3 inline-flex items-center gap-1 text-xs font-label text-[var(--color-pib-accent)]">
                {connected ? 'Manage' : 'Connect'}
                <span className="material-symbols-outlined text-[14px]" aria-hidden>arrow_forward</span>
              </p>
            </>
          )

          const className =
            'block text-left rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4 transition-colors hover:border-[var(--color-pib-accent)]/60 hover:bg-white/[0.04]'

          return isAnchor ? (
            <a key={key} href={href} className={className} aria-label={`${connected ? 'Manage' : 'Connect'} ${tile.name}`}>
              {body}
            </a>
          ) : (
            <Link key={key} href={href} className={className} aria-label={`${connected ? 'Manage' : 'Connect'} ${tile.name}`}>
              {body}
            </Link>
          )
        })}
      </div>
    </section>
  )
}
