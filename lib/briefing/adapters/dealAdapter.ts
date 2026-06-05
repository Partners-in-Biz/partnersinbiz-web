import type { BriefingPriority, BriefingSourceAdapter } from '../types'
import { extractMultiFieldExcerpt, extractOrgId, hashSourceDocument, normalizeTimestamp } from '../utils'

interface DealDocument extends Record<string, unknown> {
  orgId?: string | null
  title?: string | null
  name?: string | null
  value?: number | null
  amount?: number | null
  currency?: string | null
  pipelineId?: string | null
  stageId?: string | null
  stageLabel?: string | null
  stageName?: string | null
  stageKind?: string | null
  stage?: string | null
  probability?: number | null
  contactId?: string | null
  companyId?: string | null
  companyName?: string | null
  expectedCloseDate?: unknown
  closeDate?: unknown
  lastActivityAt?: unknown
  lastContactedAt?: unknown
  updatedAt?: unknown
  createdAt?: unknown
  notes?: string | null
  deleted?: boolean | null
}

type DealSignal = 'proposal-follow-up' | 'stale-deal' | 'hot-deal' | 'no-touch-warning' | 'next-action'

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function iso(value: unknown): string | null {
  return normalizeTimestamp(value)?.toISOString() ?? null
}

function dateLabel(value: unknown): string | null {
  return iso(value)?.slice(0, 10) ?? null
}

function daysSince(value: unknown): number | null {
  const timestamp = normalizeTimestamp(value)
  if (!timestamp) return null
  return Math.floor((Date.now() - timestamp.getTime()) / 86_400_000)
}

function isPast(value: unknown): boolean {
  const timestamp = normalizeTimestamp(value)
  return Boolean(timestamp && timestamp.getTime() < Date.now())
}

function dealTitle(doc: DealDocument, docId: string): string {
  return clean(doc.title) ?? clean(doc.name) ?? docId
}

function stageLabel(doc: DealDocument): string | null {
  return clean(doc.stageLabel) ?? clean(doc.stageName) ?? clean(doc.stage)
}

function stageKind(doc: DealDocument): string | null {
  return clean(doc.stageKind)?.toLowerCase() ?? null
}

function valueAmount(doc: DealDocument): number | null {
  return numberValue(doc.value) ?? numberValue(doc.amount)
}

