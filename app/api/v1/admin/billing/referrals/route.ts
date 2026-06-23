/**
 * GET  /api/v1/admin/billing/referrals  — list all referrals + settings + summary.
 * POST /api/v1/admin/billing/referrals  — create a manual referral.
 *
 * Referral credits are EFT-first / PayPal credits applied off-platform. NO
 * Stripe. A referral records that one org (referrer) brought in another org
 * (referred); on payout the credit is settled via EFT/PayPal and marked paid.
 */
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { actorFrom } from '@/lib/api/actor'
import { tsToMillis } from '@/lib/billing/format'
import type { Referral, ReferralSettings, ReferralStatus } from '@/lib/billing/types'

export const dynamic = 'force-dynamic'

const COLLECTION = 'referrals'
const SETTINGS_DOC = adminDb.collection('billing_config').doc('referrals')

const DEFAULT_SETTINGS: ReferralSettings = {
  referrerCreditZar: 500,
  referredCreditZar: 250,
  requireApproval: true,
  minPaidInvoices: 1,
  active: true,
}

async function loadSettings(): Promise<ReferralSettings> {
  const snap = await SETTINGS_DOC.get()
  if (!snap.exists) return { ...DEFAULT_SETTINGS }
  return { ...DEFAULT_SETTINGS, ...(snap.data() as Partial<ReferralSettings>) }
}

async function orgName(orgId: string, cache: Map<string, string>): Promise<string> {
  if (cache.has(orgId)) return cache.get(orgId) as string
  const snap = await adminDb.collection('organizations').doc(orgId).get()
  const name = (snap.data()?.name as string | undefined) ?? orgId
  cache.set(orgId, name)
  return name
}

export const GET = withAuth('admin', async () => {
  const [snap, settings] = await Promise.all([
    adminDb.collection(COLLECTION).get(),
    loadSettings(),
  ])

  const cache = new Map<string, string>()
  const referrals: Referral[] = []
  for (const doc of snap.docs) {
    const data = doc.data() as Omit<Referral, 'id'>
    const referrerName =
      data.referrerName && data.referrerName.trim()
        ? data.referrerName
        : await orgName(data.referrerOrgId, cache)
    const referredName =
      data.referredName && data.referredName.trim()
        ? data.referredName
        : await orgName(data.referredOrgId, cache)
    referrals.push({ id: doc.id, ...data, referrerName, referredName })
  }

  referrals.sort((a, b) => (tsToMillis(b.createdAt) ?? 0) - (tsToMillis(a.createdAt) ?? 0))

  const summary = {
    pendingCount: 0,
    pendingCreditZar: 0,
    approvedCount: 0,
    approvedCreditZar: 0,
    paidCreditZar: 0,
  }
  for (const r of referrals) {
    const credit = Number(r.creditZar) || 0
    if (r.status === 'pending') {
      summary.pendingCount += 1
      summary.pendingCreditZar += credit
    } else if (r.status === 'approved') {
      summary.approvedCount += 1
      summary.approvedCreditZar += credit
    } else if (r.status === 'paid') {
      summary.paidCreditZar += credit
    }
  }

  return apiSuccess({ referrals, settings, summary })
})

export const POST = withAuth('admin', async (req, user) => {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return apiError('Invalid JSON body', 400)

  const referrerOrgId = typeof body.referrerOrgId === 'string' ? body.referrerOrgId.trim() : ''
  const referredOrgId = typeof body.referredOrgId === 'string' ? body.referredOrgId.trim() : ''
  const creditZar = Number(body.creditZar)

  if (!referrerOrgId) return apiError('referrerOrgId is required', 400)
  if (!referredOrgId) return apiError('referredOrgId is required', 400)
  if (referrerOrgId === referredOrgId) {
    return apiError('referrer and referred org must be different', 400)
  }
  if (!Number.isFinite(creditZar) || creditZar <= 0) {
    return apiError('creditZar must be a number greater than 0', 400)
  }

  const [referrerSnap, referredSnap, settings] = await Promise.all([
    adminDb.collection('organizations').doc(referrerOrgId).get(),
    adminDb.collection('organizations').doc(referredOrgId).get(),
    loadSettings(),
  ])
  if (!referrerSnap.exists) return apiError('Referrer org not found', 404)
  if (!referredSnap.exists) return apiError('Referred org not found', 404)

  const referrerName = (referrerSnap.data()?.name as string | undefined) ?? referrerOrgId
  const referredName = (referredSnap.data()?.name as string | undefined) ?? referredOrgId

  const status: ReferralStatus = settings.requireApproval ? 'pending' : 'approved'
  const actor = actorFrom(user)

  const doc: Record<string, unknown> = {
    referrerOrgId,
    referrerName,
    referredOrgId,
    referredName,
    creditZar,
    status,
    disputeReason: null,
    approvedBy: status === 'approved' ? user.uid : null,
    approvedAt: status === 'approved' ? FieldValue.serverTimestamp() : null,
    paidAt: null,
    ...actor,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  const ref = await adminDb.collection(COLLECTION).add(doc)
  const created = await ref.get()
  return apiSuccess({ id: ref.id, ...(created.data() as Omit<Referral, 'id'>) }, 201)
})
