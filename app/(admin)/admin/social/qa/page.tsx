'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useOrg } from '@/lib/contexts/OrgContext'
import { useToast } from '@/components/ui/Toast'
import { PageTabs } from '@/components/ui/AppFoundation'

type SocialPlatform =
  | 'twitter'
  | 'x'
  | 'linkedin'
  | 'facebook'
  | 'instagram'
  | 'reddit'
  | 'tiktok'
  | 'pinterest'
  | 'bluesky'
  | 'threads'
  | 'youtube'
  | 'mastodon'
  | 'dribbble'

type QaStatus = 'qa_review' | 'regenerating'

interface SocialPost {
  id: string
  platform?: SocialPlatform
  platforms?: SocialPlatform[]
  accountIds?: string[]
  content: string | { text: string; platformOverrides?: Record<string, string> }
  media?: Array<{ id?: string; url?: string; type?: string } | string>
  mediaCount?: number
  status: string
  createdBy?: string
  createdByName?: string
  createdAt?: any
  updatedAt?: any
  approval?: {
    regenerationCount?: number
    rejectionReason?: string
  }
}

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
  youtube: { bg: 'bg-red-600', label: 'YT' },
  mastodon: { bg: 'bg-purple-600', label: 'MA' },
  dribbble: { bg: 'bg-pink-500', label: 'DR' },
}

function getPostText(post: SocialPost): string {
  if (typeof post.content === 'string') return post.content
  if (post.content?.text) return post.content.text
  return ''
}

function getPostPlatforms(post: SocialPost): string[] {
  if (post.platforms?.length) return post.platforms
  if (post.platform) return [post.platform]
  return []
}

function getMediaCount(post: SocialPost): number {
  if (typeof post.mediaCount === 'number') return post.mediaCount
  if (Array.isArray(post.media)) return post.media.length
  return 0
}

function tsToDate(ts: any): Date | null {
  if (!ts) return null
  if (ts._seconds) return new Date(ts._seconds * 1000)
  if (ts.seconds) return new Date(ts.seconds * 1000)
  return new Date(ts)
}

function timeAgo(ts: any): string {
  const date = tsToDate(ts)
  if (!date) return '—'
  const now = new Date()
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
  return date.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })
}

function PlatformBadge({ platform }: { platform: string }) {
  const config = PLATFORM_COLORS[platform] ?? {
    bg: 'bg-surface-container-high',
    label: platform.slice(0, 2).toUpperCase(),
  }
  return (
    <span className={`${config.bg} text-white text-[10px] px-2 py-0.5 rounded font-bold`}>
      {config.label}
    </span>
  )
}

function StatusPill({ status }: { status: QaStatus }) {
  const styles: Record<QaStatus, string> = {
    qa_review: 'bg-amber-500/10 text-amber-400',
    regenerating: 'bg-indigo-500/10 text-indigo-400',
  }
  const label = status === 'qa_review' ? 'qa review' : 'regenerating'
  return (
    <span
      className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded ${styles[status]}`}
    >
      {label}
    </span>
  )
}

export default function QaQueuePage() {
  const { orgId } = useOrg()
  const { error: toastError } = useToast()
  const [tab, setTab] = useState<QaStatus>('qa_review')
  const [posts, setPosts] = useState<Record<QaStatus, SocialPost[]>>({
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
      } catch (err: any) {
        toastError(err?.message ?? 'Failed to load posts')
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
          {list.map((post) => {
            const text = getPostText(post)
            const platforms = getPostPlatforms(post)
            const mediaCount = getMediaCount(post)
            const preview = text.length > 200 ? `${text.slice(0, 200)}…` : text
            return (
              <div
                key={post.id}
                className="pib-card pib-card-hover flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex-1 min-w-0 space-y-3">
                  {/* Top row: platforms + status */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {platforms.length === 0 ? (
                      <span className="text-[10px] uppercase tracking-wide text-on-surface-variant">
                        no platforms
                      </span>
                    ) : (
                      platforms.map((p) => <PlatformBadge key={p} platform={p} />)
                    )}
                    <StatusPill status={tab} />
                    {typeof post.approval?.regenerationCount === 'number' &&
                      post.approval.regenerationCount > 0 && (
                        <span className="text-[10px] uppercase tracking-wider text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded">
                          rev {post.approval.regenerationCount}
                        </span>
                      )}
                  </div>

                  {/* Content preview */}
                  <p className="text-sm text-on-surface leading-relaxed whitespace-pre-wrap break-words">
                    {preview || (
                      <span className="text-on-surface-variant italic">
                        (empty content)
                      </span>
                    )}
                  </p>

                  {/* Meta row */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-on-surface-variant">
                    <span>
                      by{' '}
                      <span className="text-on-surface">
                        {post.createdByName || post.createdBy || 'unknown'}
                      </span>
                    </span>
                    <span>·</span>
                    <span>{timeAgo(post.createdAt)}</span>
                    {mediaCount > 0 && (
                      <>
                        <span>·</span>
                        <span>
                          {mediaCount} {mediaCount === 1 ? 'media' : 'media items'}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Action */}
                <div className="shrink-0 flex sm:items-center">
                  <Link
                    href={`/admin/social/qa/${post.id}`}
                    className="pib-btn-primary text-sm"
                  >
                    Open review →
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
