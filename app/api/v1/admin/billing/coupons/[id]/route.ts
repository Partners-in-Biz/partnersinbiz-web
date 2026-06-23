/**
 * GET    /api/v1/admin/billing/coupons/[id]  — fetch one coupon.
 * PATCH  /api/v1/admin/billing/coupons/[id]  — toggle active / edit value, expiry, plan scope.
 * DELETE /api/v1/admin/billing/coupons/[id]  — delete a coupon.
 *
 * Manual EFT/PayPal discount codes — NOT Stripe coupons.
 */
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import type { Coupon, CouponType, CouponDuration } from '@/lib/billing/types'

export const dynamic = 'force-dynamic'

const COLLECTION = 'coupons'

const COUPON_TYPES: CouponType[] = ['percent', 'fixed']
const COUPON_DURATIONS: CouponDuration[] = ['once', 'repeating', 'forever']

type RouteContext = { params: Promise<{ id: string }> }

function normalizePlanKeys(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
}

export const GET = withAuth('admin', async (_req, _user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const doc = await adminDb.collection(COLLECTION).doc(id).get()
  if (!doc.exists) return apiError('Coupon not found', 404)
  return apiSuccess({ id: doc.id, ...(doc.data() as Omit<Coupon, 'id'>) })
})

export const PATCH = withAuth('admin', async (req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const ref = adminDb.collection(COLLECTION).doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Coupon not found', 404)

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return apiError('Invalid JSON body', 400)

  const current = doc.data() as Coupon
  const update: Record<string, unknown> = { ...lastActorFrom(user) }

  if (body.active !== undefined) update.active = Boolean(body.active)

  if (body.type !== undefined) {
    if (!COUPON_TYPES.includes(body.type as CouponType)) {
      return apiError(`type must be one of: ${COUPON_TYPES.join(', ')}`, 400)
    }
    update.type = body.type
  }

  if (body.value !== undefined) {
    const value = Number(body.value)
    if (!Number.isFinite(value) || value <= 0) {
      return apiError('value must be a number greater than 0', 400)
    }
    const effectiveType = (update.type ?? current.type) as CouponType
    if (effectiveType === 'percent' && value > 100) {
      return apiError('percent value cannot exceed 100', 400)
    }
    update.value = value
  }

  if (body.duration !== undefined) {
    if (!COUPON_DURATIONS.includes(body.duration as CouponDuration)) {
      return apiError(`duration must be one of: ${COUPON_DURATIONS.join(', ')}`, 400)
    }
    update.duration = body.duration
  }

  if (body.durationMonths !== undefined) {
    const durationMonths = Number(body.durationMonths)
    update.durationMonths =
      Number.isFinite(durationMonths) && durationMonths > 0 ? durationMonths : null
  }

  if (body.maxRedemptions !== undefined) {
    const maxRedemptions = Number(body.maxRedemptions)
    update.maxRedemptions =
      Number.isFinite(maxRedemptions) && maxRedemptions > 0 ? maxRedemptions : null
  }

  if (body.expiresAt !== undefined) {
    if (body.expiresAt === null || body.expiresAt === '') {
      update.expiresAt = null
    } else {
      const ms = Date.parse(String(body.expiresAt))
      update.expiresAt = Number.isFinite(ms) ? new Date(ms) : null
    }
  }

  if (body.appliesToPlanKeys !== undefined) {
    update.appliesToPlanKeys = normalizePlanKeys(body.appliesToPlanKeys)
  }

  if (body.notes !== undefined) {
    update.notes = typeof body.notes === 'string' ? body.notes.trim() : ''
  }

  await ref.update(update)
  const updated = await ref.get()
  return apiSuccess({ id: updated.id, ...(updated.data() as Omit<Coupon, 'id'>) })
})

export const DELETE = withAuth('admin', async (_req, _user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const ref = adminDb.collection(COLLECTION).doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Coupon not found', 404)
  await ref.delete()
  return apiSuccess({ id, deleted: true })
})
