import { adminDb } from '@/lib/firebase/admin'
import type { BusinessInsightSignal } from './review-evaluator'

type InvoiceDoc = {
  id: string
  data: () => Record<string, unknown>
}

type SourceLink = {
  type: string
  id?: string
  href?: string
  label: string
}

type EvidenceItem = {
  label: string
  value?: string | number
  href?: string
}

export type InvoiceBusinessMetric =
  | 'invoices_overdue_value'
  | 'invoice_payment_proofs_needing_review'
  | 'draft_invoices_waiting_to_send_value'
  | 'partially_paid_invoice_outstanding_value'

export type InvoiceBusinessMetricSnapshot = {
  metric: InvoiceBusinessMetric
  value: number
  capturedAt: string
  source: 'invoice-business-signals'
  sourceLinks: SourceLink[]
  evidence: EvidenceItem[]
}

export type CollectInvoiceBusinessInsightSignalsInput = {
  orgId: string
  existingSuppressionKeys?: string[]
  limit?: number
  now?: Date
}

export type CollectInvoiceBusinessInsightSignalsResult = {
  invoicesScanned: number
  metrics: InvoiceBusinessMetricSnapshot[]
  signals: BusinessInsightSignal[]
}

export type RefreshInvoiceBusinessInsightMetricInput = {
  orgId: string
  metric: string | null
  limit?: number
  now?: Date
}

type InvoiceRow = Record<string, unknown> & { id: string }

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function cleanNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function boundedLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 100
  return Math.max(1, Math.min(250, Math.floor(value)))
}

function normalizeDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? new Date(parsed) : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value)
  if (typeof value === 'object') {
    const timestamp = value as { toDate?: () => Date; toMillis?: () => number; seconds?: number; _seconds?: number }
    if (typeof timestamp.toDate === 'function') {
      try {
        return timestamp.toDate()
      } catch {
        return null
      }
    }
    if (typeof timestamp.toMillis === 'function') {
      try {
        return new Date(timestamp.toMillis())
      } catch {
        return null
      }
    }
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') return new Date(seconds * 1000)
  }
  return null
}

function daysSince(value: unknown, now: Date): number | null {
  const date = normalizeDate(value)
  if (!date) return null
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000)
}

function invoiceTotal(invoice: InvoiceRow): number {
  return cleanNumber(invoice.totalZar)
    ?? cleanNumber(invoice.total)
    ?? cleanNumber(invoice.amount)
    ?? cleanNumber(invoice.subtotal)
    ?? 0
}

function paidAmount(invoice: InvoiceRow): number {
  return cleanNumber(invoice.paidAmount)
    ?? cleanNumber(invoice.amountPaid)
    ?? cleanNumber(invoice.paymentAmount)
    ?? 0
}

function outstandingAmount(invoice: InvoiceRow): number {
  return Math.max(0, invoiceTotal(invoice) - paidAmount(invoice))
}

function invoiceLabel(invoice: InvoiceRow): string {
  return cleanString(invoice.invoiceNumber)
    ?? cleanString(invoice.recipientCompanyName)
    ?? cleanString(invoice.recipientName)
    ?? cleanString(invoice.recipientEmail)
    ?? invoice.id
}

function currencyLabel(invoices: InvoiceRow[]): string {
  return cleanString(invoices.find((invoice) => cleanString(invoice.currency))?.currency) ?? 'ZAR'
}

function status(invoice: InvoiceRow): string | null {
  return cleanString(invoice.status)
}

function isOverdue(invoice: InvoiceRow): boolean {
  return invoice.deleted !== true && status(invoice) === 'overdue'
}

function needsPaymentProofReview(invoice: InvoiceRow): boolean {
  return invoice.deleted !== true && status(invoice) === 'payment_pending_verification'
}

function isDraftWaiting(invoice: InvoiceRow): boolean {
  return invoice.deleted !== true && status(invoice) === 'draft' && invoiceTotal(invoice) > 0
}

function isPartiallyPaid(invoice: InvoiceRow): boolean {
  return invoice.deleted !== true && status(invoice) === 'partially_paid' && outstandingAmount(invoice) > 0
}

function sourceLinkForInvoice(invoice: InvoiceRow): SourceLink {
  return {
    type: 'invoice',
    id: invoice.id,
    href: `/admin/invoicing/${encodeURIComponent(invoice.id)}`,
    label: invoiceLabel(invoice),
  }
}

async function listInvoices(orgId: string, limit: number): Promise<InvoiceRow[]> {
  const snap = await adminDb.collection('invoices')
    .where('orgId', '==', orgId)
    .limit(limit)
    .get() as { docs: InvoiceDoc[] }
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as InvoiceRow)
    .filter((row) => row.deleted !== true)
}

