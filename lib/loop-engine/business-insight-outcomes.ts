import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { refreshAdsBusinessInsightMetric, type AdsBusinessMetricSnapshot } from './ads-business-signals'
import { refreshCrmBusinessInsightMetric, type CrmBusinessMetricSnapshot } from './crm-business-signals'
import { refreshDocumentBusinessInsightMetric, type DocumentBusinessMetricSnapshot } from './document-business-signals'
import { refreshInvoiceBusinessInsightMetric, type InvoiceBusinessMetricSnapshot } from './invoice-business-signals'
import { refreshSeoBusinessInsightMetric, type SeoBusinessMetricSnapshot } from './seo-business-signals'
import { refreshSocialBusinessInsightMetric, type SocialBusinessMetricSnapshot } from './social-business-signals'
import { refreshSupportBusinessInsightMetric, type SupportBusinessMetricSnapshot } from './support-business-signals'

type TaskDoc = {
  id: string
  data: () => Record<string, unknown>
  ref?: {
    path?: string
    set?: (data: Record<string, unknown>, options?: { merge: boolean }) => Promise<unknown>
  }
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

type ProjectBusinessMetricSnapshot = {
  metric: 'high_risk_blocked_task'
  value: number
  capturedAt: string
  source: 'project-business-signals'
  sourceLinks: SourceLink[]
  evidence: EvidenceItem[]
}

type RefreshedBusinessMetricSnapshot =
  | AdsBusinessMetricSnapshot
  | CrmBusinessMetricSnapshot
  | SeoBusinessMetricSnapshot
  | SocialBusinessMetricSnapshot
  | SupportBusinessMetricSnapshot
  | InvoiceBusinessMetricSnapshot
  | DocumentBusinessMetricSnapshot
  | ProjectBusinessMetricSnapshot

export type BusinessInsightOutcomeStatus = 'improved' | 'regressed' | 'unchanged'

export type BusinessInsightOutcome = {
  taskId: string
  projectId: string | null
  status: BusinessInsightOutcomeStatus
  baselineValue: number
  currentValue: number
  delta: number
}

export type BusinessInsightOutcomeSkip = {
  taskId: string
  reason:
    | 'not-business-insight-action'
    | 'already-measured'
    | 'not-due'
    | 'missing-baseline-value'
    | 'missing-current-value'
    | 'missing-task-ref'
}

export type MeasureBusinessInsightOutcomesInput = {
  orgId: string
  projectId?: string | null
  limit?: number
  now?: Date
}

export type MeasureBusinessInsightOutcomesResult = {
  scanned: number
  measured: number
  skipped: BusinessInsightOutcomeSkip[]
  outcomes: BusinessInsightOutcome[]
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function cleanNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function boundedLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 100
  return Math.max(1, Math.min(250, Math.floor(value)))
}

function projectIdFromPath(path: string | undefined): string | null {
  if (!path) return null
  const match = path.match(/^projects\/([^/]+)\/tasks\/[^/]+/)
  return match?.[1] ?? null
}

function actionData(task: Record<string, unknown>): Record<string, unknown> | null {
  const metadata = task.metadata
  if (!isRecord(metadata)) return null
  const action = metadata.businessInsightAction
  return isRecord(action) ? action : null
}

function nestedRecord(source: Record<string, unknown> | null, key: string): Record<string, unknown> {
  if (!source) return {}
  const value = source[key]
  return isRecord(value) ? value : {}
}

function recordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> => isRecord(item))
}

function isDue(action: Record<string, unknown>, now: Date): boolean {
  const target = nestedRecord(action, 'target')
  const reviewAfterAt = cleanString(target.reviewAfterAt)
  if (!reviewAfterAt) return true
  const millis = Date.parse(reviewAfterAt)
  if (!Number.isFinite(millis)) return true
  return millis <= now.getTime()
}

function statusForDelta(delta: number, direction: string | null): BusinessInsightOutcomeStatus {
  if (delta === 0) return 'unchanged'
  if (direction === 'decrease') return delta < 0 ? 'improved' : 'regressed'
  if (direction === 'increase') return delta > 0 ? 'improved' : 'regressed'
  return 'unchanged'
}

