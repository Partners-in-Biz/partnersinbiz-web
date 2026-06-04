'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  SocialCalendarWorkspace,
  toDatetimeLocalValue,
  type SocialCalendarPost,
} from '@/components/social/SocialCalendarWorkspace'
import { useOrg } from '@/lib/contexts/OrgContext'

function socialPostsListUrl(orgId?: string | null) {
  const params = new URLSearchParams({ limit: '500' })
  if (orgId) params.set('orgId', orgId)
  return `/api/v1/social/posts?${params.toString()}`
}

function socialPostUrl(postId: string, path = '', orgId?: string | null) {
  const params = new URLSearchParams()
  if (orgId) params.set('orgId', orgId)
  const query = params.toString()
  return `/api/v1/social/posts/${postId}${path}${query ? `?${query}` : ''}`
}

export default function CalendarPage() {
  const { orgId } = useOrg()
  const router = useRouter()
  const [posts, setPosts] = useState<SocialCalendarPost[]>([])
  const [loading, setLoading] = useState(true)

  const fetchPosts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(socialPostsListUrl(orgId))
      const body = await res.json().catch(() => ({}))
      setPosts(body.data ?? [])
    } catch {
      setPosts([])
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    fetchPosts()
  }, [fetchPosts])

  const handlePostUpdated = (updatedPost: SocialCalendarPost) => {
    setPosts((current) => current.map((post) => (post.id === updatedPost.id ? updatedPost : post)))
  }

  const handlePublish = async (post: SocialCalendarPost) => {
    const nextPost: SocialCalendarPost = { ...post, status: 'published', error: null }
    setPosts((current) => current.map((item) => (item.id === post.id ? nextPost : item)))
    try {
      await fetch(socialPostUrl(post.id, '/publish', orgId), { method: 'POST' })
      return nextPost
    } finally {
      fetchPosts()
    }
  }

  const handleCancel = async (post: SocialCalendarPost) => {
    const nextPost: SocialCalendarPost = { ...post, status: 'cancelled' }
    setPosts((current) => current.map((item) => (item.id === post.id ? nextPost : item)))
    try {
      await fetch(socialPostUrl(post.id, '', orgId), { method: 'DELETE' })
      return nextPost
    } finally {
      fetchPosts()
    }
  }

  const handleReschedule = async (post: SocialCalendarPost, scheduledAt: Date) => {
    const timestamp = { seconds: Math.floor(scheduledAt.getTime() / 1000) }
    const nextPost: SocialCalendarPost = {
      ...post,
      scheduledAt: timestamp,
      scheduledFor: timestamp,
    }
    setPosts((current) => current.map((item) => (item.id === post.id ? nextPost : item)))

    try {
      await fetch(socialPostUrl(post.id, '', orgId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledAt: scheduledAt.toISOString(), status: post.status }),
      })
      return nextPost
    } catch (error) {
      fetchPosts()
      throw error
    }
  }

  const handleCreateForDay = (day: Date) => {
    router.push(`/admin/social/compose?scheduledAt=${encodeURIComponent(toDatetimeLocalValue(day))}`)
  }

  return (
    <SocialCalendarWorkspace
      posts={posts}
      loading={loading}
      title="Calendar"
      description="Drag posts to reschedule, click a day to create."
      composeHref="/admin/social/compose"
      composeLabel="Compose post"
      wrapperClassName="mx-auto max-w-5xl space-y-5 p-6"
      allowDayCreate
      allowDragReschedule
      closePanelAfterActions
      onCreateForDay={handleCreateForDay}
      onPostUpdated={handlePostUpdated}
      onPublishNow={handlePublish}
      onCancelPost={handleCancel}
      onReschedulePost={handleReschedule}
      editHref={() => '/admin/social/compose'}
    />
  )
}
