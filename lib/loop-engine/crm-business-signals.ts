import { adminDb } from '@/lib/firebase/admin'
import type { BusinessInsightSignal } from './review-evaluator'

type CrmDoc = {
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

export type CrmBusinessMetric = 'unowned_high_intent_leads' | 'stale_open_deals'

export type CrmBusinessMetricSnapshot = {
  metric: CrmBusinessMetric
  value: number
  capturedAt: string
  source: 'crm-business-signals'
  sourceLinks: SourceLink[]
  evidence: EvidenceItem[]
}

export type CollectCrmBusinessInsightSignalsInput = {
  orgId: string
  existingSuppressionKeys?: string[]
  limit?: number
  now?: Date
}

export type CollectCrmBusinessInsightSignalsResult = {
  contactsScanned: number
  dealsScanned: number
  metrics: CrmBusinessMetricSnapshot[]
  signals: BusinessInsightSignal[]
}

export type RefreshCrmBusinessInsightMetricInput = {
  orgId: string
  metric: string | null
  limit?: number
  now?: Date
}

type ContactRow = Record<string, unknown> & { id: string }
type DealRow = Record<string, unknown> & { id: string }

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

function isPast(value: unknown, now: Date): boolean {
  const date = normalizeDate(value)
  return Boolean(date && date.getTime() < now.getTime())
}

function memberRefUid(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return cleanString((value as Record<string, unknown>).uid)
}

function contactOwnerUid(contact: ContactRow): string | null {
  return cleanString(contact.assignedTo) ?? memberRefUid(contact.assignedToRef)
}

function contactLabel(contact: ContactRow): string {
  return cleanString(contact.name) ?? cleanString(contact.email) ?? contact.id
}

function dealLabel(deal: DealRow): string {
  return cleanString(deal.title) ?? cleanString(deal.name) ?? deal.id
}

function companyLabel(row: Record<string, unknown>): string | null {
  return cleanString(row.companyName) ?? cleanString(row.company)
}

function bestContactScore(contact: ContactRow): number {
  return Math.max(
    cleanNumber(contact.leadScore) ?? 0,
    cleanNumber(contact.icpScore) ?? 0,
    cleanNumber(contact.aiLeadScore) ?? 0,
  )
}

function isActiveLead(contact: ContactRow): boolean {
  if (contact.deleted === true) return false
  const type = cleanString(contact.type)?.toLowerCase()
  const stage = cleanString(contact.stage)?.toLowerCase()
  if (type === 'churned' || stage === 'lost' || stage === 'won') return false
  return type === 'lead' || type === 'prospect'
}

function isUnownedHighIntentLead(contact: ContactRow): boolean {
  return isActiveLead(contact) && bestContactScore(contact) >= 80 && !contactOwnerUid(contact)
}

function stageLabel(deal: DealRow): string | null {
  return cleanString(deal.stageLabel) ?? cleanString(deal.stageName) ?? cleanString(deal.stage)
}

function stageKind(deal: DealRow): string | null {
  return cleanString(deal.stageKind)?.toLowerCase() ?? null
}

function dealValue(deal: DealRow): number {
  return cleanNumber(deal.value) ?? cleanNumber(deal.amount) ?? 0
}

function isOpenDeal(deal: DealRow): boolean {
  if (deal.deleted === true) return false
  if (cleanString(deal.lostReason)) return false
  if ((cleanNumber(deal.probability) ?? 0) >= 100) return false
  const kind = stageKind(deal)
  if (kind === 'won' || kind === 'lost') return false
  const label = stageLabel(deal)?.toLowerCase() ?? ''
  return !label.includes('won') && !label.includes('lost')
}

function dealActivityDate(deal: DealRow): unknown {
  return deal.lastActivityAt ?? deal.lastContactedAt ?? deal.updatedAt
}

function isStaleOpenDeal(deal: DealRow, now: Date): boolean {
  if (!isOpenDeal(deal)) return false
  const activityAge = daysSince(dealActivityDate(deal), now)
  return activityAge === null || activityAge >= 21 || isPast(deal.expectedCloseDate ?? deal.closeDate, now)
}

function sourceLinkForContact(contact: ContactRow): SourceLink {
  return {
    type: 'contact',
    id: contact.id,
    href: `/portal/contacts/${encodeURIComponent(contact.id)}`,
    label: contactLabel(contact),
  }
}

function sourceLinkForDeal(deal: DealRow): SourceLink {
  return {
    type: 'deal',
    id: deal.id,
    href: `/portal/deals/${encodeURIComponent(deal.id)}`,
    label: dealLabel(deal),
  }
}

async function listOrgRows(collectionName: 'contacts' | 'deals', orgId: string, limit: number): Promise<Array<ContactRow | DealRow>> {
  const snap = await adminDb.collection(collectionName)
    .where('orgId', '==', orgId)
    .limit(limit)
    .get() as { docs: CrmDoc[] }
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as ContactRow | DealRow)
    .filter((row) => row.deleted !== true)
}

