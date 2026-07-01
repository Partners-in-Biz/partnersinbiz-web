/**
 * GET    /api/v1/social/posts/:id  — get a single social post
 * PUT    /api/v1/social/posts/:id  — update a social post (partial)
 * DELETE /api/v1/social/posts/:id  — soft delete (sets status: 'cancelled')
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiError } from '@/lib/api/response'
import { validatePostContent } from '@/lib/social/validation'
import { validateOutboundLinks } from '@/lib/social/outbound-link-validation'
import { logAudit } from '@/lib/social/audit'
import { logActivity } from '@/lib/activity/log'
import type { SocialPostCategory } from '@/lib/social/types'
import type { SocialPlatformType, PostStatus } from '@/lib/social/providers'
import {
  RESOURCE_RELATIONSHIP_ARRAY_FIELDS,
  RESOURCE_RELATIONSHIP_STRING_FIELDS,
  normalizeResourceRelationshipLinks,
} from '@/lib/client-documents/linkedValidation'
import {
  cancelSocialQueueEntry,
  hasActivePublishAccount,
  hasFinalApproval,
  upsertSocialQueueEntry,
} from '@/lib/social/scheduling'

export const dynamic = 'force-dynamic'

// Use the canonical PostStatus type — includes pending_approval, approved, publishing, partially_published
const VALID_STATUSES: PostStatus[] = [
  'draft', 'qa_review', 'regenerating', 'client_review', 'pending_approval', 'approved', 'vaulted', 'scheduled',
  'publishing', 'published', 'partially_published', 'failed', 'cancelled',
]
const VALID_CATEGORIES: SocialPostCategory[] = ['work', 'personal', 'ai', 'sport', 'sa', 'other']
const VALID_VISIBILITIES = ['private', 'unlisted', 'public'] as const

type Params = { params: Promise<{ id: string }> }

function relationshipInputFrom(body: Record<string, unknown>) {
  const value: Record<string, unknown> = {}
  for (const key of RESOURCE_RELATIONSHIP_STRING_FIELDS) {
    if (key in body) value[key] = body[key]
  }
  for (const key of RESOURCE_RELATIONSHIP_ARRAY_FIELDS) {
    if (key in body) value[key] = body[key]
  }
  if ('contextRefs' in body) value.contextRefs = body.contextRefs
  return Object.keys(value).length > 0 ? value : undefined
}

export const GET = withAuth('client', withTenant(async (_req, _user, orgId, context) => {
  const { id } = await (context as Params).params
  const doc = await adminDb.collection('social_posts').doc(id).get()
  if (!doc.exists) return apiError('Post not found', 404)

  const data = doc.data()!
  if (data.orgId && data.orgId !== orgId) return apiError('Post not found', 404)

  return apiSuccess({ id: doc.id, ...data })
}))

export const PUT = withAuth('admin', withTenant(async (req, user, orgId, context) => {
  const { id } = await (context as Params).params
  const doc = await adminDb.collection('social_posts').doc(id).get()
  if (!doc.exists) return apiError('Post not found', 404)

  const existing = doc.data()!
  if (existing.orgId && existing.orgId !== orgId) return apiError('Post not found', 404)

  const body = await req.json()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: Record<string, any> = {
    updatedAt: FieldValue.serverTimestamp(),
  }

  // Content update — validate against platform constraints
  if ('content' in body) {
    const contentText = typeof body.content === 'string' ? body.content : body.content?.text
    if (contentText) {
      const platforms: SocialPlatformType[] = existing.platforms ?? []
      if (platforms.length > 0) {
        const validation = validatePostContent(contentText, platforms, {
          threadParts: body.threadParts ?? existing.threadParts,
        })
        if (!validation.valid) {
          return apiError(`Validation failed: ${validation.errors.map((e: { message: string }) => e.message).join('; ')}`)
        }
      }
    }
    updates.content = body.content
  }

  if ('scheduledFor' in body) {
    const ts = Timestamp.fromDate(new Date(body.scheduledFor as string))
    updates.scheduledFor = ts
    updates.scheduledAt = ts
  }

  if ('scheduledAt' in body) {
    const ts = Timestamp.fromDate(new Date(body.scheduledAt as string))
    updates.scheduledAt = ts
    updates.scheduledFor = ts
  }

  if ('status' in body) {
    if (!VALID_STATUSES.includes(body.status as PostStatus)) {
      return apiError('Invalid status', 400)
    }
    if (body.status === 'scheduled' && !hasFinalApproval(existing)) {
      return apiError('Post must be approved before it can be scheduled', 400)
    }
    updates.status = body.status as PostStatus
  }

  if ('category' in body) {
    if (!VALID_CATEGORIES.includes(body.category as SocialPostCategory)) {
      return apiError('Invalid category', 400)
    }
    updates.category = body.category as SocialPostCategory
  }

  if ('tags' in body) updates.tags = body.tags as string[]
  if ('threadParts' in body) updates.threadParts = body.threadParts as string[]
  if ('labels' in body) updates.labels = body.labels as string[]
  if ('hashtags' in body) updates.hashtags = body.hashtags as string[]
  if ('media' in body) updates.media = body.media
  if ('accountIds' in body) updates.accountIds = body.accountIds
  if ('title' in body) {
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) return apiError('title must be a non-empty string', 400)
    updates.title = title
  }
  if ('privacyStatus' in body) {
    if (!VALID_VISIBILITIES.includes(body.privacyStatus)) return apiError('Invalid privacyStatus', 400)
    updates.privacyStatus = body.privacyStatus
  }
  if ('targetVisibility' in body) {
    if (!VALID_VISIBILITIES.includes(body.targetVisibility)) return apiError('Invalid targetVisibility', 400)
    updates.targetVisibility = body.targetVisibility
  }
  if ('categoryId' in body) {
    const categoryId = typeof body.categoryId === 'string' ? body.categoryId.trim() : ''
    if (!categoryId) return apiError('categoryId must be a non-empty string', 400)
    updates.categoryId = categoryId
  }
  if ('publishAt' in body) {
    const publishAt = typeof body.publishAt === 'string' ? body.publishAt.trim() : ''
    if (!publishAt || Number.isNaN(Date.parse(publishAt))) return apiError('publishAt must be a valid ISO date string', 400)
    updates.publishAt = publishAt
  }
  if ('selfDeclaredMadeForKids' in body) {
    if (typeof body.selfDeclaredMadeForKids !== 'boolean') return apiError('selfDeclaredMadeForKids must be boolean', 400)
    updates.selfDeclaredMadeForKids = body.selfDeclaredMadeForKids
  }
  if ('containsSyntheticMedia' in body) {
    if (typeof body.containsSyntheticMedia !== 'boolean') return apiError('containsSyntheticMedia must be boolean', 400)
    updates.containsSyntheticMedia = body.containsSyntheticMedia
  }
  if ('aiDisclosureNotes' in body) {
    const aiDisclosureNotes = typeof body.aiDisclosureNotes === 'string' ? body.aiDisclosureNotes.trim() : ''
    if (!aiDisclosureNotes) return apiError('aiDisclosureNotes must be a non-empty string', 400)
    updates.aiDisclosureNotes = aiDisclosureNotes
  }
  if ('campaignId' in body) updates.campaignId = body.campaignId
  if ('pillarId' in body) updates.pillarId = body.pillarId
  if ('audience' in body) updates.audience = body.audience

  const relationshipInput = relationshipInputFrom(body as Record<string, unknown>)
  if (relationshipInput) {
    const relationships = normalizeResourceRelationshipLinks(relationshipInput)
    if (!relationships.ok) return apiError(relationships.error, 400)
    Object.assign(updates, relationships.value)
  }

  const proposedPost = { ...existing, ...updates }
  const proposedStatus = (updates.status ?? existing.status) as PostStatus | undefined
  if (proposedStatus === 'scheduled') {
    if (!hasFinalApproval(proposedPost)) {
      return apiError('Post must be approved before it can be scheduled', 400)
    }
    if (!(await hasActivePublishAccount(proposedPost, orgId))) {
      return apiError('Connect an active social account before scheduling this post', 400)
    }

    const proposedContentText = typeof proposedPost.content === 'string'
      ? proposedPost.content
      : proposedPost.content?.text
    if (proposedContentText) {
      const linkValidation = await validateOutboundLinks(proposedContentText)
      if (!linkValidation.valid) {
        return apiError(`Validation failed: ${linkValidation.errors.map(e => e.message).join('; ')}`, 400)
      }
    }
  }

  await adminDb.collection('social_posts').doc(id).update(updates)

  if (proposedStatus === 'scheduled' && proposedPost.scheduledAt) {
    await upsertSocialQueueEntry({
      postId: id,
      orgId,
      scheduledAt: proposedPost.scheduledAt,
      post: proposedPost,
    })
  } else if (updates.scheduledAt || updates.status) {
    await cancelSocialQueueEntry(id)
  }

  await logAudit({
    orgId,
    action: 'post.updated',
    entityType: 'post',
    entityId: id,
    performedBy: user.uid,
    performedByRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    details: { updatedFields: Object.keys(updates).filter(k => k !== 'updatedAt') },
    ip: req.headers.get('x-forwarded-for'),
  })

  logActivity({
    orgId,
    type: 'social_post_updated',
    actorId: user.uid,
    actorName: user.uid,
    actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    description: 'Updated social post',
    entityId: id,
    entityType: 'social_post',
  }).catch(() => {})

  return apiSuccess({ id })
}))

export const DELETE = withAuth('admin', withTenant(async (req, user, orgId, context) => {
  const { id } = await (context as Params).params
  const doc = await adminDb.collection('social_posts').doc(id).get()
  if (!doc.exists) return apiError('Post not found', 404)

  const data = doc.data()!
  if (data.orgId && data.orgId !== orgId) return apiError('Post not found', 404)

  await adminDb.collection('social_posts').doc(id).update({
    status: 'cancelled',
    updatedAt: FieldValue.serverTimestamp(),
  })

  // Cancel queue entry if exists
  const queueDoc = await adminDb.collection('social_queue').doc(id).get()
  if (queueDoc.exists) {
    await adminDb.collection('social_queue').doc(id).update({
      status: 'cancelled',
    })
  }

  await logAudit({
    orgId,
    action: 'post.cancelled',
    entityType: 'post',
    entityId: id,
    performedBy: user.uid,
    performedByRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    ip: req.headers.get('x-forwarded-for'),
  })

  return apiSuccess({ id })
}))
