/**
 * GET  /api/v1/social/posts/:id/comments — list comments for a post
 * POST /api/v1/social/posts/:id/comments — create a comment on a post
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiError } from '@/lib/api/response'
import { notifyNewComment } from '@/lib/notifications/notify'
import { getHermesProfileLink, createHermesRun } from '@/lib/hermes/server'
import { logActivity } from '@/lib/activity/log'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * GET — list comments for a post, ordered by createdAt ascending
 */
export const GET = withAuth('client', withTenant(async (req, user, orgId, context) => {
  const { id } = await (context as RouteContext).params

  try {
    const postRef = adminDb.collection('social_posts').doc(id)
    const postDoc = await postRef.get()

    // Verify post exists and belongs to org
    if (!postDoc.exists) {
      return apiError('Post not found', 404)
    }

    const postData = postDoc.data()!
    if (postData.orgId && postData.orgId !== orgId) {
      return apiError('Post not found', 404)
    }

    // Fetch comments, ordered by createdAt ascending
    const commentsSnap = await postRef
      .collection('comments')
      .orderBy('createdAt', 'asc')
      .get()

    const comments = commentsSnap.docs.map(doc => {
      const data = doc.data()
      return {
        id: doc.id,
        text: data.text,
        userId: data.userId,
        userName: data.userName,
        userRole: data.userRole,
        createdAt: data.createdAt,
        agentPickedUp: data.agentPickedUp ?? false,
        agentPickedUpAt: data.agentPickedUpAt ?? null,
        anchor: data.anchor ?? null,
      }
    })

    return apiSuccess(comments)
  } catch (err) {
    console.error('Error fetching comments:', err)
    return apiError('Failed to fetch comments', 500)
  }
}))

/**
 * POST — create a comment on a post
 * Body: { text: string }
 */
export const POST = withAuth('client', withTenant(async (req, user, orgId, context) => {
  const { id } = await (context as RouteContext).params

  try {
    const body = await req.json().catch(() => ({}))
    const { text } = body

    // Validate text is non-empty
    if (!text || typeof text !== 'string' || text.trim() === '') {
      return apiError('Comment text is required and cannot be empty', 400)
    }

    // Verify post exists and belongs to org
    const postRef = adminDb.collection('social_posts').doc(id)
    const postDoc = await postRef.get()

    if (!postDoc.exists) {
      return apiError('Post not found', 404)
    }

    const postData = postDoc.data()!
    if (postData.orgId && postData.orgId !== orgId) {
      return apiError('Post not found', 404)
    }

    // Fetch user displayName
    const userDoc = await adminDb.collection('users').doc(user.uid).get()
    const displayName = userDoc.exists ? (userDoc.data()?.displayName || user.uid) : user.uid

    // Determine userRole
    const userRole = user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client'

    // Optional anchor — text excerpt OR media URL the client commented on.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawAnchor = body?.anchor as any
    let anchor: {
      type: 'text' | 'image'
      text?: string
      offset?: number
      mediaUrl?: string
    } | null = null
    if (rawAnchor && (rawAnchor.type === 'text' || rawAnchor.type === 'image')) {
      anchor = { type: rawAnchor.type }
      if (rawAnchor.type === 'text' && typeof rawAnchor.text === 'string') {
        anchor.text = String(rawAnchor.text).slice(0, 400)
        if (typeof rawAnchor.offset === 'number' && rawAnchor.offset >= 0) {
          anchor.offset = Math.floor(rawAnchor.offset)
        }
      }
      if (rawAnchor.type === 'image' && typeof rawAnchor.mediaUrl === 'string') {
        anchor.mediaUrl = String(rawAnchor.mediaUrl).slice(0, 1000)
      }
    }

    // Create comment
    const commentRef = postRef.collection('comments').doc()
    const commentData = {
      text: text.trim(),
      userId: user.uid,
      userName: displayName,
      userRole,
      createdAt: FieldValue.serverTimestamp(),
      agentPickedUp: false,
      ...(anchor ? { anchor } : {}),
    }

    await commentRef.set(commentData)

    // Send notification for new comment
    notifyNewComment({
      commentText: text.trim(),
      commenterName: displayName,
      commenterRole: userRole,
      context: `on social post for ${postData.orgId}`,
      orgId,
      viewUrl: `/portal/social`,
    }).catch(() => {})

    // Firestore notification (fire-and-forget)
    adminDb.collection('notifications').add({
      orgId,
      userId: null,
      agentId: null,
      type: 'social_post_commented',
      title: `New comment on social post`,
      body: `${displayName}: "${text.trim().slice(0, 120)}"`,
      link: `/portal/social`,
      data: { postId: id, orgId, commentId: commentRef.id },
      priority: 'normal',
      status: 'unread',
      snoozedUntil: null,
      readAt: null,
      createdAt: FieldValue.serverTimestamp(),
    }).catch(() => {})

    if (userRole === 'client') {
      // Hermes agent dispatch (fire-and-forget)
      getHermesProfileLink(orgId)
        .then((link) => {
          if (!link) return
          const anchorHint =
            anchor?.type === 'text'
              ? ` Specifically about this text: "${(anchor.text ?? '').slice(0, 120)}"`
              : anchor?.type === 'image'
                ? ' (on an image in the post)'
                : ''
          return createHermesRun(link, user.uid, {
            prompt: `Client ${displayName} left feedback on a social post for org ${orgId}.${anchorHint} Their comment: "${text.trim().slice(0, 300)}". Post ID: ${id}. Please review this feedback and revise the post if appropriate.`,
          })
        })
        .catch(() => {})
    }

    logActivity({
      orgId,
      type: 'social_post_commented',
      actorId: user.uid,
      actorName: displayName,
      actorRole: userRole,
      description: `Commented on social post: "${text.trim().slice(0, 120)}"`,
      entityId: id,
      entityType: 'social_post',
    }).catch(() => {})

    return apiSuccess({
      id: commentRef.id,
      ...commentData,
      createdAt: new Date(), // Client will use serverTimestamp, but we return current time for immediate display
    })
  } catch (err) {
    console.error('Error creating comment:', err)
    return apiError('Failed to create comment', 500)
  }
}))
