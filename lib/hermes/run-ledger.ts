import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { callHermesJson, HERMES_RUNS_COLLECTION } from '@/lib/hermes/server'
import type { HermesProfileLink } from '@/lib/hermes/types'

type JsonObject = Record<string, unknown>

const ACTIVE_STATUS_VALUES = ['started', 'submitted', 'running', 'pending', 'streaming'] as const
const ACTIVE_STATUSES = new Set<string>(ACTIVE_STATUS_VALUES)
const COMPLETED_STATUSES = new Set(['completed', 'complete', 'succeeded', 'success', 'done', 'finished'])
const FAILED_STATUSES = new Set(['failed', 'error', 'errored', 'cancelled', 'canceled', 'stopped', 'interrupted'])

export interface HermesRunLedgerReconcileResult {
  scanned: number
  checked: number
  updated: number
  skipped: number
  errors: Array<{ id: string; error: string }>
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function tsToMillis(value: unknown): number | null {
  if (!value) return null
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : null
  }
  const maybeTimestamp = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number; _seconds?: number }
  if (typeof maybeTimestamp.toMillis === 'function') return maybeTimestamp.toMillis()
  if (typeof maybeTimestamp.toDate === 'function') return maybeTimestamp.toDate().getTime()
  const seconds = maybeTimestamp.seconds ?? maybeTimestamp._seconds
  return typeof seconds === 'number' ? seconds * 1000 : null
}

function textFromUnknown(value: unknown, depth = 0): string | null {
  if (depth > 5 || value == null) return null
  const str = cleanString(value)
  if (str) return str
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => textFromUnknown(item, depth + 1))
      .filter((part): part is string => Boolean(part))
    return parts.length > 0 ? parts.join('\n').trim() : null
  }
  const obj = asObject(value)
  if (!obj) return null
  for (const key of ['output_text', 'text', 'content', 'message', 'summary', 'final', 'answer', 'result', 'output', 'response', 'data']) {
    if (key in obj) {
      const text = textFromUnknown(obj[key], depth + 1)
      if (text) return text
    }
  }
  return null
}

function nestedStatus(value: unknown, depth = 0): string | null {
  if (depth > 3) return null
  const obj = asObject(value)
  if (!obj) return null
  const direct = cleanString(obj.status ?? obj.state ?? obj.run_status ?? obj.runStatus)
  if (direct) return direct.toLowerCase()
  for (const key of ['run', 'result', 'response', 'data']) {
    if (key in obj) {
      const status = nestedStatus(obj[key], depth + 1)
      if (status) return status
    }
  }
  return null
}

function normalizeGatewayStatus(data: unknown): string {
  return nestedStatus(data) ?? 'unknown'
}

function extractGatewayOutput(data: unknown): string | null {
  const obj = asObject(data)
  if (!obj) return textFromUnknown(data)
  for (const key of ['output', 'result', 'response', 'message', 'content', 'data']) {
    if (key in obj) {
      const text = textFromUnknown(obj[key])
      if (text) return text
    }
  }
  return null
}

function extractGatewayError(data: unknown): string | null {
  const obj = asObject(data)
  if (!obj) return null
  for (const key of ['error', 'reason', 'detail', 'details']) {
    const text = textFromUnknown(obj[key])
    if (text) return text
  }
  return null
}

function isTerminal(status: string): boolean {
  return COMPLETED_STATUSES.has(status) || FAILED_STATUSES.has(status)
}

export async function reconcileActiveHermesRunsForOrg(
  link: HermesProfileLink,
  options: { limit?: number; lostAfterMs?: number } = {},
): Promise<HermesRunLedgerReconcileResult> {
  const limit = Math.min(Math.max(1, options.limit ?? 20), 80)
  const lostAfterMs = Math.max(60_000, options.lostAfterMs ?? 15 * 60_000)
  const result: HermesRunLedgerReconcileResult = { scanned: 0, checked: 0, updated: 0, skipped: 0, errors: [] }

  const snap = await adminDb
    .collection(HERMES_RUNS_COLLECTION)
    .where('status', 'in', [...ACTIVE_STATUS_VALUES])
    .limit(limit * 4)
    .get()

  const candidates = snap.docs
    .filter((doc) => {
      const data = doc.data() as JsonObject
      const status = cleanString(data.status ?? data.state)?.toLowerCase()
      const profile = cleanString(data.profile)
      const orgId = cleanString(data.orgId)
      return Boolean(orgId === link.orgId && status && ACTIVE_STATUSES.has(status) && profile === link.profile && cleanString(data.hermesRunId ?? data.runId))
    })
    .slice(0, limit)

  result.scanned = snap.docs.length

  await Promise.all(candidates.map(async (doc) => {
    const data = doc.data() as JsonObject
    const runId = cleanString(data.hermesRunId ?? data.runId)
    if (!runId) {
      result.skipped += 1
      return
    }
    result.checked += 1

    try {
      const { response, data: gatewayData } = await callHermesJson(link, `/v1/runs/${encodeURIComponent(runId)}`)
      if (!response.ok) {
        const createdMs = tsToMillis(data.createdAt)
        const oldEnoughToMarkLost = response.status === 404 && createdMs != null && Date.now() - createdMs > lostAfterMs
        if (!oldEnoughToMarkLost) {
          result.skipped += 1
          return
        }
        await doc.ref.set({
          status: 'lost',
          response: gatewayData,
          error: 'Hermes gateway no longer has this direct profile run.',
          updatedAt: FieldValue.serverTimestamp(),
          completedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
        result.updated += 1
        return
      }

      const status = normalizeGatewayStatus(gatewayData)
      const patch: Record<string, unknown> = {
        status,
        response: gatewayData,
        updatedAt: FieldValue.serverTimestamp(),
      }
      if (COMPLETED_STATUSES.has(status)) {
        const output = extractGatewayOutput(gatewayData)
        if (output) patch.output = output
      }
      if (FAILED_STATUSES.has(status)) {
        const error = extractGatewayError(gatewayData)
        if (error) patch.error = error
      }
      if (isTerminal(status)) {
        patch.completedAt = FieldValue.serverTimestamp()
      }

      await doc.ref.set(patch, { merge: true })
      result.updated += 1
    } catch (err) {
      result.errors.push({ id: doc.id, error: err instanceof Error ? err.message : String(err) })
    }
  }))

  return result
}
