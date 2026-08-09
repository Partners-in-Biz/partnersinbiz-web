import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import { recordCrmAuditEvent } from '@/lib/crm/audit'
import { cleanString } from './identity'

/**
 * Settlement of a partner invoice, org to org.
 *
 * The platform already has an EFT proof-of-payment flow, but it is shaped for
 * Partners in Biz billing a client: `POST /invoices/{id}/confirm-payment` is
 * `withAuth('admin')`, i.e. only a PLATFORM admin can verify a payment. For
 * trading between two client orgs the verifier must be the org that issued the
 * invoice, so this module reimplements the two transitions with partner
 * ownership checks instead of platform-admin checks.
 *
 * EFT-first, matching the rest of the billing surface: the buyer records a
 * reference (and optionally an uploaded proof file), the supplier verifies.
 * No card rails involved.
 */

export const INVOICES_COLLECTION = 'invoices'
export const ORDERS_COLLECTION = 'orders'

export type PartnerPaymentState =
  | 'unpaid'
  | 'pending_verification'
  | 'paid'
  | 'rejected'

export interface PartnerPaymentRecord {
  reference?: string
  amount?: number
  fileId?: string
  note?: string
  submittedByOrgId?: string
  submittedAt?: unknown
  decidedAt?: unknown
  decisionNote?: string
}

export interface PartnerInvoiceSummary {
  id: string
  invoiceNumber?: string
  issuerOrgId: string
  recipientOrgId: string
  status: string
  paymentState: PartnerPaymentState
  total: number
  currency: string
  tradeOrderId?: string
  partnerPayment?: PartnerPaymentRecord
  createdAt?: unknown
}

function stripUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined))
}

function paymentStateOf(invoice: Record<string, unknown>): PartnerPaymentState {
  const status = cleanString(invoice.status)
  if (status === 'paid') return 'paid'
  if (status === 'payment_pending_verification') return 'pending_verification'
  if (cleanString((invoice.partnerPayment as PartnerPaymentRecord | undefined)?.decisionNote) &&
      cleanString(invoice.paymentRejectedAt)) return 'rejected'
  return 'unpaid'
}

/**
 * Inside a transaction: prove the partner link is STILL live between these two
 * orgs. Both mirrored relationship rows must exist, be active, not deleted,
 * and together name exactly the two orgs on this invoice. Settlement is part
 * of the relationship — after either side unlinks, the payment surface closes.
 */
async function assertLivePartnerLinkTx(input: {
  tx: FirebaseFirestore.Transaction
  partnerLinkId: string
  orgA: string
  orgB: string
}): Promise<void> {
  const partnerLinkId = cleanString(input.partnerLinkId)
  if (!partnerLinkId) throw new Error('This is not a partner settlement')
  const snap = await input.tx.get(
    adminDb
      .collection('businessRelationships')
      .where('partnerLinkId', '==', partnerLinkId)
      .limit(10),
  )
  const rows = snap.docs.map((d) => d.data() ?? {})
  const activeOrgIds = new Set(
    rows
      .filter((r) => r.status === 'active' && r.deleted !== true)
      .map((r) => cleanString(r.sourceOrgId)),
  )
  if (activeOrgIds.size < 2 || !activeOrgIds.has(input.orgA) || !activeOrgIds.has(input.orgB)) {
    throw new Error('This partner link is no longer active')
  }
}

/**
 * Loads an invoice inside a transaction and proves it belongs to a partner
 * trade between these two orgs. Everything downstream depends on this, so it
 * is deliberately strict: the invoice must name both orgs AND carry a
 * tradeOrderId. The mirrored order pair and the live partner link are read in
 * the same transaction, so the mutation-time relationship re-check races
 * safely with an unlink.
 */
async function loadPartnerInvoiceTx(input: {
  tx: FirebaseFirestore.Transaction
  invoiceId: string
  orgId: string
  side: 'issuer' | 'recipient'
}): Promise<{
  ref: FirebaseFirestore.DocumentReference
  data: Record<string, unknown>
  orderDocs: FirebaseFirestore.QueryDocumentSnapshot[]
  partnerLinkId: string
  tradeOrderId: string
}> {
  const ref = adminDb.collection(INVOICES_COLLECTION).doc(input.invoiceId)
  const snap = await input.tx.get(ref)
  if (!snap.exists) throw new Error('Invoice not found')
  const data = snap.data() ?? {}

  const issuerOrgId = cleanString(data.orgId) || cleanString(data.sourceOrgId)
  const recipientOrgId = cleanString(data.recipientOrgId)
  if (!issuerOrgId || !recipientOrgId) throw new Error('This is not a partner invoice')
  const tradeOrderId = cleanString(data.tradeOrderId)
  if (!tradeOrderId) throw new Error('This is not a partner invoice')

  const expected = input.side === 'issuer' ? issuerOrgId : recipientOrgId
  if (expected !== input.orgId) throw new Error('Invoice not found')

  // The order pair proves this is a partner trade; the link must still be live.
  const orderSnap = await input.tx.get(
    adminDb
      .collection(ORDERS_COLLECTION)
      .where('tradeOrderId', '==', tradeOrderId)
      .limit(10),
  )
  const partnerLinkId = cleanString(orderSnap.docs[0]?.data()?.partnerLinkId)
  if (partnerLinkId) {
    await assertLivePartnerLinkTx({
      tx: input.tx,
      partnerLinkId,
      orgA: issuerOrgId,
      orgB: recipientOrgId,
    })
  }

  return { ref, data, orderDocs: orderSnap.docs, partnerLinkId, tradeOrderId }
}

