import { adminDb } from '@/lib/firebase/admin'
import type { BusinessInsightSignal } from './review-evaluator'

type AdsDoc = {
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

export type AdsBusinessMetric = 'ads_connections_unhealthy' | 'ads_campaigns_waiting_review'

export type AdsBusinessMetricSnapshot = {
  metric: AdsBusinessMetric
  value: number
  capturedAt: string
  source: 'ads-business-signals'
  sourceLinks: SourceLink[]
  evidence: EvidenceItem[]
}

export type CollectAdsBusinessInsightSignalsInput = {
  orgId: string
  existingSuppressionKeys?: string[]
  limit?: number
  now?: Date
}

export type CollectAdsBusinessInsightSignalsResult = {
  connectionsScanned: number
  campaignsScanned: number
  metrics: AdsBusinessMetricSnapshot[]
  signals: BusinessInsightSignal[]
}

export type RefreshAdsBusinessInsightMetricInput = {
  orgId: string
  metric: string | null
  limit?: number
  now?: Date
}

type AdConnectionRow = Record<string, unknown> & { id: string }
type AdCampaignRow = Record<string, unknown> & { id: string }

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function boundedLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 100
  return Math.max(1, Math.min(250, Math.floor(value)))
}

function platformLabel(row: Record<string, unknown>): string {
  return cleanString(row.platform) ?? 'ads'
}

function connectionLabel(connection: AdConnectionRow): string {
  return `${platformLabel(connection)} connection`
}

function campaignLabel(campaign: AdCampaignRow): string {
  return cleanString(campaign.name) ?? `${platformLabel(campaign)} campaign`
}

function isUnhealthyConnection(connection: AdConnectionRow): boolean {
  if (connection.deleted === true || connection.archived === true) return false
  const status = cleanString(connection.status)
  if (status && status !== 'active') return true
  return status === 'active' && !cleanString(connection.defaultAdAccountId)
}

function isWaitingReviewCampaign(campaign: AdCampaignRow): boolean {
  if (campaign.deleted === true || campaign.archived === true) return false
  return cleanString(campaign.status) === 'PENDING_REVIEW' && cleanString(campaign.reviewState) === 'awaiting'
}

function sourceLinkForConnection(connection: AdConnectionRow): SourceLink {
  return {
    type: 'ad-connection',
    id: connection.id,
    href: `/portal/ads/settings?connection=${encodeURIComponent(connection.id)}`,
    label: connectionLabel(connection),
  }
}

function sourceLinkForCampaign(campaign: AdCampaignRow): SourceLink {
  return {
    type: 'ad-campaign',
    id: campaign.id,
    href: `/portal/ads/campaigns/${encodeURIComponent(campaign.id)}`,
    label: campaignLabel(campaign),
  }
}

async function listOrgRows(collectionName: 'ad_connections' | 'ad_campaigns', orgId: string, limit: number): Promise<Array<AdConnectionRow | AdCampaignRow>> {
  const snap = await adminDb.collection(collectionName)
    .where('orgId', '==', orgId)
    .limit(limit)
    .get() as { docs: AdsDoc[] }
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as AdConnectionRow | AdCampaignRow)
    .filter((row) => row.deleted !== true && row.archived !== true)
}

function unhealthyConnectionsMetric(connections: AdConnectionRow[], now: Date): AdsBusinessMetricSnapshot {
  const candidates = connections.filter(isUnhealthyConnection)
  const platforms = Array.from(new Set(candidates.map(platformLabel))).slice(0, 5)
  const statuses = Array.from(new Set(candidates.map((connection) => cleanString(connection.status) ?? 'missing-default-account'))).slice(0, 5)
  return {
    metric: 'ads_connections_unhealthy',
    value: candidates.length,
    capturedAt: now.toISOString(),
    source: 'ads-business-signals',
    sourceLinks: candidates.slice(0, 5).map(sourceLinkForConnection),
    evidence: [
      { label: 'Ad connections needing attention', value: candidates.length },
      ...(platforms.length ? [{ label: 'Affected platforms', value: platforms.join(', ') }] : []),
      ...(statuses.length ? [{ label: 'Connection states', value: statuses.join(', ') }] : []),
    ],
  }
}

function waitingReviewCampaignsMetric(campaigns: AdCampaignRow[], now: Date): AdsBusinessMetricSnapshot {
  const candidates = campaigns.filter(isWaitingReviewCampaign)
  const platforms = Array.from(new Set(candidates.map(platformLabel))).slice(0, 5)
  return {
    metric: 'ads_campaigns_waiting_review',
    value: candidates.length,
    capturedAt: now.toISOString(),
    source: 'ads-business-signals',
    sourceLinks: candidates.slice(0, 5).map(sourceLinkForCampaign),
    evidence: [
      { label: 'Ad campaigns waiting for review', value: candidates.length },
      ...(platforms.length ? [{ label: 'Affected platforms', value: platforms.join(', ') }] : []),
    ],
  }
}