const PROJECT_RISK_AGENT_STATUSES = new Set(['blocked', 'awaiting-input'])

function sourceTaskIds(action: Record<string, unknown>): string[] {
  const ids = new Set<string>()
  for (const source of recordArray(action.sourceLinks)) {
    if (cleanString(source.type) === 'task') {
      const id = cleanString(source.id)
      if (id) ids.add(id)
    }
  }
  const suppressionKey = cleanString(action.suppressionKey)
  const match = suppressionKey?.match(/^project-risk:[^:]+:(.+)$/)
  if (match?.[1]) ids.add(match[1])
  return [...ids]
}

function metricCacheKey(orgId: string, metric: string, action: Record<string, unknown>): string {
  if (metric === 'high_risk_blocked_task') {
    const scopedIds = sourceTaskIds(action).sort().join(',')
    return `${orgId}:${metric}:${cleanString(action.suppressionKey) ?? scopedIds}`
  }
  return `${orgId}:${metric}`
}

function isHighRiskProjectTask(task: Record<string, unknown>): boolean {
  const riskLevel = cleanString(task.riskLevel)
  const priority = cleanString(task.priority)
  return riskLevel === 'critical' || riskLevel === 'high' || priority === 'urgent'
}

function isStillBlockedProjectRisk(task: Record<string, unknown>): boolean {
  const status = cleanString(task.agentStatus)
  return task.deleted !== true && PROJECT_RISK_AGENT_STATUSES.has(status ?? '') && isHighRiskProjectTask(task)
}

function projectTaskSourceLink(doc: TaskDoc, task: Record<string, unknown>): SourceLink {
  const projectId = cleanString(task.projectId) ?? projectIdFromPath(doc.ref?.path)
  const title = cleanString(task.title) ?? doc.id
  return {
    type: 'task',
    id: doc.id,
    href: projectId ? `/admin/projects/${projectId}?task=${doc.id}` : `/admin/agent/board?task=${doc.id}`,
    label: title,
  }
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefined(item))
      .filter((item) => item !== undefined) as T
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, stripUndefined(item)] as const)
      .filter(([, item]) => item !== undefined)
    return Object.fromEntries(entries) as T
  }
  return value
}

function skip(taskId: string, reason: BusinessInsightOutcomeSkip['reason']): BusinessInsightOutcomeSkip {
  return { taskId, reason }
}

async function refreshProjectBusinessInsightMetric(input: {
  orgId: string
  metric: string | null
  action: Record<string, unknown>
  limit?: number
  now: Date
}): Promise<ProjectBusinessMetricSnapshot | null> {
  if (cleanString(input.metric) !== 'high_risk_blocked_task') return null

  const ids = new Set(sourceTaskIds(input.action))
  const snap = await adminDb.collectionGroup('tasks')
    .where('orgId', '==', input.orgId)
    .limit(boundedLimit(input.limit))
    .get() as { docs: TaskDoc[] }
  const candidates = snap.docs.filter((doc) => ids.size === 0 || ids.has(doc.id))
  const blocked = candidates.filter((doc) => isStillBlockedProjectRisk(doc.data()))

  return {
    metric: 'high_risk_blocked_task',
    value: blocked.length,
    capturedAt: input.now.toISOString(),
    source: 'project-business-signals',
    sourceLinks: blocked.slice(0, 5).map((doc) => projectTaskSourceLink(doc, doc.data())),
    evidence: [
      { label: 'Tracked high-risk blocked tasks still blocked', value: blocked.length },
      { label: 'Tracked source tasks', value: ids.size || candidates.length },
    ],
  }
}

