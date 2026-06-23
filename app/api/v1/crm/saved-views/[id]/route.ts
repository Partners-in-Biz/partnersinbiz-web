/**
 * PATCH  /api/v1/crm/saved-views/:id  — rename / update a saved view's filters
 * DELETE /api/v1/crm/saved-views/:id  — delete a saved view
 *
 * Auth: member+
 * Only the owning user (uid match) within the same org may edit or delete.
 * Returns 404 for not-found, wrong-org, or wrong-owner — never reveals existence.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'

type RouteCtx = { params: Promise<{ id: string }> }

export const PATCH = withCrmAuth<RouteCtx>('member', async (req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const update: Record<string, unknown> = {}
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return apiError('name cannot be empty', 400)
    update.name = name
  }
  if (body.filters !== undefined) {
    if (!body.filters || typeof body.filters !== 'object' || Array.isArray(body.filters)) {
      return apiError('filters must be an object', 400)
    }
    update.filters = body.filters as Record<string, unknown>
  }
  if (Object.keys(update).length === 0) {
    return apiError('Provide name and/or filters to update', 400)
  }

  const docRef = adminDb.collection('saved_views').doc(id)
  const snap = await docRef.get()

  if (!snap.exists) return apiError('Saved view not found', 404)

  const data = snap.data()!
  // Verify ownership + org scoping — return 404 to avoid revealing existence
  if (data.orgId !== ctx.orgId || data.uid !== ctx.actor.uid) {
    return apiError('Saved view not found', 404)
  }

  update.updatedAt = FieldValue.serverTimestamp()
  await docRef.set(update, { merge: true })
  return apiSuccess({ id })
})

export const DELETE = withCrmAuth<RouteCtx>('member', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params
  const docRef = adminDb.collection('saved_views').doc(id)
  const snap = await docRef.get()

  if (!snap.exists) return apiError('Saved view not found', 404)

  const data = snap.data()!
  // Verify ownership + org scoping — return 404 to avoid revealing existence
  if (data.orgId !== ctx.orgId || data.uid !== ctx.actor.uid) {
    return apiError('Saved view not found', 404)
  }

  await docRef.delete()
  return apiSuccess({ id })
})
