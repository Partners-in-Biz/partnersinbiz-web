import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { actorFrom, lastActorFrom } from '@/lib/api/actor'
import { toMonthlyZar } from '@/lib/billing/metrics'
import { sendEmail } from '@/lib/email/send'
import type { Subscription } from '@/lib/billing/types'
import type { BillingInterval } from '@/lib/plans/types'

export const dynamic = 'force-dynamic'

const DAY_MS = 24 * 60 * 60 * 1000

function toMillis(value: unknown): number | null {
  if (!value) return null
  if (value instanceof Date) return value.getTime()
  const v = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
  if (typeof v.toMillis === 'function') return v.toMillis()
  const seconds = v.seconds ?? v._seconds
  if (typeof seconds === 'number') return seconds * 1000
  return null
}

function intervalDays(interval: BillingInterval): number {
  switch (interval) {
    case 'monthly':
      return 30
    case 'quarterly':
      return 90
    case 'annual':
      return 365
    default:
      return 30
  }
}

interface ActionBody {
  action?: 'extend' | 'convert' | 'email'
  days?: number
  subject?: string
  body?: string
}

/**
 * POST /api/v1/admin/billing/trials/[orgId]
 *
 * Actions on an org's trialing subscription:
 *   - extend  → push trialEndsAt out by `days`
 *   - convert → set status active, set period window, record subscription_changes
 *   - email   → send a targeted email to the org (real send; queued fallback)
 */
export const POST = withAuth('admin', async (req, user, ctx) => {
  const params = (await (ctx as { params: Promise<{ orgId: string }> }).params)
  const orgId = params?.orgId
  if (!orgId) return apiError('Missing orgId', 400)

  let body: ActionBody = {}
  try {
    body = ((await req.json()) as ActionBody) ?? {}
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const action = body.action
  if (action !== 'extend' && action !== 'convert' && action !== 'email') {
    return apiError("action must be one of 'extend' | 'convert' | 'email'", 400)
  }

  // Resolve org (name + billing email for the email action).
  const orgSnap = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgSnap.exists) return apiError('Organization not found', 404)
  const orgData = orgSnap.data() as { name?: string; billingEmail?: string }
  const orgName = orgData.name ?? orgId

  // Find the org's trialing subscription (required for extend/convert).
  const subQuery = await adminDb
    .collection('subscriptions')
    .where('orgId', '==', orgId)
    .where('status', '==', 'trialing')
    .limit(1)
    .get()

  const trialDoc = subQuery.empty ? null : subQuery.docs[0]
  const trialSub = trialDoc ? ({ id: trialDoc.id, ...(trialDoc.data() as Subscription) }) : null

  // ---- EXTEND ----------------------------------------------------------
  if (action === 'extend') {
    if (!trialSub || !trialDoc) {
      return apiError('No trialing subscription for this org', 404)
    }
    const days = typeof body.days === 'number' ? Math.round(body.days) : NaN
    if (!Number.isFinite(days) || days <= 0 || days > 365) {
      return apiError('days must be a positive number (<= 365)', 400)
    }
    const baseMs = toMillis(trialSub.trialEndsAt) ?? Date.now()
    // Extend from whichever is later — now or the existing end — so a lapsed
    // trial gets a fresh runway rather than a still-past date.
    const fromMs = Math.max(baseMs, Date.now())
    const newEndMs = fromMs + days * DAY_MS

    await trialDoc.ref.update({
      trialEndsAt: Timestamp.fromMillis(newEndMs),
      ...lastActorFrom(user),
    })

    await adminDb.collection('activities').add({
      orgId,
      type: 'billing.trial_extended',
      resourceType: 'subscription',
      resourceId: trialSub.id,
      summary: `Trial extended by ${days} day${days === 1 ? '' : 's'} for ${orgName}`,
      ...actorFrom(user),
      createdAt: FieldValue.serverTimestamp(),
    })

    return apiSuccess({ orgId, action: 'extend', trialEndsAtMs: newEndMs, days })
  }

  // ---- CONVERT ---------------------------------------------------------
  if (action === 'convert') {
    if (!trialSub || !trialDoc) {
      return apiError('No trialing subscription for this org', 404)
    }
    const interval = (trialSub.interval ?? 'monthly') as BillingInterval
    const now = Date.now()
    const periodEndMs = now + intervalDays(interval) * DAY_MS
    const monthly = Math.round(toMonthlyZar(trialSub.priceZar ?? 0, interval))

    const update: Record<string, unknown> = {
      status: 'active',
      currentPeriodStart: Timestamp.fromMillis(now),
      currentPeriodEnd: Timestamp.fromMillis(periodEndMs),
      ...lastActorFrom(user),
    }
    // Set startedAt only if missing.
    if (toMillis(trialSub.startedAt) == null) {
      update.startedAt = Timestamp.fromMillis(now)
    }

    await trialDoc.ref.update(update)

    // Revenue-expansion tracking so MRR metrics pick up the new active sub.
    await adminDb.collection('subscription_changes').add({
      orgId,
      subscriptionId: trialSub.id,
      type: 'trial_converted',
      deltaMrrZar: monthly,
      createdAtMs: now,
      ...actorFrom(user),
      createdAt: FieldValue.serverTimestamp(),
    })

    await adminDb.collection('activities').add({
      orgId,
      type: 'billing.trial_converted',
      resourceType: 'subscription',
      resourceId: trialSub.id,
      summary: `Trial force-converted to active (${monthly > 0 ? `+R${monthly}/mo MRR` : 'no MRR'}) for ${orgName}`,
      ...actorFrom(user),
      createdAt: FieldValue.serverTimestamp(),
    })

    return apiSuccess({
      orgId,
      action: 'convert',
      status: 'active',
      deltaMrrZar: monthly,
      currentPeriodEndMs: periodEndMs,
    })
  }

  // ---- EMAIL -----------------------------------------------------------
  const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
  const emailBody = typeof body.body === 'string' ? body.body.trim() : ''
  if (!subject || !emailBody) {
    return apiError('subject and body are required for the email action', 400)
  }

  const to = orgData.billingEmail?.trim()
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;white-space:pre-wrap">${emailBody
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')}</div>`

  let emailStatus: 'sent' | 'queued' = 'queued'
  let sendError: string | undefined

  if (to) {
    const result = await sendEmail({ to, subject, html })
    if (result.success) {
      emailStatus = 'sent'
    } else {
      sendError = result.error
    }
  }

  // Always write a record to the trial_emails queue collection for audit /
  // retry, marking whether the real send went out.
  await adminDb.collection('trial_emails').add({
    orgId,
    to: to ?? null,
    subject,
    body: emailBody,
    status: emailStatus,
    error: sendError ?? null,
    ...actorFrom(user),
    createdAt: FieldValue.serverTimestamp(),
  })

  await adminDb.collection('activities').add({
    orgId,
    type: 'billing.trial_email',
    resourceType: 'organization',
    resourceId: orgId,
    summary: `Trial email "${subject}" ${emailStatus} to ${orgName}`,
    ...actorFrom(user),
    createdAt: FieldValue.serverTimestamp(),
  })

  return apiSuccess({ orgId, action: 'email', emailStatus, to: to ?? null })
})
