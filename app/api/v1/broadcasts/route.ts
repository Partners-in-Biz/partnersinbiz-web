/**
 * GET  /api/v1/broadcasts?orgId=...&status=...&limit=...  — list broadcasts
 * POST /api/v1/broadcasts                                 — create a draft broadcast
 *
 * Auth: client (admin/ai satisfy automatically via withAuth).
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withIdempotency } from '@/lib/api/idempotency'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { actorFrom } from '@/lib/api/actor'
import {
  DEFAULT_BROADCAST_AB,
  EMPTY_BROADCAST_STATS,
  type Broadcast,
  type BroadcastStatus,
} from '@/lib/broadcasts/types'
import type { ApiUser } from '@/lib/api/types'
import {
  clientVisibilityFieldsForWrite,
  recordVisibleForWorkScope,
  resolveWorkScopeFromRequest,
  resolveWorkScopeFromSearchParams,
  workScopeFieldsForWrite,
} from '@/lib/work-scope'

export const dynamic = 'force-dynamic'

const VALID_STATUSES: BroadcastStatus[] = [
  'draft',
  'scheduled',
  'sending',
  'sent',
  'paused',
  'failed',
  'canceled',
]

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const scope = resolveOrgScope(user, searchParams.get('orgId'))
  if (!scope.ok) return apiError(scope.error, scope.status)
  const orgId = scope.orgId
  const status = searchParams.get('status')
  const limitParam = searchParams.get('limit')
  const limit = limitParam
    ? Math.max(1, Math.min(500, parseInt(limitParam, 10) || 100))
    : 200
  const workScope = resolveWorkScopeFromSearchParams(searchParams, user.uid)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = adminDb.collection('broadcasts').where('orgId', '==', orgId)
  if (status && VALID_STATUSES.includes(status as BroadcastStatus)) {
    query = query.where('status', '==', status)
  }

  const snap = await query.get()
  const broadcasts = snap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d: any) => ({ id: d.id, ...d.data() }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((b: any) => b.deleted !== true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((b: any) => recordVisibleForWorkScope(b, workScope))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .sort((a: any, b: any) => {
      const ax = a.createdAt?.toMillis?.() ?? 0
      const bx = b.createdAt?.toMillis?.() ?? 0
      return bx - ax
    })
    .slice(0, limit)

  return apiSuccess(broadcasts)
})

export const POST = withAuth(
  'client',
  withIdempotency(async (req: NextRequest, user: ApiUser) => {
    const body = await req.json().catch(() => null)
    if (!body) return apiError('Invalid JSON', 400)

    const requestedOrgId = typeof body.orgId === 'string' ? body.orgId.trim() : null
    const scope = resolveOrgScope(user, requestedOrgId)
    if (!scope.ok) return apiError(scope.error, scope.status)
    const orgId = scope.orgId

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return apiError('name is required', 400)

    const incomingAudience = (body.audience ?? {}) as Partial<Broadcast['audience']>
    const incomingContent = (body.content ?? {}) as Partial<Broadcast['content']>

    const doc: Omit<Broadcast, 'id'> = {
      orgId,
      name,
      description: typeof body.description === 'string' ? body.description : '',
      status: 'draft',
      fromDomainId: typeof body.fromDomainId === 'string' ? body.fromDomainId : '',
      fromName: typeof body.fromName === 'string' ? body.fromName : '',
      fromLocal: typeof body.fromLocal === 'string' ? body.fromLocal : 'broadcasts',
      replyTo: typeof body.replyTo === 'string' ? body.replyTo : '',
      content: {
        templateId: typeof incomingContent.templateId === 'string' ? incomingContent.templateId : '',
        subject: typeof incomingContent.subject === 'string' ? incomingContent.subject : '',
        preheader: typeof incomingContent.preheader === 'string' ? incomingContent.preheader : '',
        bodyHtml: typeof incomingContent.bodyHtml === 'string' ? incomingContent.bodyHtml : '',
        bodyText: typeof incomingContent.bodyText === 'string' ? incomingContent.bodyText : '',
      },
      audience: {
        segmentId: typeof incomingAudience.segmentId === 'string' ? incomingAudience.segmentId : '',
        contactIds: Array.isArray(incomingAudience.contactIds)
          ? (incomingAudience.contactIds as string[]).filter((x) => typeof x === 'string')
          : [],
        tags: Array.isArray(incomingAudience.tags)
          ? (incomingAudience.tags as string[]).filter((x) => typeof x === 'string')
          : [],
        excludeUnsubscribed: incomingAudience.excludeUnsubscribed !== false,
        excludeBouncedAt: incomingAudience.excludeBouncedAt !== false,
      },
      scheduledFor: null,
      sendStartedAt: null,
      sendCompletedAt: null,
      stats: { ...EMPTY_BROADCAST_STATS },
      ab: { ...DEFAULT_BROADCAST_AB },
      topicId:
        typeof body.topicId === 'string' && body.topicId.trim()
          ? body.topicId.trim()
          : 'newsletter',
      // FieldValue placeholders — replaced server-side.
      createdAt: null,
      updatedAt: null,
      ...actorFrom(user),
      deleted: false,
    }

    const ref = await adminDb.collection('broadcasts').add({
      ...doc,
      ...workScopeFieldsForWrite(resolveWorkScopeFromRequest({ searchParams: new URL(req.url).searchParams, body, uid: user.uid })),
      ...clientVisibilityFieldsForWrite(body.clientVisibility),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    return apiSuccess({ id: ref.id, orgId, status: 'draft' as BroadcastStatus }, 201)
  }),
)