async function refreshKnownBusinessInsightMetric(input: {
  orgId: string
  metric: string
  action: Record<string, unknown>
  limit?: number
  now: Date
}): Promise<RefreshedBusinessMetricSnapshot | null> {
  const projectMetric = await refreshProjectBusinessInsightMetric(input)
  if (projectMetric) return projectMetric
  const crmMetric = await refreshCrmBusinessInsightMetric(input)
  if (crmMetric) return crmMetric
  const supportMetric = await refreshSupportBusinessInsightMetric(input)
  if (supportMetric) return supportMetric
  const socialMetric = await refreshSocialBusinessInsightMetric(input)
  if (socialMetric) return socialMetric
  const adsMetric = await refreshAdsBusinessInsightMetric(input)
  if (adsMetric) return adsMetric
  const invoiceMetric = await refreshInvoiceBusinessInsightMetric(input)
  if (invoiceMetric) return invoiceMetric
  const documentMetric = await refreshDocumentBusinessInsightMetric(input)
  if (documentMetric) return documentMetric
  return refreshSeoBusinessInsightMetric(input)
}

export async function measureBusinessInsightOutcomes(
  input: MeasureBusinessInsightOutcomesInput,
): Promise<MeasureBusinessInsightOutcomesResult> {
  const now = input.now ?? new Date()
  const refreshedMetricCache = new Map<string, Promise<RefreshedBusinessMetricSnapshot | null>>()
  const snap = await adminDb.collectionGroup('tasks')
    .where('orgId', '==', input.orgId)
    .limit(boundedLimit(input.limit))
    .get() as { docs: TaskDoc[] }

  const outcomes: BusinessInsightOutcome[] = []
  const skipped: BusinessInsightOutcomeSkip[] = []

  for (const doc of snap.docs) {
    const task = doc.data()
    const projectId = cleanString(task.projectId) ?? projectIdFromPath(doc.ref?.path)
    if (input.projectId && projectId !== input.projectId) continue

    let action = actionData(task)
    if (!action) {
      skipped.push(skip(doc.id, 'not-business-insight-action'))
      continue
    }
    if (cleanString(action.measurementStatus) && cleanString(action.measurementStatus) !== 'pending') {
      skipped.push(skip(doc.id, 'already-measured'))
      continue
    }
    if (!isDue(action, now)) {
      skipped.push(skip(doc.id, 'not-due'))
      continue
    }

    const baseline = nestedRecord(action, 'baseline')
    let latest = nestedRecord(action, 'latest')
    const target = nestedRecord(action, 'target')
    const baselineValue = cleanNumber(baseline.value)
    const metric = cleanString(baseline.metric)
    let currentValue = cleanNumber(latest.value)
    if (currentValue === null && metric) {
      const cacheKey = metricCacheKey(input.orgId, metric, action)
      if (!refreshedMetricCache.has(cacheKey)) {
        refreshedMetricCache.set(cacheKey, refreshKnownBusinessInsightMetric({
          orgId: input.orgId,
          metric,
          action,
          limit: input.limit,
          now,
        }))
      }
      const refreshed = await refreshedMetricCache.get(cacheKey)
      if (refreshed) {
        latest = refreshed
        action = {
          ...action,
          latest,
        }
        currentValue = refreshed.value
      }
    }
    if (baselineValue === null) {
      skipped.push(skip(doc.id, 'missing-baseline-value'))
      continue
    }
    if (currentValue === null) {
      skipped.push(skip(doc.id, 'missing-current-value'))
      continue
    }
    if (!doc.ref?.set) {
      skipped.push(skip(doc.id, 'missing-task-ref'))
      continue
    }

    const delta = currentValue - baselineValue
    const status = statusForDelta(delta, cleanString(target.expectedDirection))
    const outcome: BusinessInsightOutcome = {
      taskId: doc.id,
      projectId,
      status,
      baselineValue,
      currentValue,
      delta,
    }
    await doc.ref.set(stripUndefined({
      metadata: {
        businessInsightAction: {
          ...action,
          measurementStatus: status,
          outcome: {
            status,
            baselineValue,
            currentValue,
            delta,
            expectedDirection: cleanString(target.expectedDirection),
            metric,
            latestCapturedAt: cleanString(latest.capturedAt),
            latestSource: cleanString(latest.source),
            measuredAt: FieldValue.serverTimestamp(),
            measuredBy: 'loop-review-outcome-cron',
          },
        },
      },
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'loop-review-outcome-cron',
      updatedByType: 'system',
    }), { merge: true })
    outcomes.push(outcome)
  }

  return {
    scanned: snap.docs.length,
    measured: outcomes.length,
    skipped,
    outcomes,
  }
}
