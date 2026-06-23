/**
 * POST   /api/v1/admin/system/rate-limits/override   (super-admin)
 * DELETE /api/v1/admin/system/rate-limits/override?orgId=  (super-admin)
 *
 * Write / clear a temporary per-org rate-limit override doc at
 * `rate_limit_overrides/{orgId}`. The doc carries an optional bumped `limit`,
 * a `disabled` flag (rate limiting fully off for the org), and an `expiresAt`
 * after which it should be ignored. Enforcement code can read this doc to apply
 * the override; this route owns creating/clearing it.
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

const COLLECTION = 'rate_limit_overrides'

interface OverrideBody {
  orgId: string
  limit?: number
  disabled?: boolean
  ttlMinutes?: number
  note?: string
}

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  if (!isSuperAdmin(user)) return apiError('Super admin only', 403)

  let body: OverrideBody
  try {
    body = (await req.json()) as OverrideBody
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  if (!body.orgId || typeof body.orgId !== 'string') return apiError('orgId required', 400)

  const disabled = Boolean(body.disabled)
  const limit = typeof body.limit === 'number' && body.limit > 0 ? Math.floor(body.limit) : null
  if (!disabled && limit === null) {
    return apiError('Provide a positive limit, or set disabled=true', 400)
  }

  const ttlMinutes = typeof body.ttlMinutes === 'number' && body.ttlMinutes > 0 ? Math.floor(body.ttlMinutes) : 60
  const expiresAtMs = Date.now() + ttlMinutes * 60 * 1000

  await adminDb.collection(COLLECTION).doc(body.orgId).set({
    orgId: body.orgId,
    limit,
    disabled,
    note: body.note ?? '',
    expiresAt: expiresAtMs,
    createdBy: user.uid ?? 'admin',
    createdAt: FieldValue.serverTimestamp(),
  })

  return apiSuccess({ orgId: body.orgId, limit, disabled, expiresAtMs, ttlMinutes })
})

export const DELETE = withAuth('admin', async (req: NextRequest, user) => {
  if (!isSuperAdmin(user)) return apiError('Super admin only', 403)
  const orgId = new URL(req.url).searchParams.get('orgId')?.trim()
  if (!orgId) return apiError('orgId query param required', 400)
  await adminDb.collection(COLLECTION).doc(orgId).delete()
  return apiSuccess({ cleared: orgId })
})
