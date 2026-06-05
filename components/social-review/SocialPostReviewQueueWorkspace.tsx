'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageTabs } from '@/components/ui/AppFoundation'
import { useOrg } from '@/lib/contexts/OrgContext'
import {
  scopedApiPath,
  scopedPortalPath,
  scopeFromSearchParams,
} from '@/lib/portal/scoped-routing'
import { SocialPostReviewQueueCard, type SocialPostReviewQueueTone } from './SocialPostReviewQueueCard'
import { tsToDate, type SocialPostReviewPost } from './SocialPostReviewWorkspace'

type ReviewQueueSurface = 'admin' | 'portal'
type ReviewQueueLayout = 'row' | 'card'

type ReviewQueueGroup = {
  value: string
  tabLabel: string
  statuses: string[]
  statusLabel: string
  statusTone: SocialPostReviewQueueTone
  layout: ReviewQueueLayout
  showCreatedBy?: boolean
  showMediaCount?: boolean
  showMediaThumbs?: boolean
  skeletonHeight: string
}

type ReviewQueueConfig = {
  eyebrow?: string
  title: string
  description: string
  wrapperClassName: string
  backHref?: string
  backLabel?: string
  emptyMessage: string
  groups: ReviewQueueGroup[]
}

type SocialPostReviewQueueWorkspaceProps = {
  surface: ReviewQueueSurface
}

const ADMIN_CONFIG: ReviewQueueConfig = {
  eyebrow: 'social',
  title: 'QA Review',
  description: 'Internal approval - review posts before sending to the client.',
  wrapperClassName: 'p-6 max-w-6xl mx-auto space-y-6',
  emptyMessage: 'No posts in this stage right now.',
  groups: [
    {
      value: 'qa_review',
      tabLabel: 'Pending QA',
      statuses: ['qa_review'],
      statusLabel: 'QA review',
      statusTone: 'warning',
      layout: 'row',
      showCreatedBy: true,
      showMediaCount: true,
      skeletonHeight: 'h-24',
    },
    {
      value: 'regenerating',
      tabLabel: 'Regenerating',
      statuses: ['regenerating'],
      statusLabel: 'Regenerating',
      statusTone: 'info',
      layout: 'row',
      showCreatedBy: true,
      showMediaCount: true,
      skeletonHeight: 'h-24',
    },
  ],
}

const PORTAL_CONFIG: ReviewQueueConfig = {
  title: 'Posts to review',
  description:
    'Approve, comment on, or send back posts your team has prepared. Once approved, they go to the vault and, if scheduled, into your queue.',
  wrapperClassName: 'space-y-6',
  backHref: '/portal/social',
  backLabel: '← Social',
  emptyMessage: 'All caught up - no posts waiting for your review.',
  groups: [
    {
      value: 'client_review',
      tabLabel: 'Client review',
      statuses: ['client_review', 'pending_approval'],
      statusLabel: 'Client review',
      statusTone: 'warning',
      layout: 'card',
      showMediaCount: true,
      showMediaThumbs: true,
      skeletonHeight: 'h-36',
    },
  ],
}

function emptyPostState(groups: ReviewQueueGroup[]): Record<string, SocialPostReviewPost[]> {
  return Object.fromEntries(groups.map((group) => [group.value, []]))
}

function loadingState(groups: ReviewQueueGroup[], value: boolean): Record<string, boolean> {
  return Object.fromEntries(groups.map((group) => [group.value, value]))
}

function sortPosts(posts: SocialPostReviewPost[]): SocialPostReviewPost[] {
  return [...posts].sort((left, right) => {
    const leftTime = tsToDate(left.createdAt)?.getTime() ?? 0
    const rightTime = tsToDate(right.createdAt)?.getTime() ?? 0
    return rightTime - leftTime
  })
}

