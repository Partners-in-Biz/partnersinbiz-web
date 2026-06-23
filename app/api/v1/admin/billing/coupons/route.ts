/**
 * GET  /api/v1/admin/billing/coupons  — list all coupons.
 * POST /api/v1/admin/billing/coupons  — create a coupon.
 *
 * IMPORTANT: These are MANUAL EFT/PayPal discount codes applied to invoices
 * in the platform's own invoice system. They are NOT Stripe coupons — there
 * is no Stripe integration. The discount is applied when an operator/agent
 * raises an EFT or PayPal invoice for an org.
 */
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { actorFrom } from '@/lib/api/actor'
import type { Coupon, CouponType, CouponDuration } from '@/lib/billing/types'

export const dynamic = 'force-dynamic'

const COLLECTION = 'coupons'

const COUPON_TYPES: CouponType[] = ['percent', 'fixed']
const COUPON_DURATIONS: CouponDuration[] = ['once', 'repeating', 'forever']

function normalizePlanKeys(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
}

export const GET = withAuth('admin', async () => {
  const snap = await adminDb.collection(COLLECTION).get()
  const coupons: Coupon[] = snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Coupon, 'id'>) }))
    .sort((a, b) => (a.code ?? '').localeCompare(b.code ?? ''))
  return apiSuccess(coupons)
})

export const POST = withAuth('admin', async (req, user) => {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return apiError('Invalid JSON body', 400)

  // Codes are stored uppercase + trimmed for case-insensitive matching.
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : ''
  const type = body.type as CouponType
  const value = Number(body.value)
  const duration = body.duration as CouponDuration

  if (!code) return apiError('Coupon code is required', 400)
  if (!/^[A-Z0-9_-]+$/.test(code)) {
    return apiError('Coupon code may only contain letters, numbers, hyphens and underscores', 400)
  }
  if (!COUPON_TYPES.includes(type)) {
    return apiError(`type must be one of: ${COUPON_TYPES.join(', ')}`, 400)
  }
  if (!Number.isFinite(value) || value <= 0) {
    return apiError('value must be a number greater than 0', 400)
  }
  if (type === 'percent' && value > 100) {
    return apiError('percent value cannot exceed 100', 400)
  }
  if (!COUPON_DURATIONS.includes(duration)) {
    return apiError(`duration must be one of: ${COUPON_DURATIONS.join(', ')}`, 400)
  }

  // Enforce unique code.
  const existing = await adminDb.collection(COLLECTION).where('code', '==', code).limit(1).get()
  if (!existing.empty) {
    return apiError(`A coupon with code "${code}" already exists`, 409)
  }

  const actor = actorFrom(user)
  const maxRedemptions = Number(body.maxRedemptions)
  const durationMonths = Number(body.durationMonths)
  const expiresAtMs = body.expiresAt ? Date.parse(String(body.expiresAt)) : NaN

  const doc: Record<string, unknown> = {
    code,
    type,
    value,
    duration,
    active: body.active === undefined ? true : Boolean(body.active),
    redemptions: 0,
    appliesToPlanKeys: normalizePlanKeys(body.appliesToPlanKeys),
    notes: typeof body.notes === 'string' ? body.notes.trim() : '',
    ...actor,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }
  // Never write undefined — omit or coerce to null.
  doc.maxRedemptions = Number.isFinite(maxRedemptions) && maxRedemptions > 0 ? maxRedemptions : null
  doc.durationMonths =
    duration === 'repeating' && Number.isFinite(durationMonths) && durationMonths > 0
      ? durationMonths
      : null
  doc.expiresAt = Number.isFinite(expiresAtMs) ? new Date(expiresAtMs) : null

  const ref = await adminDb.collection(COLLECTION).add(doc)
  const created = await ref.get()
  return apiSuccess({ id: ref.id, ...(created.data() as Omit<Coupon, 'id'>) }, 201)
})
