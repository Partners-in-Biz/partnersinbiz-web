/**
 * GET   /api/v1/admin/legal/gdpr/[id]  — fetch one DSR
 * PATCH /api/v1/admin/legal/gdpr/[id]  — update status/notes; appends an immutable log entry
 *
 * Log entries are append-only (3-year retention policy) — we never remove them.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { ApiUser } from '@/lib/api/types'
import { serializeGovernance, cleanStr, actorOf } from '@/lib/governance/firestore'

export const dynamic = 'force-dynamic'

const COLLECTION = 'gdpr_requests'
const VALID_STATUS = ['open', 'in_progress', 'completed', 'rejected']
type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAuth('admin', async (_req: NextRequest, _user: ApiUser, ctx: RouteContext) => {
  try {
    const { id } = await ctx.params
    const snap = await adminDb.collection(COLLECTION).doc(id).get()
    if (!snap.exists) return apiError('DSR not found', 404)
    return apiSuccess({ request: serializeGovernance({ id: snap.id, ...snap.data() }) })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const PATCH = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  try {
    const { id } = await ctx.params
    const ref = adminDb.collection(COLLECTION).doc(id)
    const snap = await ref.get()
    if (!snap.exists) return apiError('DSR not found', 404)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)
    const b = body as Record<string, unknown>

    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }
    const logParts: string[] = []

    if (typeof b.status === 'string') {
      const status = cleanStr(b.status, 30)
      if (!VALID_STATUS.includes(status)) return apiError(`status must be one of ${VALID_STATUS.join(', ')}`, 400)
      update.status = status
      logParts.push(`status -> ${status}`)
      if (status === 'completed') {
        update.completedAt = FieldValue.serverTimestamp()
        update.handledBy = actorOf(user)
      }
    }
    if (typeof b.notes === 'string') {
      update.notes = cleanStr(b.notes, 5000)
      logParts.push('notes updated')
    }

    if (logParts.length === 0) return apiError('Nothing to update', 400)

    // Append an immutable log entry (never overwrite the array — arrayUnion add).
    const logEntry = {
      at: new Date().toISOString(),
      actor: actorOf(user),
      action: 'update',
      detail: logParts.join('; '),
    }
    update.log = FieldValue.arrayUnion(logEntry)

    await ref.update(update)
    const saved = await ref.get()
    return apiSuccess({ request: serializeGovernance({ id, ...saved.data() }) })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
