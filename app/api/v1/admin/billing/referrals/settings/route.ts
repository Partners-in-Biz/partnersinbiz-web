/**
 * PUT /api/v1/admin/billing/referrals/settings — upsert ReferralSettings.
 *
 * Singleton stored at billing_config/referrals. Controls referral credit
 * amounts and approval policy for the EFT/PayPal referral programme.
 */
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import type { ReferralSettings } from '@/lib/billing/types'

export const dynamic = 'force-dynamic'

const SETTINGS_DOC = adminDb.collection('billing_config').doc('referrals')

const DEFAULT_SETTINGS: ReferralSettings = {
  referrerCreditZar: 500,
  referredCreditZar: 250,
  requireApproval: true,
  minPaidInvoices: 1,
  active: true,
}

export const PUT = withAuth('admin', async (req, user) => {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return apiError('Invalid JSON body', 400)

  const referrerCreditZar = Number(body.referrerCreditZar)
  const referredCreditZar = Number(body.referredCreditZar)
  const minPaidInvoices = Number(body.minPaidInvoices)

  if (!Number.isFinite(referrerCreditZar) || referrerCreditZar < 0) {
    return apiError('referrerCreditZar must be a number >= 0', 400)
  }
  if (!Number.isFinite(referredCreditZar) || referredCreditZar < 0) {
    return apiError('referredCreditZar must be a number >= 0', 400)
  }
  if (!Number.isFinite(minPaidInvoices) || minPaidInvoices < 0) {
    return apiError('minPaidInvoices must be a number >= 0', 400)
  }

  const update: Record<string, unknown> = {
    referrerCreditZar,
    referredCreditZar,
    minPaidInvoices: Math.floor(minPaidInvoices),
    requireApproval: Boolean(body.requireApproval),
    active: Boolean(body.active),
    ...lastActorFrom(user),
  }

  const existing = await SETTINGS_DOC.get()
  if (!existing.exists) {
    update.createdAt = FieldValue.serverTimestamp()
  }
  await SETTINGS_DOC.set(update, { merge: true })

  const saved = await SETTINGS_DOC.get()
  const data = { ...DEFAULT_SETTINGS, ...(saved.data() as Partial<ReferralSettings>) }
  return apiSuccess(data)
})
