import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'

export const CREATIVE_CANVAS_CREDITS_COLLECTION = 'creative_canvas_credits'
export const CREATIVE_CANVAS_CREDITS_USAGE_SUBCOLLECTION = 'usage'

export interface CanvasCreditState {
  orgId: string
  used: number
  limit: number | null
  updatedAt: unknown
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
  return {
    orgId,
    used: coerceUsed(data.used),
    limit: coerceLimit(data.limit),
    updatedAt: data.updatedAt ?? null,
  }
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
