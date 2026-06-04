'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { OrgThemedFrame, useOrgBrand } from '@/components/admin/OrgThemedFrame'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FirestoreTs {
  _seconds: number
  _nanoseconds?: number
}

interface CampaignRow {
  id: string
  orgId: string
  name: string
  status?: string
  shareToken?: string
  createdAt?: FirestoreTs
}

interface PostMedia {
  type: 'image' | 'video' | 'gif' | 'carousel'
  url: string
  thumbnailUrl?: string
}

interface PostRow {
  id: string
  orgId: string
  status: string
  campaignId?: string | null
  platforms?: string[]
  platform?: string
  media?: PostMedia[]
  createdAt?: FirestoreTs
  scheduledAt?: FirestoreTs
}

const MONTH_FMT = new Intl.DateTimeFormat('en-ZA', { month: 'long', year: 'numeric' })

function tsToDate(ts?: FirestoreTs): Date | null {
  if (!ts?._seconds) return null
  return new Date(ts._seconds * 1000)
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(n => parseInt(n, 10))
  return MONTH_FMT.format(new Date(y, m - 1, 1))
}

// ---------------------------------------------------------------------------
// Inner — wraps the hero/grid in OrgThemedFrame so brand colours flow
// ---------------------------------------------------------------------------

export default function OrgSocialIndexPage() {
  const params = useParams()
  const slug = params?.slug as string
  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgName, setOrgName] = useState<string>('')

  useEffect(() => {
    fetch('/api/v1/organizations')
      .then(r => r.json())
      .then(body => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const org = (body.data ?? []).find((o: any) => o.slug === slug)
        if (org) {
          setOrgId(org.id)
          setOrgName(org.name)
        }
      })
      .catch(() => {})
  }, [slug])

  return (
    <OrgThemedFrame orgId={orgId} className="-m-6 p-6 min-h-screen">
      <SocialIndex slug={slug} orgId={orgId} orgName={orgName} />
    </OrgThemedFrame>
  )
}

