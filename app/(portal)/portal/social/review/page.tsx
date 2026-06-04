'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { SocialPostReviewQueueCard } from '@/components/social-review/SocialPostReviewQueueCard'
import {
  tsToDate,
  type SocialPostReviewPost,
} from '@/components/social-review/SocialPostReviewWorkspace'
import {
  scopedApiPath,
  scopedPortalPath,
  scopeFromSearchParams,
} from '@/lib/portal/scoped-routing'

export default function ClientReviewQueuePage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const socialHref = useMemo(() => scopedPortalPath('/portal/social', orgScope), [orgScope])
  const [posts, setPosts] = useState<SocialPostReviewPost[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    setError(null)
    try {
      const [clientReviewRes, pendingRes] = await Promise.all([
        fetch(scopedApiPath('/api/v1/social/posts?status=client_review&limit=100', orgScope))
          .then(response => response.json())
          .catch(() => ({})),
        fetch(scopedApiPath('/api/v1/social/posts?status=pending_approval&limit=100', orgScope))
          .then(response => response.json())
          .catch(() => ({})),
      ])
      const clientReviewPosts: SocialPostReviewPost[] = clientReviewRes?.data ?? []
      const pendingPosts: SocialPostReviewPost[] = pendingRes?.data ?? []
      const merged = new Map<string, SocialPostReviewPost>()
      for (const post of [...clientReviewPosts, ...pendingPosts]) merged.set(post.id, post)
      const list = Array.from(merged.values()).sort((left, right) => {
        const leftTime = tsToDate(left.createdAt)?.getTime() ?? 0
        const rightTime = tsToDate(right.createdAt)?.getTime() ?? 0
        return rightTime - leftTime
      })
      setPosts(list)
    } catch {
      setError('Could not load posts. Try refreshing.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [orgScope])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 text-xs text-[var(--color-on-surface-variant)] mb-2">
            <Link href={socialHref} className="hover:text-[var(--color-accent-v2)] transition-colors">
              Back to Social
            </Link>
          </div>
          <h1 className="font-headline text-2xl font-bold tracking-tighter">Posts to review</h1>
          <p className="text-sm text-[var(--color-on-surface-variant)] mt-1 max-w-xl">
            Approve, comment on, or send back posts your team has prepared. Once approved, they go to the vault and, if scheduled, into your queue.
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={loading || refreshing}
          className="pib-btn-secondary text-xs px-3 py-1.5 flex-shrink-0"
          style={{
            opacity: loading || refreshing ? 0.6 : 1,
            cursor: loading || refreshing ? 'not-allowed' : 'pointer',
          }}
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <div className="p-3 bg-red-900/30 border border-red-400/40 text-red-300 text-sm rounded">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, index) => (
            <div key={index} className="pib-skeleton p-5 h-36" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="pib-card p-8 text-center">
          <p className="text-[var(--color-on-surface-variant)]">All caught up - no posts waiting for your review.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {posts.map(post => (
            <SocialPostReviewQueueCard
              key={post.id}
              post={post}
              href={scopedPortalPath(`/portal/social/review/${post.id}`, orgScope)}
              actionLabel="Open review"
              statusLabel="Client review"
              statusTone="warning"
              showMediaThumbs
            />
          ))}
        </div>
      )}
    </div>
  )
}
