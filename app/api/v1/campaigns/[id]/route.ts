/**
 * GET    /api/v1/campaigns/[id]  — fetch a campaign
 * PUT    /api/v1/campaigns/[id]  — update editable fields (only when draft/paused)
 * DELETE /api/v1/campaigns/[id]  — soft-delete
 *
 * Auth: admin
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import type { Campaign } from '@/lib/campaigns/types'
import type { ApiUser } from '@/lib/api/types'
import { logActivity } from '@/lib/activity/log'
import {
  normalizeResourceRelationshipLinks,
} from '@/lib/client-documents/linkedValidation'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

// Allow-list for the content-engine campaign PATCH. Email-program campaigns
// continue to use PUT above. PATCH is used by the content-engine review UI.
const CONTENT_PATCH_FIELDS = [
  'name',
  'status',
  'research',
  'brandIdentity',
  'pillars',
  'calendar',
  'shareEnabled',
] as const

function relationshipInputFrom(body: Record<string, unknown>) {
  const value: Record<string, unknown> = {}
  const safeStringFields = ['companyId', 'clientOrgId', 'projectId', 'dealId']
  const safeArrayFields = [
    'companyIds',
    'clientOrgIds',
    'projectIds',
    'dealIds',
    'researchItemIds',
    'socialPostIds',
    'emailThreadIds',
    'supportTicketIds',
  ]
  for (const key of safeStringFields) {
    if (key in body) value[key] = body[key]
  }
  for (const key of safeArrayFields) {
    if (key in body) value[key] = body[key]
  }
  if ('contextRefs' in body) value.contextRefs = body.contextRefs
  return Object.keys(value).length > 0 ? value : undefined
}

export const GET = withAuth('client', async (_req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  const snap = await adminDb.collection('campaigns').doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Campaign not found', 404)
  const scope = resolveOrgScope(user, (snap.data()?.orgId as string | undefined) ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)
  const campaign = { id: snap.id, ...snap.data() } as Campaign
  return apiSuccess(campaign)
})

export const PUT = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  const body = await req.json().catch(() => null)
  if (!body) return apiError('Invalid JSON', 400)

  const snap = await adminDb.collection('campaigns').doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Campaign not found', 404)
  const current = snap.data() as Campaign
  const scope = resolveOrgScope(user, current.orgId ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  // Active campaigns are read-only except for status transitions handled
  // by the launch/pause endpoints. Avoid drift by rejecting edits here.
  if (current.status === 'active' || current.status === 'completed') {
    return apiError(`Cannot edit a campaign with status=${current.status}`, 422)
  }

  // Email-builder fields (subject, previewText, emailDocument, exclusion list,
  // recipient tag) are stored on the campaign doc but are not yet part of the
  // strict Campaign type — see lib/campaigns/types.ts. They are persisted here
  // alongside the typed editable fields.
  const editable: Record<string, unknown> = {}
  if (typeof body.name === 'string') editable.name = body.name.trim()
  if (typeof body.description === 'string') editable.description = body.description
  if (typeof body.subject === 'string') editable.subject = body.subject
  if (typeof body.previewText === 'string') editable.previewText = body.previewText
  if (body.emailDocument && typeof body.emailDocument === 'object') {
    editable.emailDocument = body.emailDocument
  }
  if (typeof body.fromDomainId === 'string') editable.fromDomainId = body.fromDomainId
  if (typeof body.fromName === 'string') editable.fromName = body.fromName
  if (typeof body.fromLocal === 'string') editable.fromLocal = body.fromLocal
  if (typeof body.replyTo === 'string') editable.replyTo = body.replyTo
  if (typeof body.segmentId === 'string') editable.segmentId = body.segmentId
  if (typeof body.tagId === 'string') editable.tagId = body.tagId
  if (Array.isArray(body.contactIds)) editable.contactIds = body.contactIds
  if (Array.isArray(body.exclusionContactIds)) {
    editable.exclusionContactIds = body.exclusionContactIds.filter(
      (v: unknown): v is string => typeof v === 'string',
    )
  }
  if (typeof body.sequenceId === 'string') {
    if (body.sequenceId) {
      const seqSnap = await adminDb.collection('sequences').doc(body.sequenceId).get()
      if (!seqSnap.exists) return apiError('sequenceId not found', 400)
      if (seqSnap.data()?.orgId !== current.orgId) {
        return apiError('sequenceId belongs to a different organisation', 403)
      }
    }
    editable.sequenceId = body.sequenceId
  }
  if (body.triggers && typeof body.triggers === 'object') {
    editable.triggers = {
      captureSourceIds: Array.isArray(body.triggers.captureSourceIds) ? body.triggers.captureSourceIds : [],
      tags: Array.isArray(body.triggers.tags) ? body.triggers.tags : [],
    }
  }

  const relationshipInput = relationshipInputFrom(body as Record<string, unknown>)
  if (relationshipInput) {
    const relationships = normalizeResourceRelationshipLinks(relationshipInput)
    if (!relationships.ok) return apiError(relationships.error, 400)
    Object.assign(editable, relationships.value)
  }

  await snap.ref.update({
    ...editable,
    updatedAt: FieldValue.serverTimestamp(),
  })
  return apiSuccess({ id })
})

export const PATCH = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  const body = await req.json().catch(() => null)
  if (!body) return apiError('Invalid JSON', 400)

  const ref = adminDb.collection('campaigns').doc(id)
  const snap = await ref.get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Campaign not found', 404)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const current = snap.data() as any
  const scope = resolveOrgScope(user, (current.orgId as string | undefined) ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const update: Record<string, unknown> = { ...lastActorFrom(user) }
  for (const k of CONTENT_PATCH_FIELDS) {
    if (k in body) update[k] = body[k]
  }
  const relationshipInput = relationshipInputFrom(body as Record<string, unknown>)
  if (relationshipInput) {
    const relationships = normalizeResourceRelationshipLinks(relationshipInput)
    if (!relationships.ok) return apiError(relationships.error, 400)
    Object.assign(update, relationships.value)
  }
  if (Object.keys(update).length === 1) {
    return apiError('No allowed fields to update', 400)
  }
  await ref.update(update)

  logActivity({
    orgId: current.orgId,
    type: 'campaign_updated',
    actorId: user.uid,
    actorName: user.uid,
    actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    description: 'Updated campaign',
    entityId: id,
    entityType: 'campaign',
    entityTitle: current.name ?? undefined,
  }).catch(() => {})

  return apiSuccess({ id, updated: Object.keys(update) })
})

export const DELETE = withAuth('client', async (_req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  const snap = await adminDb.collection('campaigns').doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Campaign not found', 404)
  const scope = resolveOrgScope(user, (snap.data()?.orgId as string | undefined) ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)
  await snap.ref.update({ deleted: true, updatedAt: FieldValue.serverTimestamp() })

  logActivity({
    orgId: (snap.data()?.orgId as string | undefined) ?? '',
    type: 'campaign_deleted',
    actorId: user.uid,
    actorName: user.uid,
    actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    description: 'Deleted campaign',
    entityId: id,
    entityType: 'campaign',
    entityTitle: snap.data()?.name ?? undefined,
  }).catch(() => {})

  return apiSuccess({ id })
})
