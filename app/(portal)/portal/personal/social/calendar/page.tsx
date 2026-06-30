'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  getScheduledDate,
  SocialCalendarWorkspace,
  toDatetimeLocalValue,
  type SocialCalendarPost,
  type SocialCalendarPostStatus,
} from '@/components/social/SocialCalendarWorkspace'
import { appendQueryParams } from '@/lib/portal/scoped-routing'

const PERSONAL_PUBLISHABLE_STATUSES: SocialCalendarPostStatus[] = [
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

const composeHref = '/portal/personal/social/compose'

export default function PersonalSocialCalendarPage() {
  const router = useRouter()
  const [posts, setPosts] = useState<SocialCalendarPost[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function loadPosts() {
      setLoading(true)
      try {
        const postsRes = await fetch('/api/v1/social/posts?limit=500&scope=personal')
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
    return () => { cancelled = true }
  }, [])

  const handlePostUpdated = (updatedPost: SocialCalendarPost) => {
    setPosts((current) => current.map((post) => (post.id === updatedPost.id ? updatedPost : post)))
  }

  const handleReschedule = async (post: SocialCalendarPost, scheduledAtDate: Date) => {
    const scheduledAt = scheduledAtDate.toISOString()
    const res = await fetch(`/api/v1/portal/social/posts/${post.id}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduledAt }),
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new Error(body?.error ?? 'Reschedule failed')
    const nextPost = { ...post, status: 'scheduled' as const, scheduledAt, scheduledFor: scheduledAt, error: null }
    handlePostUpdated(nextPost)
    return nextPost
  }

  const handlePublishNow = async (post: SocialCalendarPost) => {
    const res = await fetch(`/api/v1/portal/social/posts/${post.id}/publish-now`, { method: 'POST' })
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new Error(body?.error ?? 'Publish failed')
    const nextPost = { ...post, status: 'published' as const, error: null, externalId: body?.data?.externalId ?? post.externalId ?? null }
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
      eyebrow="Personal social calendar"
      title="Personal scheduled posts"
      description="See what is planned for your user-owned social channels."
      composeHref={composeHref}
      composeLabel="Compose personal post"
      allowDayCreate
      allowDragReschedule
      closePanelAfterActions
      publishableStatuses={PERSONAL_PUBLISHABLE_STATUSES}
      failPostOnPublishError
      onCreateForDay={handleCreateForDay}
      onPostUpdated={handlePostUpdated}
      onPublishNow={handlePublishNow}
      onReschedulePost={handleReschedule}
      editHref={() => composeHref}
    />
  )
}