/**
 * Buyer records that they have paid — an EFT reference, optionally with an
 * uploaded proof file. Moves the invoice to pending verification; it does NOT
 * mark it paid, because only the org that is owed the money can say that.
 *
 * The invoice status precondition and the payment-state mirror onto both order
 * copies commit in ONE Firestore transaction, so two concurrent 'pay' requests
 * cannot both win and a payment racing a verification cannot corrupt state.
 */
export async function recordPartnerPayment(input: {
  payerOrgId: string
  invoiceId: string
  reference?: string
  amount?: number
  fileId?: string
  note?: string
  actor: MemberRef
}): Promise<{ invoiceId: string; paymentState: PartnerPaymentState; orderIds: string[] }> {
  const reference = cleanString(input.reference)
  const fileId = cleanString(input.fileId)
  if (!reference && !fileId) {
    throw new Error('Provide a payment reference or attach proof of payment')
  }

  const amount = typeof input.amount === 'number' && Number.isFinite(input.amount) && input.amount > 0
    ? input.amount
    : undefined

  const now = FieldValue.serverTimestamp()
  const payment: PartnerPaymentRecord = stripUndefined({
    reference: reference || undefined,
    amount,
    fileId: fileId || undefined,
    note: cleanString(input.note) || undefined,
    submittedByOrgId: input.payerOrgId,
    submittedAt: now,
  }) as PartnerPaymentRecord

  const outcome = await adminDb.runTransaction(async (tx) => {
    const { ref, data, orderDocs, tradeOrderId } = await loadPartnerInvoiceTx({
      tx,
      invoiceId: input.invoiceId,
      orgId: input.payerOrgId,
      side: 'recipient',
    })

    const status = cleanString(data.status)
    if (status === 'paid') throw new Error('This invoice is already settled')
    if (status === 'payment_pending_verification') {
      throw new Error('A payment is already awaiting verification on this invoice')
    }
    if (status === 'cancelled' || status === 'void') throw new Error('This invoice is closed')

    tx.set(ref, stripUndefined({
      status: 'payment_pending_verification',
      partnerPayment: payment,
      paymentProofFileId: fileId || undefined,
      paymentRejectedAt: FieldValue.delete(),
      updatedByRef: input.actor,
      updatedAt: now,
    }), { merge: true })

    const orderIds: string[] = []
    for (const doc of orderDocs) {
      tx.set(doc.ref, {
        paymentState: 'pending_verification',
        updatedByRef: input.actor,
        updatedAt: now,
      }, { merge: true })
      orderIds.push(doc.id)
    }

    return {
      issuerOrgId: cleanString(data.orgId) || cleanString(data.sourceOrgId),
      invoiceNumber: cleanString(data.invoiceNumber),
      tradeOrderId,
      orderIds,
    }
  })

  await recordCrmAuditEvent({
    orgId: input.payerOrgId,
    eventType: 'partner_payment.submitted',
    resourceType: 'invoice',
    resourceId: input.invoiceId,
    actorRef: input.actor,
    metadata: { tradeOrderId: outcome.tradeOrderId, reference, amount },
    notification: {
      type: 'partner_payment.submitted',
      title: 'A partner marked an invoice as paid',
      body: `${outcome.invoiceNumber || 'An invoice'} has a payment awaiting your verification${reference ? ` (ref ${reference})` : ''}.`,
      targetOrgIds: [outcome.issuerOrgId],
    },
  })

  return { invoiceId: input.invoiceId, paymentState: 'pending_verification', orderIds: outcome.orderIds }
}

/**
 * Supplier verifies or rejects. This is the transition the existing
 * confirm-payment route reserves for platform admins; here it belongs to the
 * org that issued the invoice.
 */
