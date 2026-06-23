/**
 * PATCH /api/v1/admin/system/logs/[id]
 *
 * Resolve or assign an error event (US-267). Super-admin only.
 *   body: { action: 'resolve' }                       → sets resolvedAt = now
 *   body: { action: 'unresolve' }                     → clears resolvedAt
 *   body: { action: 'assign', assignedTo: <uid|null> } → sets assignedTo
 *
 * Auth: super-admin.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { ERROR_EVENTS_COLLECTION } from '@/lib/observability/error-log'
import { FieldValue } from 'firebase-admin/firestore'

export const dynamic = 'force-dynamic'

export const PATCH = withAuth(
  'admin',
  async (
    req: NextRequest,
    user,
    context?: { params?: Promise<{ id?: string }> | { id?: string } },
  ) => {
    if (!isSuperAdmin(user)) return apiError('Super admin only', 403)

    const params = context?.params ? await context.params : {}
    const id = (params as { id?: string }).id
    if (!id) return apiError('Missing event id', 400)

    let body: { action?: string; assignedTo?: string | null }
    try {
      body = await req.json()
    } catch {
      return apiError('Invalid JSON body', 400)
    }

    const ref = adminDb.collection(ERROR_EVENTS_COLLECTION).doc(id)
    const snap = await ref.get()
    if (!snap.exists) return apiError('Error event not found', 404)

    switch (body.action) {
      case 'resolve':
        await ref.update({ resolvedAt: FieldValue.serverTimestamp(), resolvedBy: user.uid })
        break
      case 'unresolve':
        await ref.update({ resolvedAt: null, resolvedBy: null })
        break
      case 'assign':
        await ref.update({ assignedTo: body.assignedTo ?? null })
        break
      default:
        return apiError('action must be one of: resolve, unresolve, assign', 400)
    }

    const updated = await ref.get()
    const data = updated.data() ?? {}
    return apiSuccess({
      id,
      resolvedAt:
        data.resolvedAt && typeof data.resolvedAt.toMillis === 'function'
          ? data.resolvedAt.toMillis()
          : null,
      assignedTo: data.assignedTo ?? null,
    })
  },
)