function overdueMetric(invoices: InvoiceRow[], now: Date): InvoiceBusinessMetricSnapshot {
  const candidates = invoices.filter(isOverdue).sort((a, b) => invoiceTotal(b) - invoiceTotal(a))
  const value = candidates.reduce((sum, invoice) => sum + invoiceTotal(invoice), 0)
  const oldestAge = candidates
    .map((invoice) => daysSince(invoice.dueDate ?? invoice.updatedAt ?? invoice.createdAt, now))
    .filter((age): age is number => age !== null)
    .sort((a, b) => b - a)[0] ?? 0
  return {
    metric: 'invoices_overdue_value',
    value,
    capturedAt: now.toISOString(),
    source: 'invoice-business-signals',
    sourceLinks: candidates.slice(0, 5).map(sourceLinkForInvoice),
    evidence: [
      { label: 'Overdue invoices', value: candidates.length },
      { label: 'Overdue invoice value', value },
      { label: 'Currency', value: currencyLabel(candidates) },
      { label: 'Oldest overdue age days', value: oldestAge },
    ],
  }
}

function paymentProofMetric(invoices: InvoiceRow[], now: Date): InvoiceBusinessMetricSnapshot {
  const candidates = invoices
    .filter(needsPaymentProofReview)
    .sort((a, b) => (normalizeDate(a.paymentProofUploadedAt)?.getTime() ?? 0) - (normalizeDate(b.paymentProofUploadedAt)?.getTime() ?? 0))
  return {
    metric: 'invoice_payment_proofs_needing_review',
    value: candidates.length,
    capturedAt: now.toISOString(),
    source: 'invoice-business-signals',
    sourceLinks: candidates.slice(0, 5).map(sourceLinkForInvoice),
    evidence: [
      { label: 'Payment proofs needing review', value: candidates.length },
      { label: 'Value awaiting verification', value: candidates.reduce((sum, invoice) => sum + invoiceTotal(invoice), 0) },
      { label: 'Currency', value: currencyLabel(candidates) },
    ],
  }
}

function draftMetric(invoices: InvoiceRow[], now: Date): InvoiceBusinessMetricSnapshot {
  const candidates = invoices.filter(isDraftWaiting).sort((a, b) => invoiceTotal(b) - invoiceTotal(a))
  const value = candidates.reduce((sum, invoice) => sum + invoiceTotal(invoice), 0)
  const oldestAge = candidates
    .map((invoice) => daysSince(invoice.createdAt ?? invoice.updatedAt, now))
    .filter((age): age is number => age !== null)
    .sort((a, b) => b - a)[0] ?? 0
  return {
    metric: 'draft_invoices_waiting_to_send_value',
    value,
    capturedAt: now.toISOString(),
    source: 'invoice-business-signals',
    sourceLinks: candidates.slice(0, 5).map(sourceLinkForInvoice),
    evidence: [
      { label: 'Draft invoices waiting to send', value: candidates.length },
      { label: 'Draft invoice value', value },
      { label: 'Currency', value: currencyLabel(candidates) },
      { label: 'Oldest draft age days', value: oldestAge },
    ],
  }
}

function partialMetric(invoices: InvoiceRow[], now: Date): InvoiceBusinessMetricSnapshot {
  const candidates = invoices.filter(isPartiallyPaid).sort((a, b) => outstandingAmount(b) - outstandingAmount(a))
  const value = candidates.reduce((sum, invoice) => sum + outstandingAmount(invoice), 0)
  return {
    metric: 'partially_paid_invoice_outstanding_value',
    value,
    capturedAt: now.toISOString(),
    source: 'invoice-business-signals',
    sourceLinks: candidates.slice(0, 5).map(sourceLinkForInvoice),
    evidence: [
      { label: 'Partially-paid invoices needing follow-up', value: candidates.length },
      { label: 'Outstanding part-paid value', value },
      { label: 'Currency', value: currencyLabel(candidates) },
    ],
  }
}

