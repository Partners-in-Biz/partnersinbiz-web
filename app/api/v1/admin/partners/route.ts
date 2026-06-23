/**
 * GET  /api/v1/admin/partners — list all partner applications + summary.
 * POST /api/v1/admin/partners — create a partner application on an applicant's
 *   behalf (admin intake). Public application intake is a separate route.
 *
 * Partners are the referral / reseller programme. Payouts settle offline via
 * EFT/PayPal — NO Stripe.
 */
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { actorFrom } from '@/lib/api/actor'
import type { PartnerApplication, PayoutSettings } from '@/lib/billing/types'

export const dynamic = 'force-dynamic'

const COLLECTION = 'partner_applications'
const DEFAULT_COMMISSION_PERCENT = 20

function tsMillis(value: unknown): number {
  if (!value) return 0
  if (typeof value === 'object' && value !== null && 'toMillis' in value) {
    try {
      return (value as { toMillis: () => number }).toMillis()
    } catch {
      return 0
    }
  }
  if (typeof value === 'number') return value
  return 0
}

async function loadDefaultCommissionPercent(): Promise<number> {
  try {
    const snap = await adminDb.collection('billing_config').doc('payouts').get()
    if (snap.exists) {
      const data = snap.data() as PayoutSettings
      if (typeof data.defaultCommissionPercent === 'number') {
        return data.defaultCommissionPercent
      }
    }
  } catch {
    // fall through to default
  }
  return DEFAULT_COMMISSION_PERCENT
}

export const GET = withAuth('admin', async () => {
  try {
    const [snap, defaultCommissionPercent] = await Promise.all([
      adminDb.collection(COLLECTION).get(),
      loadDefaultCommissionPercent(),
    ])

    const applications = snap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<PartnerApplication, 'id'>) }))
      .sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt))

    let pendingCount = 0
    let approvedCount = 0
    let totalCommissionZar = 0
    let commissionSum = 0
    let commissionSamples = 0

    for (const app of applications) {
      if (app.status === 'pending') pendingCount += 1
      if (app.status === 'approved') {
        approvedCount += 1
        if (typeof app.commissionPercent === 'number') {
          commissionSum += app.commissionPercent
          commissionSamples += 1
        }
      }
      totalCommissionZar += app.totalCommissionZar ?? 0
    }

    const avgCommissionPercent =
      commissionSamples > 0 ? Math.round((commissionSum / commissionSamples) * 10) / 10 : 0

    return apiSuccess({
      applications,
      summary: {
        pendingCount,
        approvedCount,
        totalCommissionZar,
        avgCommissionPercent,
      },
      defaultCommissionPercent,
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const POST = withAuth('admin', async (req, user) => {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return apiError('Invalid JSON body', 400)

    const companyName = typeof body.companyName === 'string' ? body.companyName.trim() : ''
    const contactName = typeof body.contactName === 'string' ? body.contactName.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim() : ''

    if (!companyName) return apiError('companyName is required', 400)
    if (!contactName) return apiError('contactName is required', 400)
    if (!email) return apiError('email is required', 400)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return apiError('email is not valid', 400)
    }

    const doc: Record<string, unknown> = {
      companyName,
      contactName,
      email,
      status: 'pending',
      referralsCount: 0,
      totalCommissionZar: 0,
      ...actorFrom(user),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }

    const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
    const website = typeof body.website === 'string' ? body.website.trim() : ''
    const pitch = typeof body.pitch === 'string' ? body.pitch.trim() : ''
    const expectedVolume = typeof body.expectedVolume === 'string' ? body.expectedVolume.trim() : ''
    if (phone) doc.phone = phone
    if (website) doc.website = website
    if (pitch) doc.pitch = pitch
    if (expectedVolume) doc.expectedVolume = expectedVolume

    const ref = await adminDb.collection(COLLECTION).add(doc)
    const created = await ref.get()
    return apiSuccess({ id: created.id, ...(created.data() as Omit<PartnerApplication, 'id'>) }, 201)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
