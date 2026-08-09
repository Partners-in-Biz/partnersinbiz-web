import { FieldValue, Timestamp } from 'firebase-admin/firestore'
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
 * Loads an invoice and proves it belongs to a partner trade between these two
 * orgs. Everything downstream depends on this, so it is deliberately strict:
 * the invoice must name both orgs AND carry a tradeOrderId.
 */
async function loadPartnerInvoice(input: {
  invoiceId: string
  orgId: string
  side: 'issuer' | 'recipient'
}): Promise<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }> {
  const ref = adminDb.collection(INVOICES_COLLECTION).doc(input.invoiceId)
  const snap = await ref.get()
  if (!snap.exists) throw new Error('Invoice not found')
  const data = snap.data() ?? {}

  const issuerOrgId = cleanString(data.orgId) || cleanString(data.sourceOrgId)
  const recipientOrgId = cleanString(data.recipientOrgId)
  if (!issuerOrgId || !recipientOrgId) throw new Error('This is not a partner invoice')
  if (!cleanString(data.tradeOrderId)) throw new Error('This is not a partner invoice')

  const expected = input.side === 'issuer' ? issuerOrgId : recipientOrgId
  if (expected !== input.orgId) throw new Error('Invoice not found')

  // The link must still be live — settlement is part of the relationship.
  const orderSnap = await adminDb
    .collection(ORDERS_COLLECTION)
    .where('tradeOrderId', '==', cleanString(data.tradeOrderId))
    .limit(10)
    .get()
  const partnerLinkId = cleanString((orderSnap.docs[0]?.data() ?? {}).partnerLinkId)
  if (partnerLinkId) {
    const linkSnap = await adminDb
      .collection('businessRelationships')
      .where('partnerLinkId', '==', partnerLinkId)
      .limit(10)
      .get()
    const live = linkSnap.docs.some((d) => {
      const row = d.data() ?? {}
      return row.status === 'active' && row.deleted !== true
    })
    if (!live) throw new Error('This partner link is no longer active')
  }

  return { ref, data }
}

/** Mirror the payment state onto both order copies so each side sees it. */
async function syncOrdersPaymentState(input: {
  tradeOrderId: string
  paymentState: PartnerPaymentState
  actor: MemberRef
}): Promise<string[]> {
  if (!input.tradeOrderId) return []
  const snap = await adminDb
    .collection(ORDERS_COLLECTION)
    .where('tradeOrderId', '==', input.tradeOrderId)
    .limit(10)
    .get()
  const now = Timestamp.now()
  const ids: string[] = []
  for (const doc of snap.docs) {
    await doc.ref.set({
      paymentState: input.paymentState,
      updatedByRef: input.actor,
      updatedAt: now,
    }, { merge: true })
    ids.push(doc.id)
  }
  return ids
}

/**
 * Buyer records that they have paid — an EFT reference, optionally with an
 * uploaded proof file. Moves the invoice to pending verification; it does NOT
 * mark it paid, because only the org that is owed the money can say that.
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
  const { ref, data } = await loadPartnerInvoice({
    invoiceId: input.invoiceId,
    orgId: input.payerOrgId,
    side: 'recipient',
  })

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

  // Claim the transition atomically: two submissions racing would otherwise
  // both pass the status check and overwrite each other's reference.
  await adminDb.runTransaction(async (tx) => {
    const fresh = await tx.get(ref)
    if (!fresh.exists) throw new Error('Invoice not found')
    const current = cleanString((fresh.data() ?? {}).status)
    if (current === 'paid') throw new Error('This invoice is already settled')
    if (current === 'payment_pending_verification') {
      throw new Error('A payment is already awaiting verification on this invoice')
    }
    if (current === 'cancelled' || current === 'void') throw new Error('This invoice is closed')
    tx.set(ref, stripUndefined({
      status: 'payment_pending_verification',
      partnerPayment: payment,
      paymentProofFileId: fileId || undefined,
      paymentRejectedAt: FieldValue.delete(),
      updatedByRef: input.actor,
      updatedAt: now,
    }), { merge: true })
  })

  const tradeOrderId = cleanString(data.tradeOrderId)
  const orderIds = await syncOrdersPaymentState({
    tradeOrderId,
    paymentState: 'pending_verification',
    actor: input.actor,
  })

  const issuerOrgId = cleanString(data.orgId) || cleanString(data.sourceOrgId)
  await recordCrmAuditEvent({
    orgId: input.payerOrgId,
    eventType: 'partner_payment.submitted',
    resourceType: 'invoice',
    resourceId: input.invoiceId,
    actorRef: input.actor,
    metadata: { tradeOrderId, reference, amount },
    notification: {
      type: 'partner_payment.submitted',
      title: 'A partner marked an invoice as paid',
      body: `${cleanString(data.invoiceNumber) || 'An invoice'} has a payment awaiting your verification${reference ? ` (ref ${reference})` : ''}.`,
      targetOrgIds: [issuerOrgId],
    },
  })

  return { invoiceId: input.invoiceId, paymentState: 'pending_verification', orderIds }
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
  const { ref, data } = await loadPartnerInvoice({
    invoiceId: input.invoiceId,
    orgId: input.issuerOrgId,
    side: 'issuer',
  })

  const now = FieldValue.serverTimestamp()
  const confirmed = input.decision === 'confirm'
  const paymentState: PartnerPaymentState = confirmed ? 'paid' : 'rejected'

  // Claim atomically so a double click cannot settle and then un-settle.
  const existing = await adminDb.runTransaction(async (tx) => {
    const fresh = await tx.get(ref)
    if (!fresh.exists) throw new Error('Invoice not found')
    const row = fresh.data() ?? {}
    if (cleanString(row.status) !== 'payment_pending_verification') {
      throw new Error('There is no payment awaiting verification on this invoice')
    }
    const prior = (row.partnerPayment ?? {}) as PartnerPaymentRecord
    tx.set(ref, stripUndefined({
      status: confirmed ? 'paid' : 'sent',
      paidAt: confirmed ? now : FieldValue.delete(),
      paymentRejectedAt: confirmed ? FieldValue.delete() : now,
      partnerPayment: {
        ...prior,
        decidedAt: now,
        decisionNote: cleanString(input.note) || undefined,
      },
      updatedByRef: input.actor,
      updatedAt: now,
    }), { merge: true })
    return prior
  })

  const tradeOrderId = cleanString(data.tradeOrderId)
  const orderIds = await syncOrdersPaymentState({
    tradeOrderId,
    paymentState,
    actor: input.actor,
  })

  const recipientOrgId = cleanString(data.recipientOrgId)
  await recordCrmAuditEvent({
    orgId: input.issuerOrgId,
    eventType: `partner_payment.${confirmed ? 'confirmed' : 'rejected'}`,
    resourceType: 'invoice',
    resourceId: input.invoiceId,
    actorRef: input.actor,
    metadata: { tradeOrderId, reference: existing.reference },
    notification: {
      type: `partner_payment.${confirmed ? 'confirmed' : 'rejected'}`,
      title: confirmed ? 'Your payment was confirmed' : 'Your payment could not be verified',
      body: confirmed
        ? `${cleanString(data.invoiceNumber) || 'An invoice'} is now settled.`
        : `${cleanString(data.invoiceNumber) || 'An invoice'} is still outstanding${cleanString(input.note) ? `: ${cleanString(input.note)}` : ''}.`,
      targetOrgIds: [recipientOrgId],
    },
  })

  return { invoiceId: input.invoiceId, paymentState, orderIds }
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
