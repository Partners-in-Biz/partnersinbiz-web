import crypto from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import { recordCrmAuditEvent } from '@/lib/crm/audit'
import { PARTNER_AUDIT_EVENTS_COLLECTION, PARTNER_LINKS_COLLECTION, PARTNER_SCOPE_AGREEMENTS_COLLECTION } from '@/lib/cross-org/types'
import type { PartnerLink, PartnerScopeAgreement } from '@/lib/cross-org/types'
import { cleanString } from './identity'
import {
  resolveSettlementIdempotency,
  type SettlementOperation,
  type StoredSettlementOperation,
  validateCanonicalSettlementAuthority,
  validateCanonicalSettlementPair,
} from './settlement-contract'

/**
 * Settlement of a partner invoice, org to org. This module is deliberately
 * fail-closed: CRM linkedOrgId/allowedOrgIds and loose active-relationship
 * lookups are never authority. A canonical invoice binding, a reciprocal pair,
 * and a directional active invoices capability are required in one transaction.
 */
export const INVOICES_COLLECTION = 'invoices'
export const ORDERS_COLLECTION = 'orders'

export type PartnerPaymentState = 'unpaid' | 'pending_verification' | 'paid' | 'rejected'

export interface PartnerPaymentOperation extends StoredSettlementOperation {
  operation: SettlementOperation
  idempotencyKey: string
  fingerprint: string
  resultState: PartnerPaymentState
  appliedAt?: unknown
}

