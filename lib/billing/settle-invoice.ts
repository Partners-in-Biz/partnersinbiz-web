/**
 * lib/billing/settle-invoice.ts
 *
 * Shared "settle an invoice as paid + advance its subscription" logic, factored
 * out of the various payment paths (PayPal capture route, billing webhooks,
 * internal EFT-confirmation hook) so the side effects stay consistent.
 *
 * Mirrors the behaviour of `app/api/v1/invoices/[id]/mark-paid` and
 * `app/api/v1/invoices/[id]/paypal-capture`:
 *   - load the invoice; if already paid → return early (idempotent)
 *   - set paid fields (status, paidAt, paymentMethod, paymentReference, paidAmount)
 *   - write an `activities` entry (type `invoice.paid`)
 *   - notify the invoice creator (unless they triggered it)
 *   - dispatch `invoice.paid` + `payment.received` outbound webhooks
 *   - best-effort email-click attribution
 *   - if the invoice is tied to a subscription (via `subscriptionId` or the
 *     org's current subscription), move it past_due/trialing → active and
 *     advance currentPeriodStart/End by the plan interval
 *
 * EFT-first / PayPal-second. NO Stripe.
 */
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import { tryAttributeInvoicePaid } from '@/lib/email-analytics/attribution-hooks'
import type { Subscription } from '@/lib/billing/types'
import type { BillingInterval } from '@/lib/plans/types'

const DAY_MS = 24 * 60 * 60 * 1000

export type SettlePaymentMethod = 'eft' | 'paypal' | 'cash' | 'card' | 'other'

export interface SettleInvoiceInput {
  invoiceId: string
  paymentMethod: SettlePaymentMethod
  /** Provider reference (PayPal capture id, EFT reference, etc.) */
  paymentReference?: string | null
  /** Amount actually paid; defaults to the invoice total */
  paidAmount?: number | null
  /** When the payment settled; defaults to now */
  paidAt?: Date | null
  /**
   * Human-readable actor for the activity log + lastUpdatedBy. Defaults to a
   * system actor since webhooks have no authenticated user.
   */
  actorId?: string
  actorName?: string
  actorRole?: 'ai' | 'admin' | 'client' | 'system'
}

export interface SettleInvoiceResult {
  ok: boolean
  /** True when the invoice was already paid (no-op, idempotent) */
  alreadyPaid: boolean
  /** True when an invoice with this id does not exist */
  notFound: boolean
  invoiceId: string
  invoiceNumber?: string
  subscriptionAdvanced?: boolean
  /**
   * True when the settled amount was below the invoice total (beyond rounding
   * tolerance). The invoice is marked `partially_paid`, the subscription is NOT
   * advanced, and no `invoice.paid`/`payment.received` webhooks fire.
   */
  partiallyPaid?: boolean
  /** Outstanding balance (invoice.total − paidAmount) when partially paid. */
  shortfall?: number
}

/** Rounding tolerance for amount comparisons — half a ZAR cent. */
const AMOUNT_EPSILON = 0.005

/** Round a currency amount to 2 decimals (ZAR cents), avoiding float drift. */
function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
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

function toMillis(value: unknown): number | null {
  if (!value) return null
  if (value instanceof Date) return value.getTime()
  const v = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
  if (typeof v.toMillis === 'function') return v.toMillis()
  const seconds = v.seconds ?? v._seconds
  if (typeof seconds === 'number') return seconds * 1000
  return null
}

/**
 * Find the subscription an invoice should advance. Prefers an explicit
 * `subscriptionId` on the invoice; otherwise falls back to the org's most
 * relevant subscription (a past_due/trialing one, else any non-cancelled one).
 */
async function resolveSubscription(invoice: {
  subscriptionId?: unknown
  orgId?: unknown
}): Promise<{ id: string; data: Subscription } | null> {
  const subscriptionId =
    typeof invoice.subscriptionId === 'string' ? invoice.subscriptionId : null

  if (subscriptionId) {
    const doc = await adminDb.collection('subscriptions').doc(subscriptionId).get()
    if (doc.exists) return { id: doc.id, data: doc.data() as Subscription }
    return null
  }

  const orgId = typeof invoice.orgId === 'string' ? invoice.orgId : null
  if (!orgId) return null

  const snap = await adminDb
    .collection('subscriptions')
    .where('orgId', '==', orgId)
    .get()
  if (snap.empty) return null

  const subs = snap.docs.map((d) => ({ id: d.id, data: d.data() as Subscription }))
  // Prefer one that needs activating.
  const needsActivation = subs.find(
    (s) => s.data.status === 'past_due' || s.data.status === 'trialing',
  )
  if (needsActivation) return needsActivation
  // Else any non-cancelled subscription so the period still advances.
  const live = subs.find((s) => s.data.status !== 'cancelled')
  return live ?? null
}

/**
 * Advance a subscription to `active` and roll its billing period forward by one
 * interval. Idempotent-ish: if already active, only the period window advances.
 */
