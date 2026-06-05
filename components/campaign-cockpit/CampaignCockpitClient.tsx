'use client'

import * as React from 'react'
import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AssetGrid } from '@/components/campaign-cockpit/AssetGrid'
import { BlogPreviewCard, type PreviewBrand } from '@/components/campaign-preview'
import { PageTabs } from '@/components/ui/AppFoundation'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any

const TABS = [
  { key: 'research',  label: 'Research' },
  { key: 'blogs',     label: 'Blog Posts' },
  { key: 'social',    label: 'Social' },
  { key: 'videos',    label: 'Videos' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'reels',     label: 'Reels & TikTok' },
  { key: 'stories',   label: 'Stories' },
  { key: 'facebook',  label: 'Facebook' },
  { key: 'linkedin',  label: 'LinkedIn' },
  { key: 'twitter',   label: 'Twitter / X' },
  { key: 'bluesky',   label: 'Bluesky' },
  { key: 'pinterest', label: 'Pinterest' },
  { key: 'youtube',   label: 'YouTube' },
] as const

type TabKey = (typeof TABS)[number]['key']

function splitPathAndQuery(path: string) {
  const [pathname, query = ''] = path.split('?')
  return { pathname, query }
}

function mergePathSearch(path: string, params: URLSearchParams): string {
  const { pathname, query } = splitPathAndQuery(path)
  const merged = new URLSearchParams(query)
  params.forEach((value, key) => {
    merged.set(key, value)
  })
  const qs = merged.toString()
  return `${pathname}${qs ? `?${qs}` : ''}`
}

function appendChildPath(path: string, childPath: string): string {
  const { pathname, query } = splitPathAndQuery(path)
  const child = childPath.startsWith('/') ? childPath : `/${childPath}`
  return `${pathname}${child}${query ? `?${query}` : ''}`
}

export interface CampaignCockpitClientProps {
  campaignId: string
  campaign: AnyObj
  assets: AnyObj
  brand: PreviewBrand | undefined
  orgName: string
  monthLabel: string
  shareToken?: string
  shareEnabled: boolean
  backHref: string
  backLabel: string
  basePath: string
  assetApprovalMode?: 'direct' | 'client'
  showClientBlogApprovals?: boolean
  apiPaths?: {
    approveAll: string
    assets: string
    clientBlogApprove: (contentId: string) => string
  }
}