export function SocialPostReviewQueueWorkspace({ surface }: SocialPostReviewQueueWorkspaceProps) {
  const config = surface === 'admin' ? ADMIN_CONFIG : PORTAL_CONFIG
  const { orgId } = useOrg()
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const [tab, setTab] = useState(config.groups[0]?.value ?? '')
  const [posts, setPosts] = useState<Record<string, SocialPostReviewPost[]>>(() => emptyPostState(config.groups))
  const [loading, setLoading] = useState<Record<string, boolean>>(() => loadingState(config.groups, true))
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const buildApiHref = useCallback(
    (status: string) => {
      const path = `/api/v1/social/posts?status=${encodeURIComponent(status)}&limit=100`
      if (surface === 'portal') return scopedApiPath(path, orgScope)
      return orgId ? `${path}&orgId=${encodeURIComponent(orgId)}` : path
    },
    [orgId, orgScope, surface],
  )

  const buildPostHref = useCallback(
    (postId: string) => {
      if (surface === 'portal') return scopedPortalPath(`/portal/social/review/${postId}`, orgScope)
      return `/admin/social/qa/${postId}`
    },
    [orgScope, surface],
  )

  const loadGroup = useCallback(
    async (group: ReviewQueueGroup): Promise<SocialPostReviewPost[]> => {
      const responses = await Promise.all(
        group.statuses.map(async (status) => {
          const res = await fetch(buildApiHref(status))
          const body = await res.json()
          if (!res.ok) throw new Error(body.error ?? 'Failed to load posts')
          return (body.data ?? []) as SocialPostReviewPost[]
        }),
      )
      const merged = new Map<string, SocialPostReviewPost>()
      for (const post of responses.flat()) merged.set(post.id, post)
      return sortPosts(Array.from(merged.values()))
    },
    [buildApiHref],
  )

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true)
      else setLoading(loadingState(config.groups, true))
      setError(null)

      try {
        const entries = await Promise.all(
          config.groups.map(async (group) => [group.value, await loadGroup(group)] as const),
        )
        setPosts(Object.fromEntries(entries))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load posts. Try refreshing.')
        setPosts(emptyPostState(config.groups))
      } finally {
        setLoading(loadingState(config.groups, false))
        setRefreshing(false)
      }
    },
    [config.groups, loadGroup],
  )

  useEffect(() => {
    load()
  }, [load])

  const activeGroup = config.groups.find((group) => group.value === tab) ?? config.groups[0]
  const list = posts[activeGroup.value] ?? []
  const isLoading = loading[activeGroup.value]
  const backHref = config.backHref && surface === 'portal'
    ? scopedPortalPath(config.backHref, orgScope)
    : config.backHref

  return (
    <div className={config.wrapperClassName}>
      <div className="flex items-start justify-between gap-4">
        <div>
          {backHref && config.backLabel ? (
            <div className="flex items-center gap-3 text-xs text-[var(--color-on-surface-variant)] mb-2">
              <Link href={backHref} className="hover:text-[var(--color-accent-v2)] transition-colors">
                {config.backLabel}
              </Link>
            </div>
          ) : null}
          {config.eyebrow ? <p className="eyebrow">{config.eyebrow}</p> : null}
          <h1 className="font-headline text-2xl md:text-3xl font-semibold text-on-surface mt-1 tracking-tight">
            {config.title}
          </h1>
          <p className="text-sm text-on-surface-variant mt-1 max-w-xl">{config.description}</p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing || Boolean(isLoading)}
          className="pib-btn-secondary text-xs px-3 py-1.5 flex-shrink-0"
          style={{
            opacity: refreshing || isLoading ? 0.6 : 1,
            cursor: refreshing || isLoading ? 'not-allowed' : 'pointer',
          }}
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {config.groups.length > 1 ? (
        <PageTabs
          ariaLabel="Social review status"
          value={tab}
          onValueChange={setTab}
          tabs={config.groups.map((group) => ({
            value: group.value,
            label: group.tabLabel,
            badge: posts[group.value]?.length ?? 0,
          }))}
        />
      ) : null}

      {error ? (
        <div className="p-3 bg-red-900/30 border border-red-400/40 text-red-300 text-sm rounded">
          {error}
        </div>
      ) : null}

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(surface === 'admin' ? 4 : 3)].map((_, index) => (
            <div key={index} className={`pib-skeleton ${activeGroup.skeletonHeight} w-full`} />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className={surface === 'admin' ? 'pib-card text-center py-16 text-sm text-on-surface-variant' : 'pib-card p-8 text-center'}>
          <p className="text-on-surface-variant">{config.emptyMessage}</p>
        </div>
      ) : (
        <div className={activeGroup.layout === 'row' ? 'space-y-3' : 'grid grid-cols-1 md:grid-cols-2 gap-4'}>
          {list.map((post) => (
            <SocialPostReviewQueueCard
              key={post.id}
              post={post}
              href={buildPostHref(post.id)}
              actionLabel="Open review"
              statusLabel={activeGroup.statusLabel}
              statusTone={activeGroup.statusTone}
              layout={activeGroup.layout}
              showCreatedBy={activeGroup.showCreatedBy}
              showMediaCount={activeGroup.showMediaCount}
              showMediaThumbs={activeGroup.showMediaThumbs}
            />
          ))}
        </div>
      )}
    </div>
  )
}