async function advanceSubscription(
  sub: { id: string; data: Subscription },
  paidAtMs: number,
): Promise<void> {
  const interval = (sub.data.interval ?? 'monthly') as BillingInterval
  // Anchor the new period on the later of the existing period end or the payment
  // time so a lapsed sub gets fresh runway rather than a still-past window.
  const existingEnd = toMillis(sub.data.currentPeriodEnd)
  const startMs = Math.max(existingEnd ?? 0, paidAtMs)
  const endMs = startMs + intervalDays(interval) * DAY_MS

  const update: Record<string, unknown> = {
    status: 'active',
    currentPeriodStart: Timestamp.fromMillis(startMs),
    currentPeriodEnd: Timestamp.fromMillis(endMs),
    updatedAt: FieldValue.serverTimestamp(),
  }
  if (toMillis(sub.data.startedAt) == null) {
    update.startedAt = Timestamp.fromMillis(paidAtMs)
  }

  await adminDb.collection('subscriptions').doc(sub.id).update(update)
}

/**
 * Settle an invoice as paid and advance any linked subscription. Idempotent:
 * a second call for an already-paid invoice is a no-op that returns
 * `{ ok: true, alreadyPaid: true }`.
 */
export async function settleInvoicePaid(
  input: SettleInvoiceInput,
): Promise<SettleInvoiceResult> {
  const {
    invoiceId,
    paymentMethod,
    paymentReference = null,
    paidAmount = null,
    paidAt = null,
    actorId = 'system',
    actorName = 'System',
    actorRole = 'system',
  } = input

  const ref = adminDb.collection('invoices').doc(invoiceId)

  const paidAtTs = paidAt ? Timestamp.fromDate(paidAt) : FieldValue.serverTimestamp()
  const paidAtMs = paidAt ? paidAt.getTime() : Date.now()

  // --- Atomic load + status-check + write (H2) --------------------------
  // The load, the "already paid?" check, and the paid/partially_paid write all
  // happen inside one Firestore transaction. Concurrent webhook retries
  // (PayPal + EFT both retry) serialise here: exactly ONE caller observes the
  // un-settled invoice and performs the transition; every other caller sees the
  // settled state and bails as a no-op. Side-effects below (subscription
  // advance, outbound webhooks, activity, notification) run only when THIS call
  // is the one that transitioned the invoice — so they fire exactly once.
  type TxOutcome =
    | { kind: 'not-found' }
    | { kind: 'already-settled' }
    | {
        kind: 'transitioned'
        invoice: Record<string, unknown>
        invoiceNumber: string
        orgId: string | undefined
        createdBy: string | undefined
        total: number
        settledAmount: number
        fullyPaid: boolean
        shortfall: number
      }

  const outcome: TxOutcome = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return { kind: 'not-found' }

    const invoice = snap.data() as Record<string, unknown>

    // Idempotency: any terminal-settled state is a no-op for this caller. We
    // treat `paid` and `partially_paid` as already-settled so a retry never
    // re-runs side-effects (a partial top-up to full settlement is a separate
    // flow handled elsewhere, not by a blind webhook retry).
    if (invoice.status === 'paid' || invoice.status === 'partially_paid') {
      return { kind: 'already-settled' }
    }

    const invoiceNumber =
      typeof invoice.invoiceNumber === 'string' ? invoice.invoiceNumber : invoiceId
    const orgId = typeof invoice.orgId === 'string' ? invoice.orgId : undefined
    const createdBy =
      typeof invoice.createdBy === 'string' ? invoice.createdBy : undefined
    const total =
      typeof invoice.total === 'number' ? roundCurrency(invoice.total) : 0

    // --- Validate paid amount (H1) -------------------------------------
    // Default to the invoice total when no explicit amount was supplied.
    const settledAmount = roundCurrency(
      typeof paidAmount === 'number' ? paidAmount : total,
    )
    // Full settlement = settled amount covers the total within tolerance.
    // Overpayment (settled > total) still counts as full settlement.
    const fullyPaid = settledAmount + AMOUNT_EPSILON >= total
    const shortfall = fullyPaid ? 0 : roundCurrency(total - settledAmount)

    const updates: Record<string, unknown> = {
      status: fullyPaid ? 'paid' : 'partially_paid',
      paidAt: paidAtTs,
      paymentMethod,
      paidAmount: settledAmount,
      lastUpdatedBy: actorId,
      updatedAt: FieldValue.serverTimestamp(),
    }
    if (paymentReference) updates.paymentReference = paymentReference
    if (!fullyPaid) updates.amountDue = shortfall

    tx.update(ref, updates)

    return {
      kind: 'transitioned',
      invoice,
      invoiceNumber,
      orgId,
      createdBy,
      total,
      settledAmount,
      fullyPaid,
      shortfall,
    }
  })

  if (outcome.kind === 'not-found') {
    return { ok: false, alreadyPaid: false, notFound: true, invoiceId }
  }
  if (outcome.kind === 'already-settled') {
    return {
      ok: true,
      alreadyPaid: true,
      notFound: false,
      invoiceId,
    }
  }

  const {
    invoice,
    invoiceNumber,
    orgId,
    createdBy,
    total,
    settledAmount,
    fullyPaid,
    shortfall,
  } = outcome

  if (!fullyPaid) {
    // Underpayment: record the shortfall, flag the mismatch, and stop. We do
    // NOT advance the subscription, notify "paid", or fire paid/received
    // webhooks for a partial settlement. An activity entry records the partial
    // payment for the audit trail and ops follow-up.
    console.warn(
      `[settle-invoice] amount mismatch on ${invoiceNumber}: settled ${settledAmount} < total ${total} (shortfall ${shortfall}); marked partially_paid`,
    )
    await adminDb.collection('activities').add({
      orgId: orgId ?? null,
      type: 'invoice.partially_paid',
      resourceType: 'invoice',
      resourceId: invoiceId,
      summary: `Invoice ${invoiceNumber} partially paid via ${paymentMethod}: ${settledAmount} of ${total} (shortfall ${shortfall})${
        paymentReference ? ` (${paymentReference})` : ''
      }`,
      createdBy: actorId,
      createdByType: 'system',
      actorName,
      actorRole,
      createdAt: FieldValue.serverTimestamp(),
    })

    if (createdBy && createdBy !== actorId) {
      await adminDb.collection('notifications').add({
        orgId: orgId ?? null,
        userId: createdBy,
        agentId: null,
        type: 'invoice.partially_paid',
        title: 'Partial payment received',
        body: `Invoice ${invoiceNumber} received a partial payment of ${settledAmount} via ${paymentMethod} (${shortfall} still outstanding)`,
        link: `/portal/invoicing/${invoiceId}`,
        status: 'unread',
        priority: 'high',
        createdAt: FieldValue.serverTimestamp(),
      })
    }

    return {
      ok: true,
      alreadyPaid: false,
      notFound: false,
      invoiceId,
      invoiceNumber,
      subscriptionAdvanced: false,
      partiallyPaid: true,
      shortfall,
    }
  }

  // --- Activity log -----------------------------------------------------
  await adminDb.collection('activities').add({
    orgId: orgId ?? null,
    type: 'invoice.paid',
    resourceType: 'invoice',
    resourceId: invoiceId,
    summary: `Invoice ${invoiceNumber} paid via ${paymentMethod}${
      paymentReference ? ` (${paymentReference})` : ''
    }`,
    // Webhooks have no authenticated ApiUser; record the system actor in the
    // same shape `actorFrom` produces (createdBy/createdByType) plus a label.
    createdBy: actorId,
    createdByType: 'system',
    actorName,
    actorRole,
    createdAt: FieldValue.serverTimestamp(),
  })

  // --- Notify the invoice creator --------------------------------------
  if (createdBy && createdBy !== actorId) {
    await adminDb.collection('notifications').add({
      orgId: orgId ?? null,
      userId: createdBy,
      agentId: null,
      type: 'invoice.paid',
      title: 'Invoice paid',
      body: `Invoice ${invoiceNumber} was paid via ${paymentMethod}`,
      link: `/portal/invoicing/${invoiceId}`,
      status: 'unread',
      priority: 'normal',
      createdAt: FieldValue.serverTimestamp(),
    })
  }

  // --- Outbound webhooks ------------------------------------------------
  if (orgId) {
    const webhookPayload = {
      id: invoiceId,
      invoiceNumber,
      total,
      paymentMethod,
      paymentReference,
      paidAmount: settledAmount,
    }
    try {
      await dispatchWebhook(orgId, 'invoice.paid', webhookPayload)
    } catch (err) {
      console.error('[webhook-dispatch-error] invoice.paid', err)
    }
    try {
      await dispatchWebhook(orgId, 'payment.received', webhookPayload)
    } catch (err) {
      console.error('[webhook-dispatch-error] payment.received', err)
    }
  }

  // --- Best-effort email-click attribution ------------------------------
  await tryAttributeInvoicePaid({
    orgId,
    contactId: typeof invoice.contactId === 'string' ? invoice.contactId : null,
    invoiceId,
    amount: settledAmount,
    currency: typeof invoice.currency === 'string' ? invoice.currency : 'ZAR',
  })

  // --- Advance the linked subscription ----------------------------------
  let subscriptionAdvanced = false
  try {
    const sub = await resolveSubscription(invoice)
    if (sub) {
      await advanceSubscription(sub, paidAtMs)
      subscriptionAdvanced = true
    }
  } catch (err) {
    console.error('[settle-invoice] subscription advance failed', err)
  }

  return {
    ok: true,
    alreadyPaid: false,
    notFound: false,
    invoiceId,
    invoiceNumber,
    subscriptionAdvanced,
  }
}