export function CampaignCockpitClient({
  campaignId,
  campaign,
  assets: initialAssets,
  brand,
  orgName,
  monthLabel,
  shareToken,
  shareEnabled,
  backHref,
  backLabel,
  basePath,
  assetApprovalMode = 'direct',
  showClientBlogApprovals = false,
  apiPaths,
}: CampaignCockpitClientProps) {
  const router = useRouter()
  const search = useSearchParams()
  const tabParam = search.get('tab')
  const tab: TabKey = (TABS.find(t => t.key === tabParam)?.key ?? 'research') as TabKey

  const [assets, setAssets] = useState<AnyObj>(initialAssets)
  const [approving, setApproving] = useState(false)
  const [showApproveAllConfirm, setShowApproveAllConfirm] = useState(false)
  const [approveAllStatus, setApproveAllStatus] = useState<string | null>(null)
  const [approveAllError, setApproveAllError] = useState<string | null>(null)

  const split = useMemo(() => splitAssets(assets), [assets])
  const totalAwaiting = (assets?.meta?.byStatus?.pending_approval ?? 0) as number

  const setTab = (key: TabKey) => {
    const params = new URLSearchParams(search.toString())
    if (key === 'research') params.delete('tab')
    else params.set('tab', key)
    router.replace(mergePathSearch(basePath, params))
  }

  async function approveAll() {
    if (approving) return
    setApproving(true)
    setApproveAllStatus(null)
    setApproveAllError(null)
    try {
      const r = await fetch(apiPaths?.approveAll ?? `/api/v1/campaigns/${campaignId}/approve-all`, { method: 'POST' })
      if (!r.ok) {
        const json = await r.json().catch(() => ({}))
        throw new Error(json?.error ?? 'Approval failed')
      }
      const a = await fetch(apiPaths?.assets ?? `/api/v1/campaigns/${campaignId}/assets`).then(res => res.json())
      setAssets(a.data ?? null)
      setApproveAllStatus('All campaign assets are approved and ready for publishing.')
      setShowApproveAllConfirm(false)
      router.refresh()
    } catch (err) {
      setApproveAllError(err instanceof Error ? err.message : 'Approval failed')
    } finally {
      setApproving(false)
    }
  }

  const description: string = campaign.research?.taglines?.master ?? campaign.description ?? ''

  return (
    <div className="space-y-8 max-w-7xl mx-auto" style={{ color: 'var(--org-text, var(--color-pib-text))' }}>
      <header className="space-y-2">
        <Link
          href={backHref}
          className="text-xs text-[var(--org-text-muted,var(--color-pib-text-muted))] hover:text-[var(--org-text,var(--color-pib-text))] inline-flex items-center gap-1"
        >
          ← {backLabel}
        </Link>
        <p
          className="text-[10px] font-label uppercase tracking-[0.2em]"
          style={{ color: 'var(--org-accent, var(--color-pib-accent))' }}
        >
          Marketing preview · Confidential
        </p>
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl md:text-5xl font-headline font-bold">
              {orgName ? `${orgName} — ` : ''}Marketing Preview
              {monthLabel && <span className="text-[var(--org-text-muted,var(--color-pib-text-muted))]"> · {monthLabel}</span>}
            </h1>
            {description && (
              <p className="text-sm text-[var(--org-text-muted,var(--color-pib-text-muted))] mt-2 max-w-2xl">
                {description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {totalAwaiting > 0 && (
              <span
                className="text-[10px] font-label uppercase tracking-wide px-3 py-1 rounded-full"
                style={{
                  background: 'var(--org-accent, var(--color-pib-accent))',
                  color: '#000',
                }}
              >
                {totalAwaiting} awaiting review
              </span>
            )}
            {shareToken && shareEnabled && (
              <a
                href={`/c/${shareToken}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs px-3 py-1.5 rounded border border-[var(--color-pib-line)] hover:bg-[var(--color-pib-surface)] transition-colors"
              >
                Public preview ↗
              </a>
            )}
            <button
              type="button"
              onClick={() => {
                setApproveAllStatus(null)
                setApproveAllError(null)
                setShowApproveAllConfirm(true)
              }}
              disabled={approving || totalAwaiting === 0}
              className="text-sm font-label px-4 py-2 rounded-md transition-opacity disabled:opacity-40"
              style={{
                background: 'var(--org-accent, var(--color-pib-accent))',
                color: '#000',
              }}
            >
              {approving ? 'Approving…' : `Approve all awaiting assets (${totalAwaiting})`}
            </button>
          </div>
        </div>
        {(showApproveAllConfirm || approveAllStatus || approveAllError) && (
          <div className="mt-4 max-w-xl">
            {showApproveAllConfirm && (
              <div
                role="alertdialog"
                aria-modal="true"
                aria-label={`Approve ${totalAwaiting} campaign assets?`}
                className="rounded-lg border border-[var(--org-border,var(--color-pib-line))] bg-[var(--org-surface,var(--color-pib-card))] p-4 shadow-xl"
              >
                <p className="font-label text-sm">Approve {totalAwaiting} campaign assets?</p>
                <p className="mt-2 text-xs leading-5 text-[var(--org-text-muted,var(--color-pib-text-muted))]">
                  This approves every pending asset in the campaign preview and moves the work out of client review for publishing.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={approveAll}
                    disabled={approving}
                    className="rounded-md px-3 py-2 text-xs font-label transition-opacity disabled:opacity-50"
                    style={{
                      background: 'var(--org-accent, var(--color-pib-accent))',
                      color: '#000',
                    }}
                  >
                    {approving ? 'Approving assets…' : `Confirm approve ${totalAwaiting} campaign assets`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowApproveAllConfirm(false)}
                    disabled={approving}
                    className="rounded-md border border-[var(--org-border,var(--color-pib-line))] px-3 py-2 text-xs font-label text-[var(--org-text,var(--color-pib-text))] transition-colors hover:bg-[var(--org-surface-soft,var(--color-pib-surface))] disabled:opacity-50"
                  >
                    Keep reviewing
                  </button>
                </div>
              </div>
            )}
            {approveAllStatus && (
              <p
                role="status"
                className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300"
              >
                {approveAllStatus}
              </p>
            )}
            {approveAllError && (
              <p
                role="alert"
                className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
              >
                {approveAllError}
              </p>
            )}
          </div>
        )}
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SmallStat label="Blog Posts" value={split.blogs.length} />
        <SmallStat label="Videos" value={split.videos.length} />
        <SmallStat label="Social Captions" value={split.allSocial.length} />
        <SmallStat label="Awaiting review" value={totalAwaiting} accent />
      </section>

      <PageTabs
        ariaLabel="Campaign cockpit channels"
        value={tab}
        onValueChange={(value) => setTab(value as TabKey)}
        tabs={TABS.map((item) => ({
          label: item.label,
          value: item.key,
          badge: countFor(item.key, split),
        }))}
      />

      <div>
        {tab === 'research' && <ResearchPanel research={campaign.research} />}
        {tab === 'blogs' && (
          <BlogsTab
            blogs={split.blogs}
            brand={brand}
            basePath={basePath}
            showClientApprovals={showClientBlogApprovals}
            clientBlogApproveHref={apiPaths?.clientBlogApprove}
          />
        )}
        {tab === 'social' && (
          <PlatformPanel
            empty={emptyCopy('social posts', 'social assets')}
            social={split.social}
            blogs={[]}
            videos={[]}
            filter="social"
            brand={brand}
            campaignId={campaignId}
            approvalMode={assetApprovalMode}
          />
        )}
        {tab === 'videos' && (
          <PlatformPanel
            empty={emptyCopy('videos', 'campaign videos')}
            social={[]}
            blogs={[]}
            videos={split.videos}
            filter="videos"
            brand={brand}
            campaignId={campaignId}
            approvalMode={assetApprovalMode}
          />
        )}
        {tab === 'instagram' && (
          <PlatformPanel
            empty={emptyCopy('Instagram feed posts', 'instagram-feed')}
            social={split.instagramFeed}
            blogs={[]}
            videos={[]}
            filter="social"
            brand={brand}
            campaignId={campaignId}
            approvalMode={assetApprovalMode}
          />
        )}
        {tab === 'reels' && (
          <PlatformPanel
            empty={emptyCopy('Reels or TikToks', 'short-vertical-video')}
            social={split.reelsAndTikTok}
            blogs={[]}
            videos={[]}
            filter="social"
            brand={brand}
            campaignId={campaignId}
            approvalMode={assetApprovalMode}
          />
        )}
        {tab === 'stories' && (
          <PlatformPanel
            empty={emptyCopy('story-format posts', '15-second story slides')}
            social={split.stories}
            blogs={[]}
            videos={[]}
            filter="social"
            brand={brand}
            campaignId={campaignId}
            approvalMode={assetApprovalMode}
          />
        )}
        {tab === 'facebook' && (
          <PlatformPanel
            empty={emptyCopy('Facebook posts', 'facebook-feed')}
            social={split.facebook}
            blogs={[]}
            videos={[]}
            filter="social"
            brand={brand}
            campaignId={campaignId}
            approvalMode={assetApprovalMode}
          />
        )}
        {tab === 'linkedin' && (
          <PlatformPanel
            empty={emptyCopy('LinkedIn posts', 'linkedin-feed')}
            social={split.linkedin}
            blogs={[]}
            videos={[]}
            filter="social"
            brand={brand}
            campaignId={campaignId}
            approvalMode={assetApprovalMode}
          />
        )}
        {tab === 'twitter' && (
          <PlatformPanel
            empty={emptyCopy('Twitter / X posts', 'twitter-feed')}
            social={split.twitter}
            blogs={[]}
            videos={[]}
            filter="social"
            brand={brand}
            campaignId={campaignId}
            approvalMode={assetApprovalMode}
          />
        )}
        {tab === 'bluesky' && (
          <PlatformPanel
            empty={emptyCopy('Bluesky posts', 'bluesky-feed')}
            social={split.bluesky}
            blogs={[]}
            videos={[]}
            filter="social"
            brand={brand}
            campaignId={campaignId}
            approvalMode={assetApprovalMode}
          />
        )}
        {tab === 'pinterest' && (
          <PlatformPanel
            empty={emptyCopy('Pinterest pins', 'pinterest-pin')}
            social={split.pinterest}
            blogs={[]}
            videos={[]}
            filter="social"
            brand={brand}
            campaignId={campaignId}
            approvalMode={assetApprovalMode}
          />
        )}
        {tab === 'youtube' && (
          <PlatformPanel
            empty={emptyCopy('YouTube videos', 'long-form 16:9 video')}
            social={split.youtubeSocial}
            blogs={[]}
            videos={split.youtubeVideos}
            filter="all"
            brand={brand}
            campaignId={campaignId}
            approvalMode={assetApprovalMode}
          />
        )}
      </div>

      <footer className="pt-6 mt-12 border-t border-[var(--org-border,var(--color-pib-line))] flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--org-text-muted,var(--color-pib-text-muted))]">
        <p>
          {totalAwaiting > 0
            ? `${totalAwaiting} asset${totalAwaiting === 1 ? '' : 's'} awaiting your review.`
            : 'Everything is approved or scheduled.'}
        </p>
        <p>Need a change? Reply to your account email or comment directly on the asset.</p>
      </footer>
    </div>
  )
}

function SmallStat({
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
      <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)] mb-2">
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

function ResearchPanel({ research }: { research: AnyObj }) {
  if (!research) {
    return (
      <div className="pib-card p-10 text-center text-sm text-[var(--color-pib-text-muted)]">
        No research dossier on this campaign yet.
      </div>
    )
  }
  return (
    <div className="space-y-6">
      {research.taglines && (
        <section className="pib-card p-6 space-y-3">
          <h2 className="text-lg font-headline font-semibold">Taglines</h2>
          {research.taglines.master && (
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">Master</p>
              <p className="text-xl">{research.taglines.master}</p>
            </div>
          )}
          {research.taglines.layered && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm pt-2">
              {Object.entries(research.taglines.layered as Record<string, string>).map(
                ([k, v]) => (
                  <div key={k}>
                    <p className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">{k}</p>
                    <p>{v}</p>
                  </div>
                ),
              )}
            </div>
          )}
        </section>
      )}

      {research.audiences && research.audiences.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-headline font-semibold">Audiences</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {research.audiences.map((a: AnyObj) => (
              <div key={a.id ?? a.label} className="pib-card p-5 space-y-3">
                <h3 className="font-semibold">
                  {a.id ? (
                    <span style={{ color: 'var(--org-accent, var(--color-pib-accent))' }}>
                      {a.id}.
                    </span>
                  ) : null}{' '}
                  {a.label}
                </h3>
                {a.painPoints?.length > 0 && (
                  <Bullets label="Pain points" items={a.painPoints} />
                )}
                {a.topInsights?.length > 0 && (
                  <Bullets label="Top insights" items={a.topInsights} />
                )}
                {a.language?.length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)] mb-1">
                      Language
                    </p>
                    <div className="flex gap-1 flex-wrap">
                      {a.language.map((p: string, i: number) => (
                        <span
                          key={i}
                          className="text-xs px-2 py-1 rounded bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)]"
                        >
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {research.voice && (
        <section className="pib-card p-6 space-y-3">
          <h2 className="text-lg font-headline font-semibold">Voice</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            {research.voice.do?.length > 0 && (
              <Bullets label="Do" items={research.voice.do} labelColor="text-emerald-400" />
            )}
            {research.voice.dont?.length > 0 && (
              <Bullets label="Don't" items={research.voice.dont} labelColor="text-red-400" />
            )}
          </div>
          {research.voice.sampleParagraph && (
            <div className="pt-3 border-t border-[var(--color-pib-line)]">
              <p className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)] mb-1">
                Sample
              </p>
              <p className="italic text-sm">{research.voice.sampleParagraph}</p>
            </div>
          )}
        </section>
      )}

      {research.citations && research.citations.length > 0 && (
        <section className="pib-card p-6 space-y-3">
          <h2 className="text-lg font-headline font-semibold">Citations</h2>
          <ul className="space-y-3 text-sm">
            {research.citations.map((c: AnyObj, i: number) => (
              <li
                key={i}
                className="border-l-2 pl-3"
                style={{ borderColor: 'var(--org-accent, var(--color-pib-accent))' }}
              >
                <p className="italic">&ldquo;{c.quote}&rdquo;</p>
                <p className="text-xs text-[var(--color-pib-text-muted)] mt-1">
                  {c.speaker ? `${c.speaker}, ` : ''}
                  {c.publication}
                  {c.url && (
                    <>
                      {' · '}
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        source
                      </a>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {research.confidence && (
        <p className="text-xs text-[var(--color-pib-text-muted)]">
          Research confidence: <span className="uppercase">{research.confidence}</span>
          {research.notes ? ` · ${research.notes}` : ''}
        </p>
      )}
    </div>
  )
}

function Bullets({
  label,
  items,
  labelColor = 'text-[var(--color-pib-text-muted)]',
}: {
  label: string
  items: string[]
  labelColor?: string
}) {
  return (
    <div>
      <p className={`text-xs uppercase tracking-wide ${labelColor} mb-1`}>{label}</p>
      <ul className="text-sm space-y-1 list-disc list-inside">
        {items.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
    </div>
  )
}

function PlatformPanel({
  social,
  blogs,
  videos,
  filter,
  brand,
  campaignId,
  empty,
  approvalMode,
}: {
  social: AnyObj[]
  blogs: AnyObj[]
  videos: AnyObj[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filter: any
  brand: PreviewBrand | undefined
  campaignId: string
  empty: React.ReactNode
  approvalMode: 'direct' | 'client'
}) {
  const total = social.length + blogs.length + videos.length
  if (total === 0) {
    return (
      <div className="pib-card p-10 text-center text-sm text-[var(--color-pib-text-muted)]">
        {empty}
      </div>
    )
  }
  return (
    <AssetGrid
      campaignId={campaignId}
      brand={brand}
      social={social}
      blogs={blogs}
      videos={videos}
      filter={filter}
      approvalMode={approvalMode}
    />
  )
}

function emptyCopy(label: string, kind: string): React.ReactNode {
  const isVideo =
    kind === 'short-vertical-video' ||
    kind === 'long-form 16:9 video' ||
    kind === '15-second story slides'
  return (
    <div className="flex flex-col items-center gap-3">
      <span aria-hidden className="text-3xl opacity-60">
        {isVideo ? '🎬' : '📭'}
      </span>
      <p className="text-sm">No {label} on this campaign yet.</p>
      <p className="text-xs text-[var(--color-pib-text-muted)] max-w-md">
        {isVideo
          ? `This campaign was imported without ${kind}. Reach out to your account team if you'd like ${kind} added.`
          : `${kind} aren't included on this campaign yet. Reach out to your account team to expand this format.`}
      </p>
    </div>
  )
}

function BlogApproveButton({
  onApproved,
  approveHref,
}: {
  onApproved: () => void
  approveHref: string
}) {
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function handleApprove(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(approveHref, { method: 'POST' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json?.error ?? 'Approval failed')
      }
      onApproved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="px-5 pb-5 pt-0" onClick={e => e.preventDefault()}>
      {error && (
        <p className="text-xs text-red-400 mb-2">{error}</p>
      )}
      <button
        type="button"
        onClick={handleApprove}
        disabled={loading}
        className="w-full text-sm font-label py-2 rounded-md transition-opacity disabled:opacity-50"
        style={{ background: 'var(--org-accent, var(--color-pib-accent))', color: '#000' }}
      >
        {loading ? 'Approving…' : 'Approve this post ✓'}
      </button>
    </div>
  )
}

function BlogsTab({
  blogs,
  brand,
  basePath,
  showClientApprovals,
  clientBlogApproveHref,
}: {
  blogs: AnyObj[]
  brand: PreviewBrand | undefined
  basePath: string
  showClientApprovals: boolean
  clientBlogApproveHref?: (contentId: string) => string
}) {
  const [statuses, setStatuses] = React.useState<Record<string, string>>({})

  if (blogs.length === 0) {
    return (
      <div className="pib-card p-10 text-center text-sm text-[var(--color-pib-text-muted)]">
        No blog posts on this campaign yet.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
      {blogs.map(b => {
        const currentStatus = statuses[b.id] ?? b.status
        const isReview = currentStatus === 'review'
        return (
          <div key={b.id} className="flex flex-col">
            <BlogPreviewCard
              blog={b}
              brand={brand}
              status={currentStatus}
              href={appendChildPath(basePath, `/blog/${b.id}`)}
            />
            {showClientApprovals && isReview && (
              <BlogApproveButton
                approveHref={clientBlogApproveHref?.(b.id) ?? `/api/v1/seo/content/${b.id}/client-approve`}
                onApproved={() => setStatuses(prev => ({ ...prev, [b.id]: 'client_approved' }))}
              />
            )}
            {showClientApprovals && currentStatus === 'client_approved' && !isReview && (
              <div className="px-5 pb-5 pt-1 text-center text-xs text-emerald-400 font-label">
                Approved ✓ — awaiting publishing
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function splitAssets(assets: AnyObj | null) {
  const empty = {
    blogs: [] as AnyObj[],
    videos: [] as AnyObj[],
    social: [] as AnyObj[],
    allSocial: [] as AnyObj[],
    instagramFeed: [] as AnyObj[],
    reelsAndTikTok: [] as AnyObj[],
    stories: [] as AnyObj[],
    facebook: [] as AnyObj[],
    linkedin: [] as AnyObj[],
    twitter: [] as AnyObj[],
    bluesky: [] as AnyObj[],
    pinterest: [] as AnyObj[],
    youtubeSocial: [] as AnyObj[],
    youtubeVideos: [] as AnyObj[],
  }
  if (!assets) return empty

  const blogs = (assets.blogs ?? []) as AnyObj[]
  const videos = (assets.videos ?? []) as AnyObj[]
  const social = (assets.social ?? []) as AnyObj[]
  const allSocial = [...social, ...videos]

  const isVideo = (p: AnyObj) =>
    Array.isArray(p.media) && p.media.some((m: AnyObj) => m?.type === 'video')

  const platformOf = (p: AnyObj): string => {
    const arr = Array.isArray(p.platforms) ? p.platforms : []
    return (arr[0] ?? p.platform ?? '').toString().toLowerCase()
  }

  const formatOf = (p: AnyObj): string => (p.format ?? '').toString().toLowerCase()
  const hasStoriesUrl = (p: AnyObj): boolean =>
    Array.isArray(p.media) && p.media.some((m: AnyObj) => m?.urlStories)

  const instagramFeed = social.filter(p => {
    const plat = platformOf(p)
    return plat === 'instagram' && formatOf(p) !== 'story' && !isVideo(p)
  })
  const stories = allSocial.filter(p => formatOf(p) === 'story' || hasStoriesUrl(p))
  const reelsAndTikTok = allSocial.filter(p => {
    const plat = platformOf(p)
    if (formatOf(p) === 'story') return false
    if (plat === 'tiktok') return true
    if (plat === 'instagram' && isVideo(p)) return true
    return false
  })
  const facebook = social.filter(p => platformOf(p) === 'facebook')
  const linkedin = social.filter(p => platformOf(p) === 'linkedin')
  const twitter = social.filter(p => { const pl = platformOf(p); return pl === 'twitter' || pl === 'x' })
  const bluesky = social.filter(p => platformOf(p) === 'bluesky')
  const pinterest = social.filter(p => platformOf(p) === 'pinterest')
  const youtubeSocial = social.filter(p => platformOf(p) === 'youtube' && !isVideo(p))
  const youtubeVideos = videos.filter(p => {
    const plat = platformOf(p)
    return plat === 'youtube' || (p.media ?? []).some((m: AnyObj) => m?.urlYoutube)
  })

  return {
    blogs,
    videos,
    social,
    allSocial,
    instagramFeed,
    reelsAndTikTok,
    stories,
    facebook,
    linkedin,
    twitter,
    bluesky,
    pinterest,
    youtubeSocial,
    youtubeVideos,
  }
}

function countFor(tab: TabKey, split: ReturnType<typeof splitAssets>): number | null {
  switch (tab) {
    case 'research':
      return null
    case 'blogs':
      return split.blogs.length
    case 'social':
      return split.social.length
    case 'videos':
      return split.videos.length
    case 'instagram':
      return split.instagramFeed.length
    case 'reels':
      return split.reelsAndTikTok.length
    case 'stories':
      return split.stories.length
    case 'facebook':
      return split.facebook.length
    case 'linkedin':
      return split.linkedin.length
    case 'twitter':
      return split.twitter.length
    case 'bluesky':
      return split.bluesky.length
    case 'pinterest':
      return split.pinterest.length
    case 'youtube':
      return split.youtubeSocial.length + split.youtubeVideos.length
  }
}