function invoiceSignal(input: {
  orgId: string
  metric: InvoiceBusinessMetricSnapshot
  existingSuppressionKeys: Set<string>
}): BusinessInsightSignal | null {
  if (input.metric.value <= 0) return null

  const configs: Record<InvoiceBusinessMetric, {
    suppressionKey: string
    insightKind: BusinessInsightSignal['insightKind']
    summary: string
    impactEstimate: string
    impact: number
    urgency: number
    confidence: number
    actionability: number
    risk: number
    nextAction: string
  }> = {
    invoices_overdue_value: {
      suppressionKey: `invoice:overdue-value:${input.orgId}`,
      insightKind: 'risk',
      summary: `${input.metric.value} overdue invoice value needs finance review`,
      impactEstimate: 'Cash-flow and client-account risk from overdue invoices',
      impact: Math.min(96, 78 + Math.round(input.metric.value / 10_000)),
      urgency: 92,
      confidence: 88,
      actionability: 84,
      risk: 34,
      nextAction: 'Review overdue invoices and create internal finance follow-up. Do not send client-visible payment communication or change invoice state without explicit approval.',
    },
    invoice_payment_proofs_needing_review: {
      suppressionKey: `invoice:payment-proof-review:${input.orgId}`,
      insightKind: 'follow-up-gap',
      summary: `${input.metric.value} invoice payment proof${input.metric.value === 1 ? ' needs' : 's need'} review`,
      impactEstimate: 'Revenue-recognition and customer-account risk from unverified payment proofs',
      impact: Math.min(88, 68 + input.metric.value * 7),
      urgency: 88,
      confidence: 86,
      actionability: 88,
      risk: 26,
      nextAction: 'Review uploaded payment proofs and create an internal verification task. Do not mark invoices paid or notify clients without the finance approval gate.',
    },
    draft_invoices_waiting_to_send_value: {
      suppressionKey: `invoice:drafts-waiting:${input.orgId}`,
      insightKind: 'stale-work',
      summary: `${input.metric.value} draft invoice value is waiting to send`,
      impactEstimate: 'Revenue collection delay from approved billing work left in draft',
      impact: Math.min(90, 64 + Math.round(input.metric.value / 10_000)),
      urgency: 76,
      confidence: 82,
      actionability: 82,
      risk: 24,
      nextAction: 'Review draft invoices, confirm billing readiness, and create an internal send-prep task. Do not send or expose invoice links without finance/client-visible approval.',
    },
    partially_paid_invoice_outstanding_value: {
      suppressionKey: `invoice:partially-paid-outstanding:${input.orgId}`,
      insightKind: 'follow-up-gap',
      summary: `${input.metric.value} outstanding value remains on partially-paid invoices`,
      impactEstimate: 'Cash-flow risk from part-paid invoices without a clear settlement follow-up',
      impact: Math.min(92, 70 + Math.round(input.metric.value / 10_000)),
      urgency: 84,
      confidence: 84,
      actionability: 82,
      risk: 28,
      nextAction: 'Review partially-paid invoices, confirm outstanding balances, and create internal follow-up work before any external finance communication.',
    },
  }

  const config = configs[input.metric.metric]
  return {
    id: `${input.metric.metric.replace(/_/g, '-')}-${input.orgId}`,
    lane: 'invoice',
    insightKind: config.insightKind,
    summary: config.summary,
    impactEstimate: config.impactEstimate,
    metric: input.metric.metric,
    value: input.metric.value,
    impact: config.impact,
    urgency: config.urgency,
    confidence: config.confidence,
    actionability: config.actionability,
    risk: config.risk,
    ownerAgentId: 'pip',
    ownerRole: 'finance',
    approvalGate: 'finance',
    nextAction: config.nextAction,
    suppressionKey: config.suppressionKey,
    sourceLinks: input.metric.sourceLinks,
    evidence: input.metric.evidence,
    blocksActiveCommercialLoop: true,
    hasNewSourceItem: !input.existingSuppressionKeys.has(config.suppressionKey),
  }
}

export async function collectInvoiceBusinessInsightSignals(
  input: CollectInvoiceBusinessInsightSignalsInput,
): Promise<CollectInvoiceBusinessInsightSignalsResult> {
  const limit = boundedLimit(input.limit)
  const now = input.now ?? new Date()
  const existingSuppressionKeys = new Set(input.existingSuppressionKeys ?? [])
  const invoices = await listInvoices(input.orgId, limit)
  const metrics = [
    overdueMetric(invoices, now),
    paymentProofMetric(invoices, now),
    draftMetric(invoices, now),
    partialMetric(invoices, now),
  ]
  const signals = metrics
    .map((metric) => invoiceSignal({ orgId: input.orgId, metric, existingSuppressionKeys }))
    .filter((signal): signal is BusinessInsightSignal => Boolean(signal))

  return {
    invoicesScanned: invoices.length,
    metrics,
    signals,
  }
}

export async function refreshInvoiceBusinessInsightMetric(
  input: RefreshInvoiceBusinessInsightMetricInput,
): Promise<InvoiceBusinessMetricSnapshot | null> {
  const metric = cleanString(input.metric)
  if (
    metric !== 'invoices_overdue_value' &&
    metric !== 'invoice_payment_proofs_needing_review' &&
    metric !== 'draft_invoices_waiting_to_send_value' &&
    metric !== 'partially_paid_invoice_outstanding_value'
  ) {
    return null
  }

  const collection = await collectInvoiceBusinessInsightSignals({
    orgId: input.orgId,
    limit: input.limit,
    now: input.now,
  })
  return collection.metrics.find((snapshot) => snapshot.metric === metric) ?? null
}