function unownedHighIntentMetric(contacts: ContactRow[], now: Date): CrmBusinessMetricSnapshot {
  const candidates = contacts
    .filter(isUnownedHighIntentLead)
    .sort((a, b) => bestContactScore(b) - bestContactScore(a))
  const sourceLinks = candidates.slice(0, 5).map(sourceLinkForContact)
  const topScore = candidates.length > 0 ? bestContactScore(candidates[0]) : 0
  const topCompanies = candidates
    .map(companyLabel)
    .filter((value): value is string => Boolean(value))
    .slice(0, 3)

  return {
    metric: 'unowned_high_intent_leads',
    value: candidates.length,
    capturedAt: now.toISOString(),
    source: 'crm-business-signals',
    sourceLinks,
    evidence: [
      { label: 'High-intent leads without owner', value: candidates.length },
      { label: 'Top lead score', value: topScore },
      ...(topCompanies.length ? [{ label: 'Example companies', value: topCompanies.join(', ') }] : []),
    ],
  }
}

function staleOpenDealsMetric(deals: DealRow[], now: Date): CrmBusinessMetricSnapshot {
  const candidates = deals
    .filter((deal) => isStaleOpenDeal(deal, now))
    .sort((a, b) => dealValue(b) - dealValue(a))
  const sourceLinks = candidates.slice(0, 5).map(sourceLinkForDeal)
  const atRiskValue = candidates.reduce((sum, deal) => sum + dealValue(deal), 0)

  return {
    metric: 'stale_open_deals',
    value: candidates.length,
    capturedAt: now.toISOString(),
    source: 'crm-business-signals',
    sourceLinks,
    evidence: [
      { label: 'Stale or past-close open deals', value: candidates.length },
      { label: 'At-risk pipeline value', value: atRiskValue },
    ],
  }
}

function unownedHighIntentSignal(input: {
  orgId: string
  metric: CrmBusinessMetricSnapshot
  existingSuppressionKeys: Set<string>
}): BusinessInsightSignal | null {
  if (input.metric.value <= 0) return null
  const suppressionKey = `crm:unowned-high-intent-leads:${input.orgId}`
  const plural = input.metric.value === 1 ? 'lead has' : 'leads have'
  return {
    id: `crm-unowned-high-intent-leads-${input.orgId}`,
    lane: 'crm',
    insightKind: 'follow-up-gap',
    summary: `${input.metric.value} high-intent CRM ${plural} no owner`,
    impactEstimate: 'Potential revenue leakage from warm leads without clear accountability',
    metric: input.metric.metric,
    value: input.metric.value,
    impact: Math.min(92, 64 + input.metric.value * 8),
    urgency: input.metric.value >= 3 ? 88 : 78,
    confidence: 84,
    actionability: 88,
    risk: 20,
    ownerAgentId: 'sales',
    ownerRole: 'sales',
    nextAction: 'Review the cited high-intent leads, assign a CRM owner, and create approved internal follow-up tasks before any external outreach.',
    suppressionKey,
    sourceLinks: input.metric.sourceLinks,
    evidence: input.metric.evidence,
    blocksActiveCommercialLoop: true,
    hasNewSourceItem: !input.existingSuppressionKeys.has(suppressionKey),
  }
}

