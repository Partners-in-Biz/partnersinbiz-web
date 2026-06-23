/**
 * POST /api/v1/admin/org/[id]/trial
 *
 * Sets an org onto an EFT trial (US-282). Writes `adminBilling` with
 * state:'trial' and a trialEndsAt computed from `trialDays`, merging into the
 * org doc without clobbering other adminBilling fields. Records an audit entry.
 *
 * No Stripe — manual / EFT billing only.
 *
 * Auth: super-admin only.
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { writeAdminAudit } from '@/lib/admin/audit'
import type { Organization } from '@/lib/organizations/types'
import type { AdminBilling } from '@/lib/admin/billing-model'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const VALID_CURRENCIES = ['ZAR', 'USD', 'EUR'] as const

export const POST = withAuth('admin', async (req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) {
    return apiError('Super-admin access required', 403)
  }

  const { id } = await (ctx as Params).params
  const body = await req.json().catch(() => ({}))

  const trialDaysRaw = Number(body.trialDays)
  const trialDays = Number.isFinite(trialDaysRaw) && trialDaysRaw > 0 ? Math.floor(trialDaysRaw) : 0
  if (trialDays <= 0) {
    return apiError('trialDays must be a positive number', 400)
  }

  const currency = VALID_CURRENCIES.includes(body.currency)
    ? (body.currency as AdminBilling['currency'])
    : 'ZAR'

  // Verify the org exists before writing.
  const orgRef = adminDb.collection('organizations').doc(id)
  const orgDoc = await orgRef.get()
  if (!orgDoc.exists) return apiError('Organisation not found', 404)
  const org = orgDoc.data() as Organization

  const now = Date.now()
  const trialEndsAt = new Date(now + trialDays * 24 * 60 * 60 * 1000).toISOString()

  const existingBilling = (org as { adminBilling?: AdminBilling }).adminBilling ?? {}
  const existingEvents = Array.isArray(existingBilling.events) ? existingBilling.events : []

  const trialEvent = {
    type: 'trial.started',
    note: `Trial started for ${trialDays} day(s); ends ${trialEndsAt}`,
    actorUid: user.uid,
    at: new Date(now).toISOString(),
  }

  const adminBilling: AdminBilling = {
    ...existingBilling,
    state: 'trial',
    trialEndsAt,
    currency,
    paymentMethod: existingBilling.paymentMethod ?? 'eft',
    events: [...existingEvents, trialEvent],
  }

  await orgRef.set(
    {
      adminBilling,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )

  await writeAdminAudit(user, {
    action: 'billing.start_trial',
    orgId: id,
    summary: `Started a ${trialDays}-day trial for ${org.name ?? id}`,
    metadata: { trialDays, trialEndsAt, currency },
  })

  return apiSuccess({ id, adminBilling: { state: adminBilling.state, trialEndsAt, currency, trialDays } })
})
