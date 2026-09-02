/**
 * GET    /api/v1/broadcasts/[id] — fetch a broadcast
 * PUT    /api/v1/broadcasts/[id] — update editable fields (draft/paused/scheduled only)
 * DELETE /api/v1/broadcasts/[id] — soft-delete (also flips scheduled → canceled)
 *
 * Auth: client.
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import type { Broadcast, BroadcastStatus } from '@/lib/broadcasts/types'
import type { ApiUser } from '@/lib/api/types'
import { invalidatedEmailApprovalState } from '@/lib/email-marketing/agent-governance'
import { clientVisibilityFieldsForWrite } from '@/lib/work-scope'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const EDITABLE_STATUSES: BroadcastStatus[] = ['draft', 'paused', 'scheduled']

export const GET = withAuth('client', async (_req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  const snap = await adminDb.collection('broadcasts').doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Broadcast not found', 404)
  const scope = resolveOrgScope(user, (snap.data()?.orgId as string | undefined) ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)
  return apiSuccess({ id: snap.id, ...snap.data() } as Broadcast)
})

export const PUT = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  const body = await req.json().catch(() => null)
  if (!body) return apiError('Invalid JSON', 400)

  const snap = await adminDb.collection('broadcasts').doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Broadcast not found', 404)
  const current = snap.data() as Broadcast
  const scope = resolveOrgScope(user, current.orgId ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  if (!EDITABLE_STATUSES.includes(current.status)) {
    return apiError(`Cannot edit a broadcast with status=${current.status}`, 422)
  }

  const update: Record<string, unknown> = {}
  if (typeof body.name === 'string') update.name = body.name.trim()
  if (typeof body.description === 'string') update.description = body.description
  if (typeof body.fromDomainId === 'string') update.fromDomainId = body.fromDomainId
  if (typeof body.fromName === 'string') update.fromName = body.fromName
  if (typeof body.fromLocal === 'string') update.fromLocal = body.fromLocal
  if (typeof body.replyTo === 'string') update.replyTo = body.replyTo
  if ('clientVisibility' in body) Object.assign(update, clientVisibilityFieldsForWrite(body.clientVisibility))

  if (body.content && typeof body.content === 'object') {
    const c = body.content as Partial<Broadcast['content']>
    update.content = {
      templateId: typeof c.templateId === 'string' ? c.templateId : current.content?.templateId ?? '',
      subject: typeof c.subject === 'string' ? c.subject : current.content?.subject ?? '',
      preheader: typeof c.preheader === 'string' ? c.preheader : current.content?.preheader ?? '',
      bodyHtml: typeof c.bodyHtml === 'string' ? c.bodyHtml : current.content?.bodyHtml ?? '',
      bodyText: typeof c.bodyText === 'string' ? c.bodyText : current.content?.bodyText ?? '',
    }
  }

  if (typeof body.audienceLocalDelivery === 'boolean') {
    update.audienceLocalDelivery = body.audienceLocalDelivery
  }
  if (typeof body.localDeliveryWindowHours === 'number') {
    update.localDeliveryWindowHours = Math.max(
      1,
      Math.min(168, Math.floor(body.localDeliveryWindowHours)),
    )
  }

  if (body.audience && typeof body.audience === 'object') {
    const a = body.audience as Partial<Broadcast['audience']>
    update.audience = {
      segmentId: typeof a.segmentId === 'string' ? a.segmentId : current.audience?.segmentId ?? '',
      contactIds: Array.isArray(a.contactIds)
        ? (a.contactIds as string[]).filter((x) => typeof x === 'string')
        : current.audience?.contactIds ?? [],
      tags: Array.isArray(a.tags)
        ? (a.tags as string[]).filter((x) => typeof x === 'string')
        : current.audience?.tags ?? [],
      excludeUnsubscribed:
        typeof a.excludeUnsubscribed === 'boolean'
          ? a.excludeUnsubscribed
          : current.audience?.excludeUnsubscribed ?? true,
      excludeBouncedAt:
        typeof a.excludeBouncedAt === 'boolean'
          ? a.excludeBouncedAt
          : current.audience?.excludeBouncedAt ?? true,
    }
  }

  const materialFields = ['content', 'audience', 'fromDomainId', 'fromName', 'fromLocal', 'replyTo']
  if (current.approvalState?.status === 'approved' && materialFields.some((field) => Object.prototype.hasOwnProperty.call(update, field))) {
    update.approvalState = invalidatedEmailApprovalState('Material broadcast content, audience, or sender settings changed')
  }

  await snap.ref.update({ ...update, ...lastActorFrom(user) })
  return apiSuccess({ id })
})

export const DELETE = withAuth('client', async (_req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  const snap = await adminDb.collection('broadcasts').doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Broadcast not found', 404)
  const current = snap.data() as Broadcast
  const scope = resolveOrgScope(user, current.orgId ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const update: Record<string, unknown> = {
    deleted: true,
    updatedAt: FieldValue.serverTimestamp(),
  }
  // Cancel any pending send so the cron doesn't pick it up.
  if (current.status === 'scheduled' || current.status === 'paused') {
    update.status = 'canceled'
  }
  await snap.ref.update(update)
  return apiSuccess({ id })
})
