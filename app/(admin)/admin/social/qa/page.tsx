'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { SocialPostReviewQueueCard } from '@/components/social-review/SocialPostReviewQueueCard'
import type { SocialPostReviewPost } from '@/components/social-review/SocialPostReviewWorkspace'
import { useOrg } from '@/lib/contexts/OrgContext'
import { useToast } from '@/components/ui/Toast'
import { PageTabs } from '@/components/ui/AppFoundation'

type QaStatus = 'qa_review' | 'regenerating'

const STATUS_LABELS: Record<QaStatus, string> = {
  qa_review: 'QA review',
  regenerating: 'Regenerating',
}

export default function QaQueuePage() {
  const { orgId } = useOrg()
  const { error: toastError } = useToast()
  const [tab, setTab] = useState<QaStatus>('qa_review')
  const [posts, setPosts] = useState<Record<QaStatus, SocialPostReviewPost[]>>({
    qa_review: [],
    regenerating: [],
  })
  const [loading, setLoading] = useState<Record<QaStatus, boolean>>({
    qa_review: true,
    regenerating: true,
  })

  const fetchOne = useCallback(
    async (status: QaStatus) => {
      setLoading((s) => ({ ...s, [status]: true }))
      try {
        const params = new URLSearchParams()
        params.set('status', status)
        params.set('limit', '100')
        if (orgId) params.set('orgId', orgId)
        const res = await fetch(`/api/v1/social/posts?${params.toString()}`)
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? 'Failed to load posts')
        setPosts((p) => ({ ...p, [status]: body.data ?? [] }))
      } catch (err: unknown) {
        toastError(err instanceof Error ? err.message : 'Failed to load posts')
        setPosts((p) => ({ ...p, [status]: [] }))
      } finally {
        setLoading((s) => ({ ...s, [status]: false }))
      }
    },
    [orgId, toastError],
  )

  const fetchAll = useCallback(() => {
    fetchOne('qa_review')
    fetchOne('regenerating')
  }, [fetchOne])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  const counts = {
    qa_review: posts.qa_review.length,
    regenerating: posts.regenerating.length,
  }

  const list = posts[tab]
  const isLoading = loading[tab]

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">social</p>
          <h1 className="font-headline text-3xl text-on-surface mt-1">QA Review</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Internal approval — review posts before sending to the client.
          </p>
        </div>
        <button onClick={fetchAll} className="pib-btn-secondary text-sm">
          Refresh
        </button>
      </div>

      <PageTabs
        ariaLabel="Social QA status"
        value={tab}
        onValueChange={(value) => setTab(value as QaStatus)}
        tabs={[
          { value: 'qa_review', label: 'Pending QA', badge: counts.qa_review },
          { value: 'regenerating', label: 'Regenerating', badge: counts.regenerating },
        ]}
      />

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="pib-skeleton h-24 w-full" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="pib-card text-center py-16 text-sm text-on-surface-variant">
          No posts in this stage right now.
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((post) => (
            <SocialPostReviewQueueCard
              key={post.id}
              post={post}
              href={`/admin/social/qa/${post.id}`}
              actionLabel="Open review"
              statusLabel={STATUS_LABELS[tab]}
              statusTone={tab === 'qa_review' ? 'warning' : 'info'}
              layout="row"
              showCreatedBy
              showMediaCount
            />
          ))}
        </div>
      )}
    </div>
  )
}
