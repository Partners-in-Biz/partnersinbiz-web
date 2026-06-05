'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  getScheduledDate,
  SocialCalendarWorkspace,
  toDatetimeLocalValue,
  type SocialCalendarPost,
  type SocialCalendarPostStatus,
} from '@/components/social/SocialCalendarWorkspace'
import { appendQueryParams, scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

const PORTAL_PUBLISHABLE_STATUSES: SocialCalendarPostStatus[] = [
  'draft',
  'qa_review',
  'regenerating',
  'client_review',
  'pending_approval',
  'approved',
  'vaulted',
  'scheduled',
  'partially_published',
  'failed',
]

function portalSocialPostUrl(path = '', orgId?: string | null) {
  const params = new URLSearchParams()
  if (orgId) params.set('orgId', orgId)
  const query = params.toString()
  return `/api/v1/portal/social/posts${path}${query ? `?${query}` : ''}`
}

function socialPostsListUrl(orgId?: string | null) {
  const params = new URLSearchParams({ limit: '500' })
  if (orgId) params.set('orgId', orgId)
  return `/api/v1/social/posts?${params.toString()}`
}

export default function PortalSocialCalendarPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const composeHref = useMemo(() => scopedPortalPath('/portal/social/compose', orgScope), [orgScope])
  const [posts, setPosts] = useState<SocialCalendarPost[]>([])
  const [loading, setLoading] = useState(true)
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadPosts() {
      setLoading(true)
      try {
        const orgRes = await fetch(scopedApiPath('/api/v1/portal/org', orgScope))
        const orgBody = orgRes.ok ? await orgRes.json().catch(() => null) : null
        const orgId = orgScope.orgId ?? (typeof orgBody?.org?.id === 'string' ? orgBody.org.id : null)
        if (!cancelled) setActiveOrgId(orgId)

        const postsRes = await fetch(socialPostsListUrl(orgId))
        const postsBody = await postsRes.json().catch(() => ({}))
        if (cancelled) return
        const datedPosts = ((postsBody.data ?? []) as SocialCalendarPost[]).filter((post) => getScheduledDate(post))
        setPosts(datedPosts)
      } catch {
        if (!cancelled) setPosts([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadPosts()
    return () => {
      cancelled = true
    }
  }, [orgScope])

  const handlePostUpdated = (updatedPost: SocialCalendarPost) => {
    setPosts((current) => current.map((post) => (post.id === updatedPost.id ? updatedPost : post)))
  }

  const handleReschedule = async (post: SocialCalendarPost, scheduledAtDate: Date) => {
    const scheduledAt = scheduledAtDate.toISOString()
    const res = await fetch(portalSocialPostUrl(`/${post.id}/reschedule`, activeOrgId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduledAt }),
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new Error(body?.error ?? 'Reschedule failed')

    const nextPost: SocialCalendarPost = {
      ...post,
      status: 'scheduled',
      scheduledAt,
      scheduledFor: scheduledAt,
      error: null,
    }
    handlePostUpdated(nextPost)
    return nextPost
  }

  const handlePublishNow = async (post: SocialCalendarPost) => {
    const res = await fetch(portalSocialPostUrl(`/${post.id}/publish-now`, activeOrgId), {
      method: 'POST',
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new Error(body?.error ?? 'Publish failed')

    const nextPost: SocialCalendarPost = {
      ...post,
      status: 'published',
      error: null,
      externalId: body?.data?.externalId ?? post.externalId ?? null,
    }
    handlePostUpdated(nextPost)
    return nextPost
  }

  const handleCreateForDay = (day: Date) => {
    router.push(appendQueryParams(composeHref, { scheduledAt: toDatetimeLocalValue(day) }))
  }

  return (
    <SocialCalendarWorkspace
      posts={posts}
      loading={loading}
      eyebrow="Social calendar"
      title="Scheduled posts"
      description="See what is planned across your connected social channels."
      composeHref={composeHref}
      composeLabel="Compose post"
      allowDayCreate
      allowDragReschedule
      closePanelAfterActions
      publishableStatuses={PORTAL_PUBLISHABLE_STATUSES}
      failPostOnPublishError
      onCreateForDay={handleCreateForDay}
      onPostUpdated={handlePostUpdated}
      onPublishNow={handlePublishNow}
      onReschedulePost={handleReschedule}
      editHref={() => composeHref}
    />
  )
}
