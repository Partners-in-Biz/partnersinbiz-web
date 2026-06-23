/**
 * GET    /api/v1/admin/email/suppressions?orgId=&q=  — list suppressions for an
 *          org (admin can target any org). Optional substring filter `q`.
 * DELETE /api/v1/admin/email/suppressions             — remove a suppression.
 *          Body: { orgId, email, channel? }
 *
 * Reuses the canonical suppression helpers in lib/email/suppressions (no
 * duplicate collection). Also clears the soft-bounce tracking counter on
 * removal so a fresh series of soft bounces starts from zero — matching the
 * documented admin-override behaviour in lib/email/bounceTracking.
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  removeSuppression,
  normalizeEmail,
  type SuppressionChannel,
} from '@/lib/email/suppressions'
import { clearSoftBounceTracking } from '@/lib/email/bounceTracking'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req: NextRequest) => {
  const { searchParams } = new URL(req.url)
  const orgId = (searchParams.get('orgId') ?? '').trim()
  const q = (searchParams.get('q') ?? '').trim().toLowerCase()
  if (!orgId) return apiError('orgId is required')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = adminDb.collection('suppressions').where('orgId', '==', orgId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let snap: any
  try {
    snap = await query.orderBy('createdAt', 'desc').limit(500).get()
  } catch {
    snap = await query.limit(500).get()
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = snap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d: any) => {
      const data = d.data() ?? {}
      return {
        id: d.id,
        email: data.email ?? '',
        channel: data.channel ?? 'email',
        reason: data.reason ?? '',
        scope: data.scope ?? '',
        source: data.source ?? '',
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? null,
        expiresAt: data.expiresAt?.toDate?.()?.toISOString?.() ?? null,
      }
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((r: any) => (q ? String(r.email).toLowerCase().includes(q) : true))

  return apiSuccess(rows, 200, { total: rows.length })
})

export const DELETE = withAuth('admin', async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}))
  const orgId = (typeof body.orgId === 'string' ? body.orgId : '').trim()
  const channel: SuppressionChannel = body.channel === 'sms' ? 'sms' : 'email'
  const address =
    channel === 'email'
      ? normalizeEmail(typeof body.email === 'string' ? body.email : '')
      : (typeof body.email === 'string' ? body.email : '').trim()

  if (!orgId) return apiError('orgId is required')
  if (!address) return apiError('email/address is required')

  const { removed } = await removeSuppression(orgId, address, channel)
  if (channel === 'email' && removed > 0) {
    await clearSoftBounceTracking(orgId, address)
  }
  if (removed === 0) return apiError('No matching suppression found', 404)
  return apiSuccess({ removed, orgId, address, channel })
})
