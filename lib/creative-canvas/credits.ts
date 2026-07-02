import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'

export const CREATIVE_CANVAS_CREDITS_COLLECTION = 'creative_canvas_credits'
export const CREATIVE_CANVAS_CREDITS_USAGE_SUBCOLLECTION = 'usage'

export interface CanvasCreditState {
  orgId: string
  used: number
  limit: number | null
  updatedAt: unknown
  /** Real Higgsfield account balance, reported by the runtime agent (Maya). */
  higgsfieldCredits?: number
  higgsfieldPlan?: string
}

type CreditDoc = Record<string, unknown>

function coerceUsed(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function coerceLimit(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function coerceCost(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function serializeCanvasCredits(orgId: string, data: CreditDoc): CanvasCreditState {
  const state: CanvasCreditState = {
    orgId,
    used: coerceUsed(data.used),
    limit: coerceLimit(data.limit),
    updatedAt: data.updatedAt ?? null,
  }
  if (typeof data.higgsfieldCredits === 'number' && Number.isFinite(data.higgsfieldCredits)) {
    state.higgsfieldCredits = data.higgsfieldCredits
  }
  if (typeof data.higgsfieldPlan === 'string' && data.higgsfieldPlan.trim()) {
    state.higgsfieldPlan = data.higgsfieldPlan.trim()
  }
  return state
}

export async function getCanvasCredits(orgId: string): Promise<CanvasCreditState> {
  const snap = await adminDb.collection(CREATIVE_CANVAS_CREDITS_COLLECTION).doc(orgId).get()
  if (!snap.exists) {
    return { orgId, used: 0, limit: null, updatedAt: null }
  }
  return serializeCanvasCredits(orgId, (snap.data() as CreditDoc) ?? {})
}

export function hasSufficientCredits(state: CanvasCreditState, cost: number): boolean {
  if (state.limit === null) return true
  return state.used + coerceCost(cost) <= state.limit
}

export async function recordCanvasCreditUsage(
  orgId: string,
  cost: number,
  meta?: { runId?: string; model?: string },
): Promise<CanvasCreditState> {
  const amount = coerceCost(cost)
  const runId = typeof meta?.runId === 'string' ? meta.runId : null
  const model = typeof meta?.model === 'string' ? meta.model : null

  const docRef = adminDb.collection(CREATIVE_CANVAS_CREDITS_COLLECTION).doc(orgId)
  await docRef.set(
    {
      orgId,
      used: FieldValue.increment(amount),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
  await docRef.collection(CREATIVE_CANVAS_CREDITS_USAGE_SUBCOLLECTION).add({
    cost: amount,
    runId,
    model,
    createdAt: FieldValue.serverTimestamp(),
  })
  return getCanvasCredits(orgId)
}

export interface CanvasCreditAdjustmentResult {
  state: CanvasCreditState
  /** Total credit amount moved by this call (0 when it was an idempotent no-op). */
  amount: number
  /** Whether any usage records were adjusted by this call. */
  adjusted: boolean
}

async function adjustRecordedCanvasCreditUsage(
  orgId: string,
  runId: string,
  direction: 'refund' | 'recharge',
): Promise<CanvasCreditAdjustmentResult> {
  const cleanRunId = typeof runId === 'string' && runId.trim() ? runId.trim() : null
  if (!cleanRunId) {
    return { state: await getCanvasCredits(orgId), amount: 0, adjusted: false }
  }

  const docRef = adminDb.collection(CREATIVE_CANVAS_CREDITS_COLLECTION).doc(orgId)
  const usageSnap = await docRef
    .collection(CREATIVE_CANVAS_CREDITS_USAGE_SUBCOLLECTION)
    .where('runId', '==', cleanRunId)
    .get()

  // Refunds only touch usage records that have not been refunded yet;
  // recharges only touch records that were previously refunded. This makes
  // duplicate calls (double-fail polls, repeated retries) safe no-ops.
  const eligible = usageSnap.docs.filter((usageDoc) => {
    const data = (usageDoc.data() as CreditDoc) ?? {}
    const alreadyRefunded = data.refunded === true
    return direction === 'refund' ? !alreadyRefunded : alreadyRefunded
  })

  if (!eligible.length) {
    return { state: await getCanvasCredits(orgId), amount: 0, adjusted: false }
  }

  // Flip the refund marker on the usage docs FIRST so a duplicate call cannot
  // move the same credits twice even if the counter update below fails.
  let amount = 0
  for (const usageDoc of eligible) {
    amount += coerceCost(((usageDoc.data() as CreditDoc) ?? {}).cost)
    await usageDoc.ref.update(
      direction === 'refund'
        ? { refunded: true, refundedAt: FieldValue.serverTimestamp() }
        : { refunded: false, rechargedAt: FieldValue.serverTimestamp() },
    )
  }

  if (amount > 0) {
    await docRef.set(
      {
        orgId,
        used: FieldValue.increment(direction === 'refund' ? -amount : amount),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  }

  return { state: await getCanvasCredits(orgId), amount, adjusted: true }
}

/**
 * Refund the credits recorded for a run that reached a terminal failure
 * state (failed / cancelled). Idempotent: each usage record for the run is
 * refunded at most once, so double-fail notifications are safe.
 */
export async function refundCanvasCreditUsage(orgId: string, runId: string): Promise<CanvasCreditAdjustmentResult> {
  return adjustRecordedCanvasCreditUsage(orgId, runId, 'refund')
}

/**
 * Re-apply a previously refunded charge when a failed run is retried under
 * the SAME run id. Idempotent: only usage records currently marked refunded
 * are recharged, so repeated retries never double-charge.
 */
export async function rechargeCanvasCreditUsage(orgId: string, runId: string): Promise<CanvasCreditAdjustmentResult> {
  return adjustRecordedCanvasCreditUsage(orgId, runId, 'recharge')
}

/** Record the real Higgsfield account balance (called by the runtime agent). */
export async function setCanvasHiggsfieldBalance(
  orgId: string,
  higgsfieldCredits: number,
  higgsfieldPlan?: string,
): Promise<CanvasCreditState> {
  const credits = typeof higgsfieldCredits === 'number' && Number.isFinite(higgsfieldCredits) ? higgsfieldCredits : 0
  await adminDb.collection(CREATIVE_CANVAS_CREDITS_COLLECTION).doc(orgId).set(
    {
      orgId,
      higgsfieldCredits: credits,
      ...(typeof higgsfieldPlan === 'string' && higgsfieldPlan.trim() ? { higgsfieldPlan: higgsfieldPlan.trim() } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
  return getCanvasCredits(orgId)
}

export async function setCanvasCreditLimit(orgId: string, limit: number | null): Promise<CanvasCreditState> {
  const nextLimit = coerceLimit(limit)
  await adminDb.collection(CREATIVE_CANVAS_CREDITS_COLLECTION).doc(orgId).set(
    {
      orgId,
      limit: nextLimit,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
  return getCanvasCredits(orgId)
}
