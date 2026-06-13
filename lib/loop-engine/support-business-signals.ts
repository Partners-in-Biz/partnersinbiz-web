import { adminDb } from '@/lib/firebase/admin'
import type { BusinessInsightSignal } from './review-evaluator'

type SupportDoc = {
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

export type SupportBusinessMetric = 'urgent_support_needs_reply' | 'stale_support_needs_reply'

export type SupportBusinessMetricSnapshot = {
  metric: SupportBusinessMetric
  value: number
  capturedAt: string
  source: 'support-business-signals'
  sourceLinks: SourceLink[]
  evidence: EvidenceItem[]
}

export type CollectSupportBusinessInsightSignalsInput = {
  orgId: string
  existingSuppressionKeys?: string[]
  limit?: number
  now?: Date
}

export type CollectSupportBusinessInsightSignalsResult = {
  ticketsScanned: number
  metrics: SupportBusinessMetricSnapshot[]
  signals: BusinessInsightSignal[]
}

export type RefreshSupportBusinessInsightMetricInput = {
  orgId: string
  metric: string | null
  limit?: number
  now?: Date
}

type SupportTicketRow = Record<string, unknown> & { id: string }

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
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

function ticketLabel(ticket: SupportTicketRow): string {
  return cleanString(ticket.subject) ?? cleanString(ticket.requesterName) ?? cleanString(ticket.requesterEmail) ?? ticket.id
}

function ticketActivityDate(ticket: SupportTicketRow): unknown {
  return ticket.lastMessageAt ?? ticket.updatedAt ?? ticket.createdAt
}

function ticketActivityMs(ticket: SupportTicketRow): number {
  return normalizeDate(ticketActivityDate(ticket))?.getTime() ?? 0
}

function isOpenTicket(ticket: SupportTicketRow): boolean {
  if (ticket.deleted === true) return false
  return cleanString(ticket.status) !== 'resolved'
}

function needsReply(ticket: SupportTicketRow): boolean {
  const status = cleanString(ticket.status)
  return isOpenTicket(ticket) && (status === 'new' || status === 'waiting_on_us')
}

function isUrgent(ticket: SupportTicketRow): boolean {
  return cleanString(ticket.priority) === 'urgent' || cleanString(ticket.category) === 'urgent'
}

function isStaleNeedsReply(ticket: SupportTicketRow, now: Date): boolean {
  return needsReply(ticket) && !isUrgent(ticket) && (daysSince(ticketActivityDate(ticket), now) ?? 999) >= 2
}

function sourceLinkForTicket(ticket: SupportTicketRow): SourceLink {
  return {
    type: 'support-ticket',
    id: ticket.id,
    href: `/admin/support?ticket=${encodeURIComponent(ticket.id)}`,
    label: ticketLabel(ticket),
  }
}

async function listSupportTickets(orgId: string, limit: number): Promise<SupportTicketRow[]> {
  const snap = await adminDb.collection('support_tickets')
    .where('orgId', '==', orgId)
    .limit(limit)
    .get() as { docs: SupportDoc[] }
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as SupportTicketRow)
    .filter((row) => row.deleted !== true)
}

function urgentMetric(tickets: SupportTicketRow[], now: Date): SupportBusinessMetricSnapshot {
  const candidates = tickets
    .filter((ticket) => needsReply(ticket) && isUrgent(ticket))
    .sort((a, b) => ticketActivityMs(a) - ticketActivityMs(b))
  return {
    metric: 'urgent_support_needs_reply',
    value: candidates.length,
    capturedAt: now.toISOString(),
    source: 'support-business-signals',
    sourceLinks: candidates.slice(0, 5).map(sourceLinkForTicket),
    evidence: [
      { label: 'Urgent support tickets needing reply', value: candidates.length },
      { label: 'Oldest urgent ticket age days', value: candidates.length ? daysSince(ticketActivityDate(candidates[0]), now) ?? 0 : 0 },
    ],
  }
}

function staleMetric(tickets: SupportTicketRow[], now: Date): SupportBusinessMetricSnapshot {
  const candidates = tickets
    .filter((ticket) => isStaleNeedsReply(ticket, now))
    .sort((a, b) => ticketActivityMs(a) - ticketActivityMs(b))
  return {
    metric: 'stale_support_needs_reply',
    value: candidates.length,
    capturedAt: now.toISOString(),
    source: 'support-business-signals',
    sourceLinks: candidates.slice(0, 5).map(sourceLinkForTicket),
    evidence: [
      { label: 'Support tickets waiting on us for 2+ days', value: candidates.length },
      { label: 'Oldest waiting age days', value: candidates.length ? daysSince(ticketActivityDate(candidates[0]), now) ?? 0 : 0 },
    ],
  }
}

