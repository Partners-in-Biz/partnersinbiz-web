/**
 * GET  /api/v1/crm/saved-views?resourceKind=contacts  — list the caller's saved views
 * POST /api/v1/crm/saved-views                        — create a saved view
 *
 * Auth: GET → viewer+, POST → member+
 * Scoped to: ctx.orgId + ctx.actor.uid (per-user only)
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'

type SavedViewListItem = {
  id: string
  orgId?: string
  uid?: string
  resourceKind?: string
  createdAt?: unknown
  [key: string]: unknown
}

function timestampMillis(value: unknown): number {
  if (!value) return 0
  if (typeof value === 'object' && value !== null) {
    const candidate = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number }
    if (typeof candidate.toMillis === 'function') return candidate.toMillis()
    if (typeof candidate.toDate === 'function') return candidate.toDate().getTime()
    if (typeof candidate.seconds === 'number') return candidate.seconds * 1000
  }
  return 0
}

export const GET = withCrmAuth('viewer', async (req, ctx) => {
  const { searchParams } = new URL(req.url)
  const resourceKind = (searchParams.get('resourceKind') ?? 'contacts').trim()
  const { orgId } = ctx
  const uid = ctx.actor.uid

  try {
    const snapshot = await adminDb
      .collection('saved_views')
      .where('orgId', '==', orgId)
      .get()

    const views: SavedViewListItem[] = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }) as SavedViewListItem)
      .filter((view) => view.orgId === orgId && view.uid === uid && view.resourceKind === resourceKind)
      .sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt))
    return apiSuccess({ views })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const POST = withCrmAuth('member', async (req, ctx) => {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return apiError('name is required', 400)

  const resourceKind =
    typeof body.resourceKind === 'string' && body.resourceKind.trim()
      ? body.resourceKind.trim()
      : 'contacts'

  const filters =
    body.filters && typeof body.filters === 'object' && !Array.isArray(body.filters)
      ? (body.filters as Record<string, unknown>)
      : {}

  const { orgId } = ctx
  const uid = ctx.actor.uid

  const docRef = adminDb.collection('saved_views').doc()
  await docRef.set({
    orgId,
    uid,
    resourceKind,
    name,
    filters,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return apiSuccess({ id: docRef.id }, 201)
})