function SocialIndex({
  slug,
  orgId,
  orgName,
}: {
  slug: string
  orgId: string | null
  orgName: string
}) {
  const { brand } = useOrgBrand()
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [posts, setPosts] = useState<PostRow[]>([])
  const [loading, setLoading] = useState(true)
  const [monthFilter, setMonthFilter] = useState<string>('all')
  const [statsNow] = useState(() => Date.now())

  useEffect(() => {
    if (!orgId) return
    const orgQs = `orgId=${encodeURIComponent(orgId)}`
    Promise.all([
      fetch(`/api/v1/campaigns?${orgQs}&limit=200`).then(r => r.json()),
      fetch(`/api/v1/social/posts?${orgQs}&limit=500`).then(r => r.json()),
    ])
      .then(([c, p]) => {
        const allCampaigns = (c.data ?? []) as CampaignRow[]
        const allPosts = (p.data ?? []) as PostRow[]

        // Pre-index posts by campaignId so we can filter out content-engine
        // campaigns that produced zero social (e.g. blog-only campaigns) —
        // those belong on the blogs page, not the social media index.
        const postsByCampaignId = new Map<string, number>()
        for (const post of allPosts) {
          if (!post.campaignId) continue
          postsByCampaignId.set(post.campaignId, (postsByCampaignId.get(post.campaignId) ?? 0) + 1)
        }

        const contentCampaigns = allCampaigns
          .filter(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (row: any) => row.clientType || row.shareToken,
          )
          // Hide archived — they're stale and shouldn't clutter the index
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((row: any) => row.status !== 'archived')
          // Hide content-engine campaigns that haven't produced any social
          // (e.g. blog-only or in-progress launch wrappers).
          .filter(row => (postsByCampaignId.get(row.id) ?? 0) > 0)

        setCampaigns(
          contentCampaigns.sort((a, b) => {
            const ad = tsToDate(a.createdAt)?.getTime() ?? 0
            const bd = tsToDate(b.createdAt)?.getTime() ?? 0
            return bd - ad
          }),
        )
        setPosts(allPosts)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [orgId])

  // Index posts by campaign for fast totals
  const postsByCampaign = useMemo(() => {
    const map = new Map<string, PostRow[]>()
    for (const p of posts) {
      const cid = p.campaignId ?? null
      const key = cid ?? '__standalone__'
      const arr = map.get(key) ?? []
      arr.push(p)
      map.set(key, arr)
    }
    return map
  }, [posts])

  // Month options from campaigns (newest first)
  const monthOptions = useMemo(() => {
    const set = new Set<string>()
    for (const c of campaigns) {
      const d = tsToDate(c.createdAt)
      if (d) set.add(monthKey(d))
    }
    return Array.from(set).sort().reverse()
  }, [campaigns])

  // Apply month filter
  const visibleCampaigns = useMemo(() => {
    if (monthFilter === 'all') return campaigns
    return campaigns.filter(c => {
      const d = tsToDate(c.createdAt)
      return d ? monthKey(d) === monthFilter : false
    })
  }, [campaigns, monthFilter])

  // Top-line stats (always across all posts in this org, regardless of month)
  const stats = useMemo(() => {
    const total = posts.length
    const awaiting = posts.filter(p => p.status === 'pending_approval').length
    const published = posts.filter(p => p.status === 'published').length
    const cutoff = statsNow - 30 * 24 * 3600 * 1000
    const last30 = posts.filter(p => {
      const d = tsToDate(p.createdAt) ?? tsToDate(p.scheduledAt)
      return d ? d.getTime() >= cutoff : false
    }).length
    return { total, awaiting, published, last30 }
  }, [posts, statsNow])

  const standalonePosts = postsByCampaign.get('__standalone__') ?? []

  return (
    <div
      className="space-y-8 max-w-7xl mx-auto"
      style={{ color: 'var(--org-text, var(--color-pib-text))' }}
    >
      {/* Hero */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
            Workspace · Social
          </p>
          <h1 className="text-3xl md:text-4xl font-headline font-bold">
            {orgName || 'Social Media'}
          </h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Campaigns and standalone posts produced for {orgName || 'this client'}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={monthFilter}
            onChange={e => setMonthFilter(e.target.value)}
            className="text-sm bg-[var(--color-surface)] border border-[var(--color-outline)] rounded-md px-3 py-2 text-on-surface focus:outline-none"
            aria-label="Filter campaigns by month"
          >
            <option value="all">All time</option>
            {monthOptions.map(k => (
              <option key={k} value={k}>
                {monthLabel(k)}
              </option>
            ))}
          </select>
          <Link href={`/admin/social/compose?org=${encodeURIComponent(slug)}`} className="pib-btn-primary text-sm font-label">
            + Compose Post
          </Link>
        </div>
      </header>

      {/* Stat tiles */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile label="Awaiting Approval" value={stats.awaiting} accent />
        <StatTile label="Total Social" value={stats.total} />
        <StatTile label="Published" value={stats.published} />
        <StatTile label="Last 30 Days" value={stats.last30} />
      </section>

      {/* Campaign cards + Standalone */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[1, 2, 3].map(i => (
            <div key={i} className="pib-skeleton h-56 rounded-2xl" />
          ))}
        </div>
      ) : (
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {visibleCampaigns.map(c => {
            const campaignPosts = postsByCampaign.get(c.id) ?? []
            const totals = computeTotals(campaignPosts)
            const heroUrl = pickHero(campaignPosts)
            return (
              <CampaignCard
                key={c.id}
                slug={slug}
                campaign={c}
                totals={totals}
                heroUrl={heroUrl}
              />
            )
          })}

          <StandaloneCard
            slug={slug}
            count={standalonePosts.length}
            totals={computeTotals(standalonePosts)}
          />

          {visibleCampaigns.length === 0 && (
            <EmptyState monthFilter={monthFilter} />
          )}
        </section>
      )}

      {/* Diagnostic: brand applied? */}
      {brand && (
        <p className="text-[10px] uppercase tracking-widest text-on-surface-variant">
          Theme · {orgName} brand applied
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function computeTotals(posts: PostRow[]) {
  return {
    total: posts.length,
    awaiting: posts.filter(p => p.status === 'pending_approval').length,
    published: posts.filter(p => p.status === 'published').length,
  }
}

function pickHero(posts: PostRow[]): string | null {
  for (const p of posts) {
    const m = (p.media ?? []).find(m => m.type === 'image' && m.url)
    if (m) return m.url
  }
  return null
}

function StatTile({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent?: boolean
}) {
  return (
    <div className="pib-card">
      <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-2">
        {label}
      </p>
      <p
        className="text-3xl font-headline font-bold"
        style={
          accent && value > 0
            ? { color: 'var(--org-accent, var(--color-pib-accent))' }
            : undefined
        }
      >
        {value}
      </p>
    </div>
  )
}

function CampaignCard({
  slug,
  campaign,
  totals,
  heroUrl,
}: {
  slug: string
  campaign: CampaignRow
  totals: { total: number; awaiting: number; published: number }
  heroUrl: string | null
}) {
  const created = tsToDate(campaign.createdAt)
  const monthText = created ? MONTH_FMT.format(created) : '—'
  return (
    <Link
      href={`/admin/org/${slug}/social/${campaign.id}`}
      className="group pib-card overflow-hidden hover:border-[var(--org-accent,var(--color-pib-accent))] transition-colors flex flex-col"
      style={{ padding: 0 }}
    >
      {/* Hero */}
      <div
        className="aspect-[16/9] w-full relative"
        style={{
          background: heroUrl
            ? undefined
            : 'linear-gradient(135deg, var(--org-surface, var(--color-pib-surface)) 0%, var(--org-bg, var(--color-pib-bg)) 100%)',
        }}
      >
        {heroUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroUrl}
            alt={campaign.name}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
              No hero image yet
            </span>
          </div>
        )}
        {totals.awaiting > 0 && (
          <span
            className="absolute top-3 left-3 text-[10px] font-label uppercase tracking-wide px-2 py-1 rounded-full"
            style={{
              background: 'var(--org-accent, var(--color-pib-accent))',
              color: '#000',
            }}
          >
            {totals.awaiting} awaiting
          </span>
        )}
      </div>
      {/* Body */}
      <div className="p-5 space-y-3 flex-1 flex flex-col">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
            {monthText}
          </p>
          <h3 className="text-base font-headline font-semibold mt-1 line-clamp-2">
            {campaign.name}
          </h3>
        </div>
        <div className="text-xs text-on-surface-variant flex items-center gap-3 mt-auto">
          <span>{totals.total} social</span>
          <span>·</span>
          <span>{totals.published} published</span>
        </div>
        <p
          className="text-xs font-label uppercase tracking-widest mt-1 group-hover:translate-x-0.5 transition-transform"
          style={{ color: 'var(--org-accent, var(--color-pib-accent))' }}
        >
          Review →
        </p>
      </div>
    </Link>
  )
}

function StandaloneCard({
  slug,
  count,
  totals,
}: {
  slug: string
  count: number
  totals: { total: number; awaiting: number; published: number }
}) {
  return (
    <Link
      href={`/admin/org/${slug}/social/standalone`}
      className="group pib-card overflow-hidden hover:border-[var(--org-accent,var(--color-pib-accent))] transition-colors flex flex-col"
      style={{ padding: 0 }}
    >
      <div
        className="aspect-[16/9] w-full relative flex items-center justify-center"
        style={{
          background:
            'linear-gradient(135deg, var(--org-surface, var(--color-pib-surface)) 0%, var(--org-bg, var(--color-pib-bg)) 100%)',
        }}
      >
        <div className="text-center px-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
            Not part of a campaign
          </p>
          <p className="text-2xl font-headline font-bold mt-1">{count}</p>
          <p className="text-xs text-on-surface-variant">standalone posts</p>
        </div>
        {totals.awaiting > 0 && (
          <span
            className="absolute top-3 left-3 text-[10px] font-label uppercase tracking-wide px-2 py-1 rounded-full"
            style={{
              background: 'var(--org-accent, var(--color-pib-accent))',
              color: '#000',
            }}
          >
            {totals.awaiting} awaiting
          </span>
        )}
      </div>
      <div className="p-5 space-y-3 flex-1 flex flex-col">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
            Standalone
          </p>
          <h3 className="text-base font-headline font-semibold mt-1">
            Composed manually
          </h3>
        </div>
        <div className="text-xs text-on-surface-variant flex items-center gap-3 mt-auto">
          <span>{totals.total} social</span>
          <span>·</span>
          <span>{totals.published} published</span>
        </div>
        <p
          className="text-xs font-label uppercase tracking-widest mt-1 group-hover:translate-x-0.5 transition-transform"
          style={{ color: 'var(--org-accent, var(--color-pib-accent))' }}
        >
          Open →
        </p>
      </div>
    </Link>
  )
}

function EmptyState({ monthFilter }: { monthFilter: string }) {
  return (
    <div className="pib-card md:col-span-2 lg:col-span-2 py-12 text-center">
      <p className="text-on-surface-variant text-sm">
        {monthFilter === 'all'
          ? 'No campaigns yet. Run the content-engine skill to produce one.'
          : `No campaigns created in ${monthLabel(monthFilter)}.`}
      </p>
    </div>
  )
}
