/**
 * POST /api/v1/admin/system/storage/override   (super-admin)
 *
 * Write / clear a per-org storage limit override at
 * `storage_overrides/{orgId}`. Body `{ orgId, limitBytes (number|null), confirm }`
 * where `confirm` must equal the orgId. A null `limitBytes` clears the limit.
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

const COLLECTION = 'storage_overrides'

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  if (!isSuperAdmin(user)) return apiError('Super admin only', 403)

  let body: { orgId?: unknown; limitBytes?: unknown; confirm?: unknown }
  try {
    body = (await req.json()) as { orgId?: unknown; limitBytes?: unknown; confirm?: unknown }
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const orgId = typeof body.orgId === 'string' ? body.orgId : ''
  if (!orgId) return apiError('orgId required', 400)

  const confirm = typeof body.confirm === 'string' ? body.confirm : ''
  if (confirm !== orgId) return apiError('confirm must equal orgId', 400)

  let limitBytes: number | null
  if (body.limitBytes === null || body.limitBytes === undefined) {
    limitBytes = null
  } else if (typeof body.limitBytes === 'number' && Number.isFinite(body.limitBytes) && body.limitBytes > 0) {
    limitBytes = Math.floor(body.limitBytes)
  } else {
    return apiError('limitBytes must be a positive number or null', 400)
  }

  await adminDb.collection(COLLECTION).doc(orgId).set(
    {
      orgId,
      limitBytes,
      updatedBy: user.uid ?? 'admin',
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )

  return apiSuccess({ orgId, limitBytes })
})
