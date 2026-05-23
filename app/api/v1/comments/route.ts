/**
 * GET  /api/v1/comments — list unified comments across any resource
 * POST /api/v1/comments — create a comment (parses @mentions, notifies)
 *
 * Auth: admin (AI/admin).
 *
 * This is the cross-resource comments system. Social posts keep their
 * existing per-post comment subcollection at
 * `/api/v1/social/posts/[id]/comments` for backward compatibility.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { actorFrom } from '@/lib/api/actor'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  VALID_COMMENT_RESOURCE_TYPES,
  type Comment,
  type CommentResourceType,
} from '@/lib/comments/types'
import { parseMentions, notifyMentions } from '@/lib/comments/mentions'

export const dynamic = 'force-dynamic'

/**
 * GET — list comments. Requires `orgId`. Optional filters:
 *   - resourceType, resourceId, parentCommentId
 *   - includeDeleted (default false)
 *   - limit (default 100, max 500)
 * Sort: `createdAt` asc.
 */
export const GET = withAuth('admin', async (req) => {
  const { searchParams } = new URL(req.url)

  const orgId = searchParams.get('orgId')
  if (!orgId) return apiError('orgId is required; pass it as a query param')

  const resourceType = searchParams.get('resourceType') as CommentResourceType | null
  const resourceId = searchParams.get('resourceId')
  const parentCommentId = searchParams.get('parentCommentId')
  const includeDeleted = searchParams.get('includeDeleted') === 'true'
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100', 10) || 100, 500)

  if (resourceType && !VALID_COMMENT_RESOURCE_TYPES.includes(resourceType)) {
    return apiError(
      `Invalid resourceType; expected one of ${VALID_COMMENT_RESOURCE_TYPES.join(', ')}`,
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = adminDb.collection('comments').where('orgId', '==', orgId)

  if (resourceType) query = query.where('resourceType', '==', resourceType)
  if (resourceId) query = query.where('resourceId', '==', resourceId)
  if (parentCommentId) query = query.where('parentCommentId', '==', parentCommentId)

  query = query.orderBy('createdAt', 'asc').limit(limit)

  const snap = await query.get()
  const comments: Comment[] = snap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((doc: any) => ({ id: doc.id, ...doc.data() }))
    .filter((c: Comment) => (includeDeleted ? true : c.deleted !== true))

  return apiSuccess(comments)
})

/**
 * POST — create a comment.
 * Body: { orgId, resourceType, resourceId, body, parentCommentId?, attachments?, anchor? }
 * Parses @mentions out of `body`, writes the comment, then fires mention
 * notifications (fire-and-forget — the response is not blocked on them).
 */
export const POST = withAuth('admin', async (req, user) => {
  const body = await req.json().catch(() => ({}))

  const orgId: string | undefined = body.orgId?.trim?.()
  const resourceType: string | undefined = body.resourceType
  const resourceId: string | undefined = body.resourceId?.trim?.()
  const text: string | undefined = typeof body.body === 'string' ? body.body : typeof body.text === 'string' ? body.text : undefined
  const parentCommentId: string | null =
    typeof body.parentCommentId === 'string' && body.parentCommentId.trim()
      ? body.parentCommentId.trim()
      : null
  const attachments: string[] = Array.isArray(body.attachments)
    ? body.attachments.filter((a: unknown) => typeof a === 'string')
    : []
  const anchor = body.anchor && typeof body.anchor === 'object' && !Array.isArray(body.anchor)
    ? body.anchor
    : undefined

  if (!orgId) return apiError('orgId is required')
  if (!resourceType) return apiError('resourceType is required')
  if (!VALID_COMMENT_RESOURCE_TYPES.includes(resourceType as CommentResourceType)) {
    return apiError(
      `Invalid resourceType; expected one of ${VALID_COMMENT_RESOURCE_TYPES.join(', ')}`,
    )
  }
  if (!resourceId) return apiError('resourceId is required')
  if (!text || !text.trim()) return apiError('body (or text) is required and cannot be empty')

  const mentions = parseMentions(text)
  const mentionIds = mentions.map((m) => `${m.type}:${m.id}`)

  const docRef = await adminDb.collection('comments').add({
    orgId,
    resourceType,
    resourceId,
    parentCommentId,
    body: text,
    mentions,
    mentionIds,
    attachments,
    ...(anchor ? { anchor } : {}),
    ...actorFrom(user),
    updatedBy: null,
    updatedByType: null,
    agentPickedUp: false,
    agentPickedUpAt: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    deleted: false,
  })

  // Resolve an actor display name for the notification title. AI agents
  // get a fixed label; humans fall back to their uid if no displayName.
  const actorName =
    user.uid === 'ai-agent'
      ? 'AI Agent'
      : (await adminDb.collection('users').doc(user.uid).get()).data()?.displayName ?? user.uid

  const snippet = text.trim().slice(0, 100)

  // Fire-and-forget — don't block the response on notification writes.
  notifyMentions({
    orgId,
    mentions,
    commentId: docRef.id,
    resourceType,
    resourceId,
    actorName,
    snippet,
  }).catch((err) => console.error('notifyMentions failed:', err))

  return apiSuccess({ id: docRef.id, mentions }, 201)
})
