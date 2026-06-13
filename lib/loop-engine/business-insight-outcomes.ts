import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { refreshCrmBusinessInsightMetric, type CrmBusinessMetricSnapshot } from './crm-business-signals'
import { refreshSupportBusinessInsightMetric, type SupportBusinessMetricSnapshot } from './support-business-signals'

type TaskDoc = {
  id: string
  data: () => Record<string, unknown>
  ref?: {
    path?: string
    set?: (data: Record<string, unknown>, options?: { merge: boolean }) => Promise<unknown>
  }
}

type RefreshedBusinessMetricSnapshot = CrmBusinessMetricSnapshot | SupportBusinessMetricSnapshot

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

async function refreshKnownBusinessInsightMetric(input: {
  orgId: string
  metric: string
  limit?: number
  now: Date
}): Promise<RefreshedBusinessMetricSnapshot | null> {
  const crmMetric = await refreshCrmBusinessInsightMetric(input)
  if (crmMetric) return crmMetric
  return refreshSupportBusinessInsightMetric(input)
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
      const cacheKey = `${input.orgId}:${metric}`
      if (!refreshedMetricCache.has(cacheKey)) {
        refreshedMetricCache.set(cacheKey, refreshKnownBusinessInsightMetric({
          orgId: input.orgId,
          metric,
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
