/**
 * GET    /api/v1/admin/plans/[id]  — fetch one plan.
 * PATCH  /api/v1/admin/plans/[id]  — update plan fields.
 * DELETE /api/v1/admin/plans/[id]  — soft-archive (subscriptions may reference it).
 *
 * EFT-first / PayPal-second. NO Stripe.
 */
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import {
  DEFAULT_PLAN_LIMITS,
  PLAN_INTERVALS,
  type Plan,
  type PlanLimits,
} from '@/lib/plans/types'

export const dynamic = 'force-dynamic'

const COLLECTION = 'plans'

type RouteContext = { params: Promise<{ id: string }> }

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

export const GET = withAuth('admin', async (_req, _user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const doc = await adminDb.collection(COLLECTION).doc(id).get()
  if (!doc.exists) return apiError('Plan not found', 404)
  return apiSuccess({ id: doc.id, ...(doc.data() as Omit<Plan, 'id'>) })
})

export const PATCH = withAuth('admin', async (req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const ref = adminDb.collection(COLLECTION).doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Plan not found', 404)

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return apiError('Invalid JSON body', 400)

  const update: Record<string, unknown> = { ...lastActorFrom(user) }

  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (!name) return apiError('Plan name cannot be empty', 400)
    update.name = name
  }
  if (typeof body.description === 'string') update.description = body.description.trim()

  if (body.priceZar !== undefined) {
    const priceZar = Number(body.priceZar)
    if (!Number.isFinite(priceZar) || priceZar < 0) {
      return apiError('priceZar must be a non-negative number', 400)
    }
    update.priceZar = priceZar
  }

  if (body.interval !== undefined) {
    if (!PLAN_INTERVALS.includes(body.interval as Plan['interval'])) {
      return apiError(`interval must be one of: ${PLAN_INTERVALS.join(', ')}`, 400)
    }
    update.interval = body.interval
  }

  if (body.sortOrder !== undefined) {
    const sortOrder = Number(body.sortOrder)
    if (!Number.isFinite(sortOrder)) return apiError('sortOrder must be a number', 400)
    update.sortOrder = sortOrder
  }

  if (body.active !== undefined) update.active = Boolean(body.active)
  if (body.archived !== undefined) update.archived = Boolean(body.archived)
  if (body.limits !== undefined) update.limits = normalizeLimits(body.limits)
  if (body.featureFlags !== undefined) update.featureFlags = normalizeFlags(body.featureFlags)
  if (body.highlights !== undefined) update.highlights = normalizeHighlights(body.highlights)

  if (body.trialDays !== undefined) {
    const trialDays = Number(body.trialDays)
    // Coerce to null rather than writing undefined when cleared / invalid.
    update.trialDays = Number.isFinite(trialDays) && trialDays > 0 ? trialDays : null
  }

  await ref.update(update)
  const updated = await ref.get()
  return apiSuccess({ id: updated.id, ...(updated.data() as Omit<Plan, 'id'>) })
})

export const DELETE = withAuth('admin', async (_req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const ref = adminDb.collection(COLLECTION).doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Plan not found', 404)

  // Soft-archive only — existing subscriptions may still reference this plan,
  // so we never hard-delete. Archived + inactive removes it from offerings.
  await ref.update({
    archived: true,
    active: false,
    ...lastActorFrom(user),
  })
  const updated = await ref.get()
  return apiSuccess({ id: updated.id, ...(updated.data() as Omit<Plan, 'id'>) })
})