export interface PartnerPaymentRecord {
  reference?: string
  amount?: number
  fileId?: string
  note?: string
  submittedByOrgId?: string
  submittedAt?: unknown
  decidedAt?: unknown
  decisionNote?: string
  operations?: Record<string, PartnerPaymentOperation>
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
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

function paymentStateOf(invoice: Record<string, unknown>): PartnerPaymentState {
  const status = cleanString(invoice.status)
  if (status === 'paid') return 'paid'
  if (status === 'payment_pending_verification') return 'pending_verification'
  if (hasValue(invoice.paymentRejectedAt)) return 'rejected'
  return 'unpaid'
}

function requireIdempotencyKey(value: unknown): string {
  const key = cleanString(value)
  if (!key) throw new Error('Idempotency-Key is required for partner settlement')
  if (key.length > 200) throw new Error('Idempotency-Key is too long')
  return key
}

function fingerprint(value: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function paymentOperations(value: unknown): Record<string, PartnerPaymentOperation> {
  if (!value || typeof value !== 'object') return {}
  return value as Record<string, PartnerPaymentOperation>
}

function operationStorageKey(idempotencyKey: string): string {
  return crypto.createHash('sha256').update(idempotencyKey).digest('hex')
}

function operationForKey(
  operations: Record<string, PartnerPaymentOperation>,
  key: string,
): PartnerPaymentOperation | undefined {
  return Object.values(operations).find((operation) => cleanString(operation?.idempotencyKey) === key)
}

function auditRefFor(invoiceId: string, operation: SettlementOperation, idempotencyKey: string) {
  const keyDigest = crypto.createHash('sha256').update(idempotencyKey).digest('hex')
  return adminDb.collection(PARTNER_AUDIT_EVENTS_COLLECTION).doc(`settlement:${invoiceId}:${operation}:${keyDigest}`)
}

/**
 * Hydrate and validate every settlement authority input under the same
 * transaction snapshot that later writes payment state. The scope agreement is
 * directional issuer -> recipient: it is the issuer granting this specific
 * counterparty invoice/settlement capability, not a broad CRM relationship.
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
  issuerOrgId: string
  recipientOrgId: string
  scopeAgreementId: string
}> {
  const ref = adminDb.collection(INVOICES_COLLECTION).doc(input.invoiceId)
  const invoiceSnap = await input.tx.get(ref)
  if (!invoiceSnap.exists) throw new Error('Invoice not found')
  const data = invoiceSnap.data() ?? {}

  // issuerOrgId is mandatory. sourceOrgId is intentionally never a fallback.
  const issuerOrgId = cleanString(data.issuerOrgId)
  const recipientOrgId = cleanString(data.recipientOrgId)
  const expectedOrgId = input.side === 'issuer' ? issuerOrgId : recipientOrgId
  if (!expectedOrgId || expectedOrgId !== input.orgId) throw new Error('Invoice not found')

  const tradeOrderId = cleanString(data.tradeOrderId)
  const partnerLinkId = cleanString(data.partnerLinkId)
  if (!tradeOrderId || !partnerLinkId) throw new Error('This is not a canonical partner invoice')

  const [orderSnap, relationshipSnap, partnerLinkSnap, scopeSnap] = await Promise.all([
    input.tx.get(adminDb.collection(ORDERS_COLLECTION).where('tradeOrderId', '==', tradeOrderId).limit(10)),
    input.tx.get(adminDb.collection('businessRelationships').where('partnerLinkId', '==', partnerLinkId).limit(10)),
    input.tx.get(adminDb.collection(PARTNER_LINKS_COLLECTION).doc(partnerLinkId)),
    input.tx.get(adminDb.collection(PARTNER_SCOPE_AGREEMENTS_COLLECTION).where('partnerLinkId', '==', partnerLinkId).limit(20)),
  ])

  const orderDocs = orderSnap.docs
  const pair = validateCanonicalSettlementPair({
    invoice: data,
    orders: orderDocs.map((doc) => ({ id: doc.id, ...(doc.data() ?? {}) })),
    relationships: relationshipSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() ?? {}) })),
  })

  const scope = scopeSnap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() ?? {}) }) as PartnerScopeAgreement)
    .find((candidate) =>
      cleanString(candidate.partnerLinkId) === partnerLinkId &&
      cleanString(candidate.direction?.grantorOrgId) === issuerOrgId &&
      cleanString(candidate.direction?.granteeOrgId) === recipientOrgId,
    )
  const authority = validateCanonicalSettlementAuthority({
    pair,
    link: partnerLinkSnap.exists ? ({ id: partnerLinkSnap.id, ...(partnerLinkSnap.data() ?? {}) } as PartnerLink) : null,
    scope,
  })

  return {
    ref,
    data,
    orderDocs,
    partnerLinkId,
    tradeOrderId,
    issuerOrgId,
    recipientOrgId,
    scopeAgreementId: authority.scopeAgreementId,
  }
}

function assertFullInvoiceAmount(amount: number | undefined, invoice: Record<string, unknown>): number {
  const total = Number(invoice.total)
  if (!Number.isFinite(total) || total <= 0) throw new Error('Invoice total is invalid for settlement')
  if (amount === undefined) throw new Error('Payment amount is required for partner settlement')
  if (Math.abs(amount - total) > 0.005) throw new Error('Payment amount must exactly settle the invoice total')
  return amount
}

/** Buyer notices an EFT payment. Exact retries return the original result. */
export async function recordPartnerPayment(input: {
  payerOrgId: string
  invoiceId: string
  reference?: string
  amount?: number
  fileId?: string
  note?: string
  idempotencyKey: string
  actor: MemberRef
}): Promise<{ invoiceId: string; paymentState: PartnerPaymentState; orderIds: string[]; idempotent: boolean; reconciliationKey: string }> {
  const reference = cleanString(input.reference)
  const fileId = cleanString(input.fileId)
  if (!reference && !fileId) throw new Error('Provide a payment reference or attach proof of payment')
  const amount = typeof input.amount === 'number' && Number.isFinite(input.amount) && input.amount > 0 ? input.amount : undefined
  const idempotencyKey = requireIdempotencyKey(input.idempotencyKey)
  const requestFingerprint = fingerprint({ operation: 'notice', payerOrgId: input.payerOrgId, reference, fileId, amount, note: cleanString(input.note) })
  const now = FieldValue.serverTimestamp()

  const outcome = await adminDb.runTransaction(async (tx) => {
    const loaded = await loadPartnerInvoiceTx({ tx, invoiceId: input.invoiceId, orgId: input.payerOrgId, side: 'recipient' })
    const existing = (loaded.data.partnerPayment ?? {}) as PartnerPaymentRecord
    const operations = paymentOperations(existing.operations)
    const replay = resolveSettlementIdempotency(operationForKey(operations, idempotencyKey), {
      operation: 'notice', idempotencyKey, fingerprint: requestFingerprint,
    })
    const orderIds = loaded.orderDocs.map((doc) => doc.id)
    const reconciliationKey = `settlement:${input.invoiceId}:notice:${idempotencyKey}`
    if (replay.replay) {
      return { ...loaded, orderIds, reconciliationKey, idempotent: true, applied: false }
    }

    const status = cleanString(loaded.data.status)
    if (status === 'paid') throw new Error('This invoice is already settled')
    if (status === 'payment_pending_verification') throw new Error('A payment is already awaiting verification on this invoice')
    if (status === 'cancelled' || status === 'void') throw new Error('This invoice is closed')
    const settledAmount = assertFullInvoiceAmount(amount, loaded.data)

    const operation: PartnerPaymentOperation = {
      operation: 'notice', idempotencyKey, fingerprint: requestFingerprint,
      resultState: 'pending_verification', appliedAt: now,
    }
    const payment: PartnerPaymentRecord = {
      ...existing,
      reference: reference || undefined,
      amount: settledAmount,
      fileId: fileId || undefined,
      note: cleanString(input.note) || undefined,
      submittedByOrgId: input.payerOrgId,
      submittedAt: now,
      operations: { ...operations, [operationStorageKey(idempotencyKey)]: operation },
    }
    tx.set(loaded.ref, stripUndefined({
      status: 'payment_pending_verification', partnerPayment: payment,
      paymentProofFileId: fileId || undefined, paymentRejectedAt: FieldValue.delete(),
      updatedByRef: input.actor, updatedAt: now,
    }), { merge: true })
    for (const doc of loaded.orderDocs) {
      tx.set(doc.ref, { paymentState: 'pending_verification', updatedByRef: input.actor, updatedAt: now }, { merge: true })
    }
    tx.create(auditRefFor(input.invoiceId, 'notice', idempotencyKey), {
      eventType: 'settlement.approved', decision: 'applied', actorRef: input.actor,
      actorOrgId: input.payerOrgId, partnerLinkId: loaded.partnerLinkId, scopeAgreementId: loaded.scopeAgreementId,
      resourceType: 'invoice', resourceId: input.invoiceId, reconciliationKey,
      metadata: { operation: 'notice', tradeOrderId: loaded.tradeOrderId, amount: settledAmount, reference },
      createdAt: now,
    })
    return { ...loaded, orderIds, reconciliationKey, idempotent: false, applied: true }
  })

  if (outcome.applied) {
    // Finance reconciliation evidence was committed atomically above. CRM audit
    // and notifications are advisory fan-out: never turn a committed payment
    // transition into a failed client response or undermine idempotent replay.
    void recordCrmAuditEvent({
      orgId: input.payerOrgId, eventType: 'partner_payment.submitted', resourceType: 'invoice', resourceId: input.invoiceId,
      actorRef: input.actor, metadata: { tradeOrderId: outcome.tradeOrderId, reference, amount },
      notification: {
        type: 'partner_payment.submitted', title: 'A partner marked an invoice as paid',
        body: `${cleanString(outcome.data.invoiceNumber) || 'An invoice'} has a payment awaiting your verification${reference ? ` (ref ${reference})` : ''}.`,
        targetOrgIds: [outcome.issuerOrgId],
      },
    }).catch((err) => console.error('[partner-settlement-crm-audit-error]', err))
  }
  return { invoiceId: input.invoiceId, paymentState: 'pending_verification', orderIds: outcome.orderIds, idempotent: outcome.idempotent, reconciliationKey: outcome.reconciliationKey }
}

/** Supplier confirms or disputes a payment. Exact retries are idempotent. */
export async function decidePartnerPayment(input: {
  issuerOrgId: string
  invoiceId: string
  decision: 'confirm' | 'reject'
  note?: string
  idempotencyKey: string
  actor: MemberRef
}): Promise<{ invoiceId: string; paymentState: PartnerPaymentState; orderIds: string[]; idempotent: boolean; reconciliationKey: string }> {
  if (input.actor.kind !== 'human') throw new Error('A human finance approver is required to verify or dispute a partner payment')
  const operationName: SettlementOperation = input.decision === 'confirm' ? 'confirm' : 'dispute'
  const paymentState: PartnerPaymentState = input.decision === 'confirm' ? 'paid' : 'rejected'
  const idempotencyKey = requireIdempotencyKey(input.idempotencyKey)
  const note = cleanString(input.note)
  const requestFingerprint = fingerprint({ operation: operationName, issuerOrgId: input.issuerOrgId, note })
  const now = FieldValue.serverTimestamp()

  const outcome = await adminDb.runTransaction(async (tx) => {
    const loaded = await loadPartnerInvoiceTx({ tx, invoiceId: input.invoiceId, orgId: input.issuerOrgId, side: 'issuer' })
    const existing = (loaded.data.partnerPayment ?? {}) as PartnerPaymentRecord
    const operations = paymentOperations(existing.operations)
    const replay = resolveSettlementIdempotency(operationForKey(operations, idempotencyKey), {
      operation: operationName, idempotencyKey, fingerprint: requestFingerprint,
    })
    const orderIds = loaded.orderDocs.map((doc) => doc.id)
    const reconciliationKey = `settlement:${input.invoiceId}:${operationName}:${idempotencyKey}`
    if (replay.replay) return { ...loaded, orderIds, reconciliationKey, idempotent: true, applied: false }

    if (cleanString(loaded.data.status) !== 'payment_pending_verification') {
      throw new Error('There is no payment awaiting verification on this invoice')
    }
    const decision: PartnerPaymentOperation = {
      operation: operationName, idempotencyKey, fingerprint: requestFingerprint, resultState: paymentState, appliedAt: now,
    }
    tx.set(loaded.ref, stripUndefined({
      status: input.decision === 'confirm' ? 'paid' : 'sent',
      paidAt: input.decision === 'confirm' ? now : FieldValue.delete(),
      paymentRejectedAt: input.decision === 'confirm' ? FieldValue.delete() : now,
      partnerPayment: { ...existing, decidedAt: now, decisionNote: note || undefined, operations: { ...operations, [operationStorageKey(idempotencyKey)]: decision } },
      updatedByRef: input.actor, updatedAt: now,
    }), { merge: true })
    for (const doc of loaded.orderDocs) {
      tx.set(doc.ref, { paymentState, updatedByRef: input.actor, updatedAt: now }, { merge: true })
    }
    tx.create(auditRefFor(input.invoiceId, operationName, idempotencyKey), {
      eventType: 'settlement.approved', decision: 'applied', actorRef: input.actor,
      actorOrgId: input.issuerOrgId, partnerLinkId: loaded.partnerLinkId, scopeAgreementId: loaded.scopeAgreementId,
      resourceType: 'invoice', resourceId: input.invoiceId, reconciliationKey,
      metadata: { operation: operationName, tradeOrderId: loaded.tradeOrderId, reference: existing.reference, note: note || undefined },
      createdAt: now,
    })
    return { ...loaded, orderIds, reconciliationKey, idempotent: false, applied: true }
  })

  if (outcome.applied) {
    // Finance reconciliation evidence was committed atomically above. CRM audit
    // and notifications are advisory fan-out: never turn a committed payment
    // transition into a failed client response or undermine idempotent replay.
    void recordCrmAuditEvent({
      orgId: input.issuerOrgId, eventType: `partner_payment.${input.decision === 'confirm' ? 'confirmed' : 'rejected'}`,
      resourceType: 'invoice', resourceId: input.invoiceId, actorRef: input.actor,
      metadata: { tradeOrderId: outcome.tradeOrderId, reference: (outcome.data.partnerPayment as PartnerPaymentRecord | undefined)?.reference },
      notification: {
        type: `partner_payment.${input.decision === 'confirm' ? 'confirmed' : 'rejected'}`,
        title: input.decision === 'confirm' ? 'Your payment was confirmed' : 'Your payment could not be verified',
        body: input.decision === 'confirm'
          ? `${cleanString(outcome.data.invoiceNumber) || 'An invoice'} is now settled.`
          : `${cleanString(outcome.data.invoiceNumber) || 'An invoice'} is still outstanding${note ? `: ${note}` : ''}.`,
        targetOrgIds: [outcome.recipientOrgId],
      },
    }).catch((err) => console.error('[partner-settlement-crm-audit-error]', err))
  }
  return { invoiceId: input.invoiceId, paymentState, orderIds: outcome.orderIds, idempotent: outcome.idempotent, reconciliationKey: outcome.reconciliationKey }
}

/** Partner invoice books. Legacy/loosely-linked invoices are intentionally hidden. */
export async function listPartnerSettlements(orgId: string): Promise<{ receivable: PartnerInvoiceSummary[]; payable: PartnerInvoiceSummary[] }> {
  const [issuedSnap, receivedSnap] = await Promise.all([
    adminDb.collection(INVOICES_COLLECTION).where('orgId', '==', orgId).limit(1000).get(),
    adminDb.collection(INVOICES_COLLECTION).where('recipientOrgId', '==', orgId).limit(1000).get(),
  ])
  const isCanonicalPartnerInvoice = (data: Record<string, unknown>) =>
    data.deleted !== true && cleanString(data.orgId) && cleanString(data.issuerOrgId) === cleanString(data.orgId) &&
    cleanString(data.recipientOrgId) && cleanString(data.tradeOrderId) && cleanString(data.partnerLinkId) &&
    cleanString(data.supplierOrderId) && cleanString(data.buyerOrderId) && cleanString(data.tradeTermsHash)
  const summary = (id: string, data: Record<string, unknown>): PartnerInvoiceSummary => ({
    id, invoiceNumber: cleanString(data.invoiceNumber) || undefined, issuerOrgId: cleanString(data.issuerOrgId),
    recipientOrgId: cleanString(data.recipientOrgId), status: cleanString(data.status), paymentState: paymentStateOf(data),
    total: Number(data.total) || 0, currency: cleanString(data.currency) || 'ZAR', tradeOrderId: cleanString(data.tradeOrderId) || undefined,
    partnerPayment: (data.partnerPayment ?? undefined) as PartnerPaymentRecord | undefined, createdAt: data.createdAt,
  })
  return {
    receivable: issuedSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() ?? {} }))
      .filter(({ data }) => isCanonicalPartnerInvoice(data) && cleanString(data.recipientOrgId) !== orgId).map(({ id, data }) => summary(id, data)),
    payable: receivedSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() ?? {} }))
      .filter(({ data }) => isCanonicalPartnerInvoice(data)).map(({ id, data }) => summary(id, data)),
  }
}
