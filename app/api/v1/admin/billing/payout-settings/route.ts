/**
 * GET  /api/v1/admin/billing/payout-settings
 * PUT  /api/v1/admin/billing/payout-settings
 *
 * US-306 (ADAPTED). Originally a "Stripe Connect" partner-payout onboarding
 * story. Partners in Biz is EFT-first / PayPal-second with NO Stripe — there
 * is no Stripe Connect onboarding. This endpoint instead manages the platform
 * payout configuration and surfaces approved partners + amounts owed so the
 * team can settle commissions via EFT or PayPal transfer (manual, tracked
 * in-platform).
 *
 * PayoutSettings is a singleton at billing_config/payouts.
 * Partners live in the partner_applications collection.
 */
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import type {
  PayoutSettings,
  PartnerApplication,
  PayoutDetails,
} from '@/lib/billing/types'

export const dynamic = 'force-dynamic'

const SETTINGS_DOC = adminDb.collection('billing_config').doc('payouts')
const PARTNERS = 'partner_applications'

const DEFAULT_SETTINGS: PayoutSettings = {
  defaultCommissionPercent: 20,
  minPayoutZar: 500,
  payoutSchedule: 'monthly',
  payoutFromNote: '',
}

const SCHEDULES: PayoutSettings['payoutSchedule'][] = ['monthly', 'quarterly', 'on_request']

async function loadSettings(): Promise<PayoutSettings> {
  const snap = await SETTINGS_DOC.get()
  if (!snap.exists) return { ...DEFAULT_SETTINGS }
  return { ...DEFAULT_SETTINGS, ...(snap.data() as Partial<PayoutSettings>) }
}

interface PartnerView {
  partnerId: string
  companyName: string
  contactName: string
  email: string
  payoutMethod: 'eft' | 'paypal' | null
  payoutDetails: PayoutDetails | null
  commissionPercent: number | null
  referralsCount: number
  totalCommissionZar: number
}

interface OwedView {
  partnerId: string
  companyName: string
  payoutMethod: 'eft' | 'paypal' | null
  owedZar: number
}

export const GET = withAuth('admin', async () => {
  const [settings, snap] = await Promise.all([
    loadSettings(),
    adminDb.collection(PARTNERS).where('status', '==', 'approved').get(),
  ])

  const partners: PartnerView[] = snap.docs.map((doc) => {
    const data = doc.data() as Omit<PartnerApplication, 'id'>
    return {
      partnerId: doc.id,
      companyName: data.companyName ?? doc.id,
      contactName: data.contactName ?? '',
      email: data.email ?? '',
      payoutMethod: data.payoutMethod ?? null,
      payoutDetails: data.payoutDetails ?? null,
      commissionPercent:
        typeof data.commissionPercent === 'number' ? data.commissionPercent : null,
      referralsCount: Number(data.referralsCount) || 0,
      totalCommissionZar: Number(data.totalCommissionZar) || 0,
    }
  })

  partners.sort((a, b) => b.totalCommissionZar - a.totalCommissionZar)

  // Partners eligible for payout this cycle: lifetime commission at or above
  // the minimum payout threshold.
  const owed: OwedView[] = partners
    .filter((p) => p.totalCommissionZar >= settings.minPayoutZar && p.totalCommissionZar > 0)
    .map((p) => ({
      partnerId: p.partnerId,
      companyName: p.companyName,
      payoutMethod: p.payoutMethod,
      owedZar: p.totalCommissionZar,
    }))

  return apiSuccess({ settings, partners, owed })
})

export const PUT = withAuth('admin', async (req, user) => {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return apiError('Invalid JSON body', 400)

  const defaultCommissionPercent = Number(body.defaultCommissionPercent)
  const minPayoutZar = Number(body.minPayoutZar)
  const payoutSchedule = body.payoutSchedule
  const payoutFromNote =
    typeof body.payoutFromNote === 'string' ? body.payoutFromNote.trim() : ''

  if (!Number.isFinite(defaultCommissionPercent) || defaultCommissionPercent < 0 || defaultCommissionPercent > 100) {
    return apiError('defaultCommissionPercent must be a number between 0 and 100', 400)
  }
  if (!Number.isFinite(minPayoutZar) || minPayoutZar < 0) {
    return apiError('minPayoutZar must be a number greater than or equal to 0', 400)
  }
  if (typeof payoutSchedule !== 'string' || !SCHEDULES.includes(payoutSchedule as PayoutSettings['payoutSchedule'])) {
    return apiError(`payoutSchedule must be one of: ${SCHEDULES.join(', ')}`, 400)
  }

  const update: Record<string, unknown> = {
    defaultCommissionPercent,
    minPayoutZar,
    payoutSchedule,
    payoutFromNote,
    ...lastActorFrom(user),
  }

  await SETTINGS_DOC.set(update, { merge: true })

  const settings = await loadSettings()
  return apiSuccess({ settings })
})
