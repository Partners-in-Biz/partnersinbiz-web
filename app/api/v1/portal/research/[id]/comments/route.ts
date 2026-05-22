import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api/response'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { parseMentions, notifyMentions } from '@/lib/comments/mentions'
import { getResearchItem } from '@/lib/research/store'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

async function assertVisible(id: string, orgId: string) {
  const item = await getResearchItem(id, orgId)
  return item && item.visibility === 'client_visible' ? item : null
}

export const GET = withPortalAuthAndRole('viewer', async (_req: NextRequest, _uid: string, orgId: string, _role, ctx: RouteContext) => {
  const { id } = await ctx.params
  const item = await assertVisible(id, orgId)
  if (!item) return apiError('Research item not found', 404)

  const snap = await adminDb
    .collection('comments')
    .where('orgId', '==', orgId)
    .where('resourceType', '==', 'research_item')
    .where('resourceId', '==', id)
    .get()

  const comments = snap.docs
    .map((doc: FirebaseFirestore.QueryDocumentSnapshot) => ({ id: doc.id, ...doc.data() }) as { id: string; deleted?: boolean })
    .filter((comment: { deleted?: boolean }) => comment.deleted !== true)

  return apiSuccess(comments)
})

export const POST = withPortalAuthAndRole('viewer', async (req: NextRequest, uid: string, orgId: string, _role, ctx: RouteContext) => {
  const { id } = await ctx.params
  const item = await assertVisible(id, orgId)
  if (!item) return apiError('Research item not found', 404)

  const body = await req.json().catch(() => null)
  const text = typeof body?.body === 'string' ? body.body : typeof body?.text === 'string' ? body.text : ''
  if (!text.trim()) return apiError('body is required', 400)
  const parentCommentId = typeof body?.parentCommentId === 'string' && body.parentCommentId.trim()
    ? body.parentCommentId.trim()
    : null
  const anchor = body?.anchor && typeof body.anchor === 'object' && !Array.isArray(body.anchor) ? body.anchor : undefined
  const mentions = parseMentions(text)
  const docRef = await adminDb.collection('comments').add({
    orgId,
    resourceType: 'research_item',
    resourceId: id,
    parentCommentId,
    body: text,
    mentions,
    mentionIds: mentions.map((mention) => `${mention.type}:${mention.id}`),
    attachments: [],
    ...(anchor ? { anchor } : {}),
    createdBy: uid,
    createdByType: 'user',
    updatedBy: null,
    updatedByType: null,
    agentPickedUp: false,
    agentPickedUpAt: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    deleted: false,
  })

  notifyMentions({
    orgId,
    mentions,
    commentId: docRef.id,
    resourceType: 'research_item',
    resourceId: id,
    actorName: uid,
    snippet: text.trim().slice(0, 100),
  }).catch((err) => console.error('notifyMentions failed:', err))

  return apiSuccess({ id: docRef.id, mentions }, 201)
})
