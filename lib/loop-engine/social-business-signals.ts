import { adminDb } from '@/lib/firebase/admin'
import type { BusinessInsightSignal } from './review-evaluator'

type SocialDoc = {
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

export type SocialBusinessMetric = 'failed_social_posts' | 'social_posts_waiting_qa'

export type SocialBusinessMetricSnapshot = {
  metric: SocialBusinessMetric
  value: number
  capturedAt: string
  source: 'social-business-signals'
  sourceLinks: SourceLink[]
  evidence: EvidenceItem[]
}

export type CollectSocialBusinessInsightSignalsInput = {
  orgId: string
  existingSuppressionKeys?: string[]
  limit?: number
  now?: Date
}

export type CollectSocialBusinessInsightSignalsResult = {
  postsScanned: number
  metrics: SocialBusinessMetricSnapshot[]
  signals: BusinessInsightSignal[]
}

export type RefreshSocialBusinessInsightMetricInput = {
  orgId: string
  metric: string | null
  limit?: number
  now?: Date
}

type SocialPostRow = Record<string, unknown> & { id: string }

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

function platformNames(post: SocialPostRow): string[] {
  if (Array.isArray(post.platforms)) {
    return post.platforms
      .map(cleanString)
      .filter((value): value is string => Boolean(value))
  }
  const platform = cleanString(post.platform)
  return platform ? [platform] : []
}

function platformLabel(post: SocialPostRow): string {
  const names = platformNames(post)
  if (names.length === 0) return 'social'
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

function postLabel(post: SocialPostRow): string {
  return cleanString(post.title) ?? cleanString(post.caption) ?? cleanString(post.campaign) ?? `${platformLabel(post)} post`
}

function postActivityDate(post: SocialPostRow): unknown {
  return post.updatedAt ?? post.createdAt ?? post.scheduledAt
}

function postActivityMs(post: SocialPostRow): number {
  return normalizeDate(postActivityDate(post))?.getTime() ?? 0
}

function isFailedPost(post: SocialPostRow): boolean {
  return post.deleted !== true && cleanString(post.status) === 'failed'
}

function isWaitingQaPost(post: SocialPostRow, now: Date): boolean {
  return post.deleted !== true &&
    cleanString(post.status) === 'qa_review' &&
    (daysSince(postActivityDate(post), now) ?? 999) >= 2
}

function sourceLinkForPost(post: SocialPostRow): SourceLink {
  return {
    type: 'social-post',
    id: post.id,
    href: `/admin/social?postId=${encodeURIComponent(post.id)}`,
    label: postLabel(post),
  }
}

async function listSocialPosts(orgId: string, limit: number): Promise<SocialPostRow[]> {
  const snap = await adminDb.collection('social_posts')
    .where('orgId', '==', orgId)
    .limit(limit)
    .get() as { docs: SocialDoc[] }
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as SocialPostRow)
    .filter((row) => row.deleted !== true)
}

function failedMetric(posts: SocialPostRow[], now: Date): SocialBusinessMetricSnapshot {
  const candidates = posts
    .filter(isFailedPost)
    .sort((a, b) => postActivityMs(b) - postActivityMs(a))
  const platforms = Array.from(new Set(candidates.flatMap(platformNames))).slice(0, 5)
  return {
    metric: 'failed_social_posts',
    value: candidates.length,
    capturedAt: now.toISOString(),
    source: 'social-business-signals',
    sourceLinks: candidates.slice(0, 5).map(sourceLinkForPost),
    evidence: [
      { label: 'Failed social posts', value: candidates.length },
      ...(platforms.length ? [{ label: 'Affected platforms', value: platforms.join(', ') }] : []),
    ],
  }
}

function waitingQaMetric(posts: SocialPostRow[], now: Date): SocialBusinessMetricSnapshot {
  const candidates = posts
    .filter((post) => isWaitingQaPost(post, now))
    .sort((a, b) => postActivityMs(a) - postActivityMs(b))
  return {
    metric: 'social_posts_waiting_qa',
    value: candidates.length,
    capturedAt: now.toISOString(),
    source: 'social-business-signals',
    sourceLinks: candidates.slice(0, 5).map(sourceLinkForPost),
    evidence: [
      { label: 'Social posts waiting for QA for 2+ days', value: candidates.length },
      { label: 'Oldest QA age days', value: candidates.length ? daysSince(postActivityDate(candidates[0]), now) ?? 0 : 0 },
    ],
  }
}

function failedSignal(input: {
  orgId: string
  metric: SocialBusinessMetricSnapshot
  existingSuppressionKeys: Set<string>
}): BusinessInsightSignal | null {
  if (input.metric.value <= 0) return null
  const suppressionKey = `social:failed-posts:${input.orgId}`
  const plural = input.metric.value === 1 ? 'post failed' : 'posts failed'
  return {
    id: `social-failed-posts-${input.orgId}`,
    lane: 'social',
    insightKind: 'risk',
    summary: `${input.metric.value} social ${plural} publishing`,
    impactEstimate: 'Campaign delivery risk from failed social publishing',
    metric: input.metric.metric,
    value: input.metric.value,
    impact: Math.min(94, 72 + input.metric.value * 7),
    urgency: 88,
    confidence: 86,
    actionability: 84,
    risk: 20,
    ownerAgentId: 'maya',
    ownerRole: 'social',
    nextAction: 'Review failed social posts, identify the publishing blocker, and create an internal repair task before retrying any external publish.',
    suppressionKey,
    sourceLinks: input.metric.sourceLinks,
    evidence: input.metric.evidence,
    blocksActiveCommercialLoop: true,
    hasNewSourceItem: !input.existingSuppressionKeys.has(suppressionKey),
  }
}

function waitingQaSignal(input: {
  orgId: string
  metric: SocialBusinessMetricSnapshot
  existingSuppressionKeys: Set<string>
}): BusinessInsightSignal | null {
  if (input.metric.value <= 0) return null
  const suppressionKey = `social:waiting-qa:${input.orgId}`
  const plural = input.metric.value === 1 ? 'post is' : 'posts are'
  return {
    id: `social-waiting-qa-${input.orgId}`,
    lane: 'social',
    insightKind: 'stale-work',
    summary: `${input.metric.value} social ${plural} waiting for QA`,
    impactEstimate: 'Content cadence risk from social posts stuck before approval',
    metric: input.metric.metric,
    value: input.metric.value,
    impact: Math.min(88, 62 + input.metric.value * 6),
    urgency: input.metric.value >= 3 ? 84 : 74,
    confidence: 80,
    actionability: 84,
    risk: 18,
    ownerAgentId: 'maya',
    ownerRole: 'social',
    nextAction: 'Review stale QA posts, assign a reviewer, and move them through the approved workflow before any client-visible or external publish action.',
    suppressionKey,
    sourceLinks: input.metric.sourceLinks,
    evidence: input.metric.evidence,
    blocksActiveCommercialLoop: input.metric.value >= 3,
    hasNewSourceItem: !input.existingSuppressionKeys.has(suppressionKey),
  }
}

export async function collectSocialBusinessInsightSignals(
  input: CollectSocialBusinessInsightSignalsInput,
): Promise<CollectSocialBusinessInsightSignalsResult> {
  const limit = boundedLimit(input.limit)
  const now = input.now ?? new Date()
  const existingSuppressionKeys = new Set(input.existingSuppressionKeys ?? [])
  const posts = await listSocialPosts(input.orgId, limit)
  const metrics = [
    failedMetric(posts, now),
    waitingQaMetric(posts, now),
  ]
  const signals = [
    failedSignal({ orgId: input.orgId, metric: metrics[0], existingSuppressionKeys }),
    waitingQaSignal({ orgId: input.orgId, metric: metrics[1], existingSuppressionKeys }),
  ].filter((signal): signal is BusinessInsightSignal => Boolean(signal))

  return {
    postsScanned: posts.length,
    metrics,
    signals,
  }
}

export async function refreshSocialBusinessInsightMetric(
  input: RefreshSocialBusinessInsightMetricInput,
): Promise<SocialBusinessMetricSnapshot | null> {
  const metric = cleanString(input.metric)
  if (metric !== 'failed_social_posts' && metric !== 'social_posts_waiting_qa') return null

  const collection = await collectSocialBusinessInsightSignals({
    orgId: input.orgId,
    limit: input.limit,
    now: input.now,
  })
  return collection.metrics.find((snapshot) => snapshot.metric === metric) ?? null
}
