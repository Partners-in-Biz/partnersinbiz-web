/**
 * GET /api/v1/admin/billing/coupons/[id]/usage — redemption history for a coupon.
 *
 * Loads the coupon, then queries `coupon_redemptions` where couponCode == coupon.code,
 * joins the org name from `organizations`, and returns redemptions sorted desc by
 * createdAt. Manual EFT/PayPal discount codes — NOT Stripe.
 */
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { tsToMillis } from '@/lib/billing/format'
import type { Coupon, CouponRedemption } from '@/lib/billing/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

interface UsageRow {
  id: string
  orgId: string
  orgName: string
  invoiceId: string | null
  discountZar: number
  redeemedBy: string
  createdAt: number | null
}

export const GET = withAuth('admin', async (_req, _user, ctx) => {
  const { id } = await (ctx as RouteContext).params

  const couponDoc = await adminDb.collection('coupons').doc(id).get()
  if (!couponDoc.exists) return apiError('Coupon not found', 404)
  const coupon = couponDoc.data() as Coupon

  const snap = await adminDb
    .collection('coupon_redemptions')
    .where('couponCode', '==', coupon.code)
    .get()

  const redemptions = snap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<CouponRedemption, 'id'>),
  }))

  // Resolve org names in one batch (dedupe org ids).
  const orgIds = Array.from(new Set(redemptions.map((r) => r.orgId).filter(Boolean)))
  const orgNames = new Map<string, string>()
  await Promise.all(
    orgIds.map(async (orgId) => {
      try {
        const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
        if (orgDoc.exists) {
          const data = orgDoc.data() as { name?: string }
          orgNames.set(orgId, data?.name ?? orgId)
        }
      } catch {
        /* leave unresolved — falls back to org id below */
      }
    }),
  )

  const rows: UsageRow[] = redemptions
    .map((r) => ({
      id: r.id,
      orgId: r.orgId,
      orgName: orgNames.get(r.orgId) ?? r.orgId,
      invoiceId: r.invoiceId ?? null,
      discountZar: Number(r.discountZar) || 0,
      redeemedBy: r.redeemedBy ?? '',
      createdAt: tsToMillis(r.createdAt),
    }))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))

  return apiSuccess(rows)
})