function unhealthyConnectionsSignal(input: {
  orgId: string
  metric: AdsBusinessMetricSnapshot
  existingSuppressionKeys: Set<string>
}): BusinessInsightSignal | null {
  if (input.metric.value <= 0) return null
  const suppressionKey = `ads:connections-unhealthy:${input.orgId}`
  const plural = input.metric.value === 1 ? 'connection needs' : 'connections need'
  return {
    id: `ads-connections-unhealthy-${input.orgId}`,
    lane: 'ads',
    insightKind: 'risk',
    summary: `${input.metric.value} ad ${plural} attention`,
    impactEstimate: 'Paid media readiness risk from disconnected or incomplete ad accounts',
    metric: input.metric.metric,
    value: input.metric.value,
    impact: Math.min(94, 74 + input.metric.value * 7),
    urgency: 88,
    confidence: 84,
    actionability: 82,
    risk: 28,
    ownerAgentId: 'ads',
    ownerRole: 'ads',
    nextAction: 'Review unhealthy ad connections and create an internal repair task. Do not reconnect, launch, spend, or change provider state without separate approval.',
    suppressionKey,
    sourceLinks: input.metric.sourceLinks,
    evidence: input.metric.evidence,
    blocksActiveCommercialLoop: true,
    hasNewSourceItem: !input.existingSuppressionKeys.has(suppressionKey),
  }
}

function waitingReviewCampaignsSignal(input: {
  orgId: string
  metric: AdsBusinessMetricSnapshot
  existingSuppressionKeys: Set<string>
}): BusinessInsightSignal | null {
  if (input.metric.value <= 0) return null
  const suppressionKey = `ads:campaigns-waiting-review:${input.orgId}`
  const plural = input.metric.value === 1 ? 'campaign is' : 'campaigns are'
  return {
    id: `ads-campaigns-waiting-review-${input.orgId}`,
    lane: 'ads',
    insightKind: 'stale-work',
    summary: `${input.metric.value} ad ${plural} waiting for review`,
    impactEstimate: 'Campaign launch readiness risk from paid media work awaiting review',
    metric: input.metric.metric,
    value: input.metric.value,
    impact: Math.min(88, 64 + input.metric.value * 6),
    urgency: input.metric.value >= 3 ? 84 : 76,
    confidence: 82,
    actionability: 84,
    risk: 24,
    ownerAgentId: 'ads',
    ownerRole: 'ads',
    nextAction: 'Review paid media campaigns waiting for approval and create internal follow-up. Do not launch, spend, or change provider state without separate approval.',
    suppressionKey,
    sourceLinks: input.metric.sourceLinks,
    evidence: input.metric.evidence,
    blocksActiveCommercialLoop: input.metric.value >= 3,
    hasNewSourceItem: !input.existingSuppressionKeys.has(suppressionKey),
  }
}

export async function collectAdsBusinessInsightSignals(
  input: CollectAdsBusinessInsightSignalsInput,
): Promise<CollectAdsBusinessInsightSignalsResult> {
  const limit = boundedLimit(input.limit)
  const now = input.now ?? new Date()
  const existingSuppressionKeys = new Set(input.existingSuppressionKeys ?? [])
  const [connections, campaigns] = await Promise.all([
    listOrgRows('ad_connections', input.orgId, limit) as Promise<AdConnectionRow[]>,
    listOrgRows('ad_campaigns', input.orgId, limit) as Promise<AdCampaignRow[]>,
  ])
  const metrics = [
    unhealthyConnectionsMetric(connections, now),
    waitingReviewCampaignsMetric(campaigns, now),
  ]
  const signals = [
    unhealthyConnectionsSignal({ orgId: input.orgId, metric: metrics[0], existingSuppressionKeys }),
    waitingReviewCampaignsSignal({ orgId: input.orgId, metric: metrics[1], existingSuppressionKeys }),
  ].filter((signal): signal is BusinessInsightSignal => Boolean(signal))

  return {
    connectionsScanned: connections.length,
    campaignsScanned: campaigns.length,
    metrics,
    signals,
  }
}

export async function refreshAdsBusinessInsightMetric(
  input: RefreshAdsBusinessInsightMetricInput,
): Promise<AdsBusinessMetricSnapshot | null> {
  const metric = cleanString(input.metric)
  if (metric !== 'ads_connections_unhealthy' && metric !== 'ads_campaigns_waiting_review') return null

  const collection = await collectAdsBusinessInsightSignals({
    orgId: input.orgId,
    limit: input.limit,
    now: input.now,
  })
  return collection.metrics.find((snapshot) => snapshot.metric === metric) ?? null
}
