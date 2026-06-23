/**
 * GET  /api/v1/admin/plans  — list all plans (incl. archived) by sortOrder.
 * POST /api/v1/admin/plans  — create a platform-managed plan.
 *
 * Plans are EFT-first / PayPal-second (NO Stripe). A plan drives FeatureGate
 * and per-org limits; billing is realised through the existing EFT/PayPal
 * invoice system, not a card-on-file subscription processor.
 */
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { actorFrom } from '@/lib/api/actor'
import {
  DEFAULT_PLAN_LIMITS,
  PLAN_INTERVALS,
  type Plan,
  type PlanLimits,
  type BillingInterval,
} from '@/lib/plans/types'

export const dynamic = 'force-dynamic'

const COLLECTION = 'plans'

/** Coerce an arbitrary limits payload into a complete PlanLimits shape. */
function normalizeLimits(input: unknown): PlanLimits {
  const out: PlanLimits = { ...DEFAULT_PLAN_LIMITS }
  if (input && typeof input === 'object') {
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      const n = Number(value)
      if (Number.isFinite(n)) out[key] = n
    }
  }
  return out
}

/** Coerce a feature-flag map into Record<string, boolean>. */
function normalizeFlags(input: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  if (input && typeof input === 'object') {
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      out[key] = Boolean(value)
    }
  }
  return out
}

function normalizeHighlights(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
}

export const GET = withAuth('admin', async () => {
  const snap = await adminDb.collection(COLLECTION).get()
  const plans: Plan[] = snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Plan, 'id'>) }))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  return apiSuccess(plans)
})

export const POST = withAuth('admin', async (req, user) => {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return apiError('Invalid JSON body', 400)

  const key = typeof body.key === 'string' ? body.key.trim().toLowerCase() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const priceZar = Number(body.priceZar)
  const interval = body.interval as BillingInterval

  if (!key) return apiError('Plan key is required', 400)
  if (!/^[a-z0-9_-]+$/.test(key)) {
    return apiError('Plan key may only contain lowercase letters, numbers, hyphens and underscores', 400)
  }
  if (!name) return apiError('Plan name is required', 400)
  if (!Number.isFinite(priceZar) || priceZar < 0) {
    return apiError('priceZar must be a non-negative number', 400)
  }
  if (!PLAN_INTERVALS.includes(interval)) {
    return apiError(`interval must be one of: ${PLAN_INTERVALS.join(', ')}`, 400)
  }

  // Enforce unique key.
  const existing = await adminDb.collection(COLLECTION).where('key', '==', key).limit(1).get()
  if (!existing.empty) {
    return apiError(`A plan with key "${key}" already exists`, 409)
  }

  const actor = actorFrom(user)
  const trialDays = Number(body.trialDays)

  const doc: Record<string, unknown> = {
    key,
    name,
    description: typeof body.description === 'string' ? body.description.trim() : '',
    priceZar,
    interval,
    sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
    active: body.active === undefined ? true : Boolean(body.active),
    archived: false,
    featureFlags: normalizeFlags(body.featureFlags),
    limits: normalizeLimits(body.limits),
    highlights: normalizeHighlights(body.highlights),
    ...actor,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }
  // Only persist trialDays when a valid positive number is provided (never write undefined).
  if (Number.isFinite(trialDays) && trialDays > 0) doc.trialDays = trialDays

  const ref = await adminDb.collection(COLLECTION).add(doc)
  const created = await ref.get()
  return apiSuccess({ id: ref.id, ...(created.data() as Omit<Plan, 'id'>) }, 201)
})