export async function decidePartnerPayment(input: {
  issuerOrgId: string
  invoiceId: string
  decision: 'confirm' | 'reject'
  note?: string
  actor: MemberRef
}): Promise<{ invoiceId: string; paymentState: PartnerPaymentState; orderIds: string[] }> {
  const now = FieldValue.serverTimestamp()
  const confirmed = input.decision === 'confirm'
  const paymentState: PartnerPaymentState = confirmed ? 'paid' : 'rejected'

  const outcome = await adminDb.runTransaction(async (tx) => {
    const { ref, data, orderDocs, tradeOrderId } = await loadPartnerInvoiceTx({
      tx,
      invoiceId: input.invoiceId,
      orgId: input.issuerOrgId,
      side: 'issuer',
    })

    if (cleanString(data.status) !== 'payment_pending_verification') {
      throw new Error('There is no payment awaiting verification on this invoice')
    }

    const existing = (data.partnerPayment ?? {}) as PartnerPaymentRecord

    tx.set(ref, stripUndefined({
      status: confirmed ? 'paid' : 'sent',
      paidAt: confirmed ? now : FieldValue.delete(),
      paymentRejectedAt: confirmed ? FieldValue.delete() : now,
      partnerPayment: {
        ...existing,
        decidedAt: now,
        decisionNote: cleanString(input.note) || undefined,
      },
      updatedByRef: input.actor,
      updatedAt: now,
    }), { merge: true })

    const orderIds: string[] = []
    for (const doc of orderDocs) {
      tx.set(doc.ref, {
        paymentState,
        updatedByRef: input.actor,
        updatedAt: now,
      }, { merge: true })
      orderIds.push(doc.id)
    }

    return {
      recipientOrgId: cleanString(data.recipientOrgId),
      invoiceNumber: cleanString(data.invoiceNumber),
      reference: existing.reference,
      tradeOrderId,
      orderIds,
    }
  })

  await recordCrmAuditEvent({
    orgId: input.issuerOrgId,
    eventType: `partner_payment.${confirmed ? 'confirmed' : 'rejected'}`,
    resourceType: 'invoice',
    resourceId: input.invoiceId,
    actorRef: input.actor,
    metadata: { tradeOrderId: outcome.tradeOrderId, reference: outcome.reference },
    notification: {
      type: `partner_payment.${confirmed ? 'confirmed' : 'rejected'}`,
      title: confirmed ? 'Your payment was confirmed' : 'Your payment could not be verified',
      body: confirmed
        ? `${outcome.invoiceNumber || 'An invoice'} is now settled.`
        : `${outcome.invoiceNumber || 'An invoice'} is still outstanding${cleanString(input.note) ? `: ${cleanString(input.note)}` : ''}.`,
      targetOrgIds: [outcome.recipientOrgId],
    },
  })

  return { invoiceId: input.invoiceId, paymentState, orderIds: outcome.orderIds }
}

/**
 * Partner invoices on both sides: what this org is owed (receivable) and what
 * it owes (payable). Both are read from the caller's own tenant scope.
 */
export async function listPartnerSettlements(orgId: string): Promise<{
  receivable: PartnerInvoiceSummary[]
  payable: PartnerInvoiceSummary[]
}> {
  const [issuedSnap, receivedSnap] = await Promise.all([
    adminDb.collection(INVOICES_COLLECTION).where('orgId', '==', orgId).limit(1000).get(),
    adminDb.collection(INVOICES_COLLECTION).where('recipientOrgId', '==', orgId).limit(1000).get(),
  ])

  const toSummary = (id: string, data: Record<string, unknown>): PartnerInvoiceSummary => ({
    id,
    invoiceNumber: cleanString(data.invoiceNumber) || undefined,
    issuerOrgId: cleanString(data.orgId) || cleanString(data.sourceOrgId),
    recipientOrgId: cleanString(data.recipientOrgId),
    status: cleanString(data.status),
    paymentState: paymentStateOf(data),
    total: Number(data.total) || 0,
    currency: cleanString(data.currency) || 'ZAR',
    tradeOrderId: cleanString(data.tradeOrderId) || undefined,
    partnerPayment: (data.partnerPayment ?? undefined) as PartnerPaymentRecord | undefined,
    createdAt: data.createdAt,
  })

  const isPartnerInvoice = (data: Record<string, unknown>) =>
    data.deleted !== true && cleanString(data.tradeOrderId) && cleanString(data.recipientOrgId)

  return {
    receivable: issuedSnap.docs
      .map((d) => ({ id: d.id, data: d.data() ?? {} }))
      .filter((r) => isPartnerInvoice(r.data) && cleanString(r.data.recipientOrgId) !== orgId)
      .map((r) => toSummary(r.id, r.data)),
    payable: receivedSnap.docs
      .map((d) => ({ id: d.id, data: d.data() ?? {} }))
      .filter((r) => isPartnerInvoice(r.data))
      .map((r) => toSummary(r.id, r.data)),
  }
}