function staleOpenDealsSignal(input: {
  orgId: string
  metric: CrmBusinessMetricSnapshot
  existingSuppressionKeys: Set<string>
}): BusinessInsightSignal | null {
  if (input.metric.value <= 0) return null
  const suppressionKey = `crm:stale-open-deals:${input.orgId}`
  const plural = input.metric.value === 1 ? 'deal is' : 'deals are'
  const atRiskValue = input.metric.evidence.find((item) => item.label === 'At-risk pipeline value')?.value
  const numericAtRiskValue = typeof atRiskValue === 'number' ? atRiskValue : 0
  return {
    id: `crm-stale-open-deals-${input.orgId}`,
    lane: 'crm',
    insightKind: 'stale-work',
    summary: `${input.metric.value} open CRM ${plural} stale or past close date`,
    impactEstimate: `Potential pipeline value at risk: ${numericAtRiskValue}`,
    metric: input.metric.metric,
    value: input.metric.value,
    impact: Math.min(95, 62 + input.metric.value * 7 + Math.min(18, Math.round(numericAtRiskValue / 10_000))),
    urgency: numericAtRiskValue > 50_000 ? 88 : 80,
    confidence: 78,
    actionability: 78,
    risk: 28,
    ownerAgentId: 'sales',
    ownerRole: 'sales',
    nextAction: 'Review stale open deals, confirm owner and next sales step, and create internal follow-up tasks before any external send.',
    suppressionKey,
    sourceLinks: input.metric.sourceLinks,
    evidence: input.metric.evidence,
    blocksActiveCommercialLoop: true,
    hasNewSourceItem: !input.existingSuppressionKeys.has(suppressionKey),
  }
}

export async function collectCrmBusinessInsightSignals(
  input: CollectCrmBusinessInsightSignalsInput,
): Promise<CollectCrmBusinessInsightSignalsResult> {
  const limit = boundedLimit(input.limit)
  const now = input.now ?? new Date()
  const existingSuppressionKeys = new Set(input.existingSuppressionKeys ?? [])
  const [contacts, deals] = await Promise.all([
    listOrgRows('contacts', input.orgId, limit) as Promise<ContactRow[]>,
    listOrgRows('deals', input.orgId, limit) as Promise<DealRow[]>,
  ])
  const metrics = [
    unownedHighIntentMetric(contacts, now),
    staleOpenDealsMetric(deals, now),
  ]
  const signals = [
    unownedHighIntentSignal({ orgId: input.orgId, metric: metrics[0], existingSuppressionKeys }),
    staleOpenDealsSignal({ orgId: input.orgId, metric: metrics[1], existingSuppressionKeys }),
  ].filter((signal): signal is BusinessInsightSignal => Boolean(signal))

  return {
    contactsScanned: contacts.length,
    dealsScanned: deals.length,
    metrics,
    signals,
  }
}

export async function refreshCrmBusinessInsightMetric(
  input: RefreshCrmBusinessInsightMetricInput,
): Promise<CrmBusinessMetricSnapshot | null> {
  const metric = cleanString(input.metric)
  if (metric !== 'unowned_high_intent_leads' && metric !== 'stale_open_deals') return null

  const collection = await collectCrmBusinessInsightSignals({
    orgId: input.orgId,
    limit: input.limit,
    now: input.now,
  })
  return collection.metrics.find((snapshot) => snapshot.metric === metric) ?? null
}