function money(amount: unknown, currency: unknown): string | null {
  const value = numberValue(amount)
  if (value === null) return null
  const code = clean(currency) ?? 'ZAR'
  const symbol = code === 'ZAR' ? 'R' : code === 'USD' ? '$' : code === 'EUR' ? '€' : `${code} `
  return `${symbol}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function activityDate(doc: DealDocument): unknown {
  return doc.lastActivityAt ?? doc.lastContactedAt ?? doc.updatedAt
}

function dealSignal(doc: DealDocument): DealSignal {
  const label = stageLabel(doc)?.toLowerCase() ?? ''
  const probability = numberValue(doc.probability) ?? 0
  const value = valueAmount(doc) ?? 0
  const activityAge = daysSince(activityDate(doc))

  if (label.includes('proposal')) return 'proposal-follow-up'
  if (activityAge === null) return 'no-touch-warning'
  if (activityAge >= 21 || isPast(doc.expectedCloseDate ?? doc.closeDate)) return 'stale-deal'
  if (probability >= 70 || value >= 100_000) return 'hot-deal'
  return 'next-action'
}

function nextAction(signal: DealSignal): string {
  switch (signal) {
    case 'proposal-follow-up':
      return 'Review the proposal state and create an internal follow-up task; do not send externally without approval.'
    case 'stale-deal':
      return 'Review the deal owner, last touch, and close plan before the opportunity cools further.'
    case 'hot-deal':
      return 'Confirm the next meeting or proposal step while the opportunity is warm.'
    case 'no-touch-warning':
      return 'Assign an internal owner to inspect the deal and record the next safe action.'
    default:
      return 'Decide the next internal sales action and keep CRM changes approval-gated.'
  }
}

function titlePrefix(signal: DealSignal): string {
  switch (signal) {
    case 'proposal-follow-up': return 'Proposal follow-up'
    case 'stale-deal': return 'Stale deal'
    case 'hot-deal': return 'Hot deal'
    case 'no-touch-warning': return 'No-touch deal'
    default: return 'Deal next action'
  }
}

export const dealAdapter: BriefingSourceAdapter<DealDocument> = {
  sourceType: 'deal',
  collectionPath: 'deals',

  hashSource(doc: DealDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['title', 'value', 'currency', 'pipelineId', 'stageId', 'stageLabel', 'stageKind', 'probability', 'expectedCloseDate', 'lastActivityAt', 'lastContactedAt', 'updatedAt'])
  },

  shouldGenerate(doc: DealDocument): boolean {
    if (doc.deleted === true) return false
    const kind = stageKind(doc)
    if (kind === 'won' || kind === 'lost') return false
    const label = stageLabel(doc)?.toLowerCase() ?? ''
    if (label.includes('won') || label.includes('lost')) return false
    if (!clean(doc.orgId) && !extractOrgId(doc)) return false
    return dealSignal(doc) !== 'next-action'
  },

  extractPriority(doc: DealDocument): BriefingPriority {
    const signal = dealSignal(doc)
    if (signal === 'stale-deal' || signal === 'no-touch-warning') return 'client-risk'
    if (signal === 'proposal-follow-up' || signal === 'hot-deal') return 'needs-peet'
    return 'fyi'
  },

  extractActor() {
    return { id: 'system', name: 'CRM revenue intelligence', role: 'system' as const, type: 'system' as const }
  },

  extractContext(doc: DealDocument, docId: string) {
    return {
      orgId: clean(doc.orgId) ?? extractOrgId(doc) ?? '',
      dealId: docId,
      dealTitle: dealTitle(doc, docId),
      contactId: clean(doc.contactId),
      companyId: clean(doc.companyId),
      companyName: clean(doc.companyName),
    }
  },

  extractTitle(doc: DealDocument, docId: string): string {
    const signal = dealSignal(doc)
    return `${titlePrefix(signal)}: ${dealTitle(doc, docId)}`
  },

  extractSummary(doc: DealDocument, docId: string): string {
    const signal = dealSignal(doc)
    const parts: string[] = []
    const title = dealTitle(doc, docId)
    const amount = money(valueAmount(doc), doc.currency)
    const label = stageLabel(doc)
    const lastTouch = dateLabel(activityDate(doc))
    const closeDate = dateLabel(doc.expectedCloseDate ?? doc.closeDate)

    if (signal === 'proposal-follow-up') parts.push(`Proposal-stage deal needs follow-up: ${title}`)
    else if (signal === 'stale-deal') parts.push(`Stale deal needs review: ${title}`)
    else if (signal === 'hot-deal') parts.push(`High-intent deal is ready for the next action: ${title}`)
    else if (signal === 'no-touch-warning') parts.push(`Deal has no recorded sales touchpoint: ${title}`)
    else parts.push(`Deal needs next-action review: ${title}`)

    if (amount) parts.push(`Value: ${amount}`)
    if (label) parts.push(`Stage: ${label}`)
    if (typeof doc.probability === 'number') parts.push(`Probability: ${doc.probability}%`)
    if (lastTouch) parts.push(`Last touch: ${lastTouch}`)
    if (closeDate) parts.push(`Expected close: ${closeDate}`)
    parts.push(`Next action: ${nextAction(signal)}`)
    return parts.join('. ')
  },

  extractExcerpt(doc: DealDocument, docId: string, maxLength = 300): string | null {
    const summary = this.extractSummary(doc, docId)
    return extractMultiFieldExcerpt({ summary, notes: doc.notes }, ['summary', 'notes'], { maxLength })
  },

  extractOccurredAt(doc: DealDocument): Date | null {
    return normalizeTimestamp(activityDate(doc)) ?? normalizeTimestamp(doc.createdAt) ?? normalizeTimestamp(doc.expectedCloseDate)
  },

  extractMetadata(doc: DealDocument): Record<string, unknown> | null {
    const signal = dealSignal(doc)
    return {
      revenueSignal: signal,
      nextAction: nextAction(signal),
      value: valueAmount(doc),
      currency: clean(doc.currency),
      pipelineId: clean(doc.pipelineId),
      stageId: clean(doc.stageId),
      stageLabel: stageLabel(doc),
      stageKind: stageKind(doc),
      probability: numberValue(doc.probability),
      expectedCloseDate: iso(doc.expectedCloseDate ?? doc.closeDate),
      lastActivityAt: iso(doc.lastActivityAt),
      lastContactedAt: iso(doc.lastContactedAt),
      contactId: clean(doc.contactId),
      companyId: clean(doc.companyId),
      companyName: clean(doc.companyName),
    }
  },

  toItem(doc: DealDocument, docId: string) {
    const occurredAt = this.extractOccurredAt(doc, docId) ?? new Date()
    return {
      orgId: clean(doc.orgId) ?? extractOrgId(doc) ?? '',
      source: {
        type: this.sourceType,
        id: docId,
        collectionPath: this.collectionPath,
        url: `/admin/crm/deals/${encodeURIComponent(docId)}`,
      },
      priority: this.extractPriority(doc, docId),
      status: 'new',
      title: this.extractTitle(doc, docId),
      summary: this.extractSummary(doc, docId),
      excerpt: this.extractExcerpt(doc, docId),
      actor: this.extractActor(doc, docId),
      context: this.extractContext(doc, docId),
      occurredAt,
      sourceHash: this.hashSource(doc, docId),
      metadata: this.extractMetadata?.(doc, docId),
      createdAt: occurredAt,
      updatedAt: occurredAt,
    }
  },
}