function urgentSignal(input: {
  orgId: string
  metric: SupportBusinessMetricSnapshot
  existingSuppressionKeys: Set<string>
}): BusinessInsightSignal | null {
  if (input.metric.value <= 0) return null
  const suppressionKey = `support:urgent-needs-reply:${input.orgId}`
  const plural = input.metric.value === 1 ? 'ticket needs' : 'tickets need'
  return {
    id: `support-urgent-needs-reply-${input.orgId}`,
    lane: 'support',
    insightKind: 'risk',
    summary: `${input.metric.value} urgent support ${plural} a reply`,
    impactEstimate: 'Client trust and retention risk from urgent support work waiting on us',
    metric: input.metric.metric,
    value: input.metric.value,
    impact: Math.min(96, 78 + input.metric.value * 6),
    urgency: 92,
    confidence: 86,
    actionability: 84,
    risk: 18,
    ownerAgentId: 'support',
    ownerRole: 'support',
    nextAction: 'Review the cited urgent support tickets, assign an owner, and create an internal response task before any external reply is sent.',
    suppressionKey,
    sourceLinks: input.metric.sourceLinks,
    evidence: input.metric.evidence,
    blocksActiveCommercialLoop: true,
    hasNewSourceItem: !input.existingSuppressionKeys.has(suppressionKey),
  }
}

function staleSignal(input: {
  orgId: string
  metric: SupportBusinessMetricSnapshot
  existingSuppressionKeys: Set<string>
}): BusinessInsightSignal | null {
  if (input.metric.value <= 0) return null
  const suppressionKey = `support:stale-needs-reply:${input.orgId}`
  const plural = input.metric.value === 1 ? 'ticket has' : 'tickets have'
  return {
    id: `support-stale-needs-reply-${input.orgId}`,
    lane: 'support',
    insightKind: 'stale-work',
    summary: `${input.metric.value} support ${plural} been waiting on us for 2+ days`,
    impactEstimate: 'Support responsiveness risk from open tickets without recent action',
    metric: input.metric.metric,
    value: input.metric.value,
    impact: Math.min(90, 66 + input.metric.value * 6),
    urgency: input.metric.value >= 3 ? 86 : 76,
    confidence: 82,
    actionability: 82,
    risk: 22,
    ownerAgentId: 'support',
    ownerRole: 'support',
    nextAction: 'Review stale support tickets, confirm blocker/owner, and create internal reply or resolution tasks before any external message.',
    suppressionKey,
    sourceLinks: input.metric.sourceLinks,
    evidence: input.metric.evidence,
    blocksActiveCommercialLoop: input.metric.value >= 3,
    hasNewSourceItem: !input.existingSuppressionKeys.has(suppressionKey),
  }
}

export async function collectSupportBusinessInsightSignals(
  input: CollectSupportBusinessInsightSignalsInput,
): Promise<CollectSupportBusinessInsightSignalsResult> {
  const limit = boundedLimit(input.limit)
  const now = input.now ?? new Date()
  const existingSuppressionKeys = new Set(input.existingSuppressionKeys ?? [])
  const tickets = await listSupportTickets(input.orgId, limit)
  const metrics = [
    urgentMetric(tickets, now),
    staleMetric(tickets, now),
  ]
  const signals = [
    urgentSignal({ orgId: input.orgId, metric: metrics[0], existingSuppressionKeys }),
    staleSignal({ orgId: input.orgId, metric: metrics[1], existingSuppressionKeys }),
  ].filter((signal): signal is BusinessInsightSignal => Boolean(signal))

  return {
    ticketsScanned: tickets.length,
    metrics,
    signals,
  }
}

export async function refreshSupportBusinessInsightMetric(
  input: RefreshSupportBusinessInsightMetricInput,
): Promise<SupportBusinessMetricSnapshot | null> {
  const metric = cleanString(input.metric)
  if (metric !== 'urgent_support_needs_reply' && metric !== 'stale_support_needs_reply') return null

  const collection = await collectSupportBusinessInsightSignals({
    orgId: input.orgId,
    limit: input.limit,
    now: input.now,
  })
  return collection.metrics.find((snapshot) => snapshot.metric === metric) ?? null
}
