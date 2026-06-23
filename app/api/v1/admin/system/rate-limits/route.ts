/**
 * GET   /api/v1/admin/system/rate-limits
 * PATCH /api/v1/admin/system/rate-limits   (super-admin)
 *
 * Per-plan + per-API rate-limit control plane.
 *
 *   - configured limits: read from the `rate_limit_config` collection. If a
 *     config doc is missing it is SEEDED from the REAL current defaults:
 *       * per-plan usage limits come from the live `plans` collection
 *         (Plan.limits — emailsPerMonth, socialPostsPerMonth, etc.)
 *       * per-API request limits come from the values hard-coded at the call
 *         sites today (analytics ingest 100/min, fx 120/h, auth send 3/15m,
 *         url-audit 12/h). Seeding makes them editable without a redeploy.
 *   - live usage: top keys from the `rate_limits` collection (current counters
 *     + resetAt), sorted by count desc.
 *   - events: there is no dedicated 429 log collection, so the "events" list
 *     surfaces the `rate_limits` counters that have HIT their seeded ceiling
 *     (count >= the matching api limit) — i.e. real at-ceiling keys.
 *
 * All reads are single-collection scans (no composite indexes).
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

const CONFIG = 'rate_limit_config'

/**
 * REAL per-API request limits as configured at the call sites today.
 * Source files noted for traceability. Seeded into rate_limit_config/api so
 * they become editable. `keyPrefix` matches the prefix used on rate_limits docs
 * so the live-usage view can join a counter to its ceiling.
 */
const API_DEFAULTS: { id: string; label: string; limit: number; windowMs: number; source: string; keyPrefix?: string }[] = [
  { id: 'analytics_ingest', label: 'Analytics ingest (per ingest key)', limit: 100, windowMs: 60_000, source: 'lib/analytics/ingest-rate-limit.ts' },
  { id: 'fx_rates', label: 'FX rates (per IP)', limit: 120, windowMs: 60 * 60 * 1000, source: 'app/api/v1/fx/rates/route.ts' },
  { id: 'firebase_config', label: 'Firebase config (per IP)', limit: 120, windowMs: 60 * 60 * 1000, source: 'app/api/v1/firebase-config/route.ts' },
  { id: 'url_audit', label: 'URL audit tool (per IP)', limit: 12, windowMs: 60 * 60 * 1000, source: 'app/api/v1/tools/url-audit/route.ts' },
  { id: 'magic_link_send', label: 'Magic-link send (per email)', limit: 3, windowMs: 15 * 60 * 1000, source: 'app/api/v1/auth/magic-link/send/route.ts' },
  { id: 'magic_link_send_ip', label: 'Magic-link send (per IP)', limit: 10, windowMs: 15 * 60 * 1000, source: 'app/api/v1/auth/magic-link/send/route.ts' },
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMillis(value: any): number | null {
  if (!value) return null
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  if (typeof value.toMillis === 'function') return value.toMillis()
  return null
}

interface PlanLimitConfig {
  planKey: string
  planName: string
  limits: Record<string, number>
  source: string
}

async function loadOrSeedConfig(): Promise<{ plans: PlanLimitConfig[]; api: typeof API_DEFAULTS; seeded: string[] }> {
  const seeded: string[] = []

  // ---- API section ----
  const apiRef = adminDb.collection(CONFIG).doc('api')
  const apiSnap = await apiRef.get()
  let api = API_DEFAULTS
  if (!apiSnap.exists) {
    await apiRef.set({ entries: API_DEFAULTS, seededFrom: 'call-site defaults', updatedAt: FieldValue.serverTimestamp() })
    seeded.push('rate_limit_config/api')
  } else {
    const data = apiSnap.data() as { entries?: typeof API_DEFAULTS }
    api = data.entries?.length ? data.entries : API_DEFAULTS
  }

  // ---- Plans section: one config doc per plan, seeded from live plans ----
  const plansSnap = await adminDb.collection('plans').get()
  const plans: PlanLimitConfig[] = []
  for (const planDoc of plansSnap.docs) {
    const plan = planDoc.data() as { key?: string; name?: string; limits?: Record<string, number> }
    const planKey = plan.key || planDoc.id
    const cfgRef = adminDb.collection(CONFIG).doc(`plan_${planKey}`)
    const cfgSnap = await cfgRef.get()
    if (!cfgSnap.exists) {
      const seedLimits = plan.limits ?? {}
      await cfgRef.set({
        planKey,
        planName: plan.name ?? planKey,
        limits: seedLimits,
        seededFrom: 'plans collection',
        updatedAt: FieldValue.serverTimestamp(),
      })
      seeded.push(`rate_limit_config/plan_${planKey}`)
      plans.push({ planKey, planName: plan.name ?? planKey, limits: seedLimits, source: 'seeded' })
    } else {
      const data = cfgSnap.data() as { planKey?: string; planName?: string; limits?: Record<string, number> }
      plans.push({
        planKey: data.planKey ?? planKey,
        planName: data.planName ?? plan.name ?? planKey,
        limits: data.limits ?? {},
        source: 'rate_limit_config',
      })
    }
  }

  return { plans, api, seeded }
}

export const GET = withAuth('admin', async () => {
  const { plans, api, seeded } = await loadOrSeedConfig()

  // ---- live usage from rate_limits ----
  const usageSnap = await adminDb.collection('rate_limits').limit(1000).get()
  const nowMs = Date.now()
  const apiByPrefix = api // for ceiling lookup by key prefix

  const usage = usageSnap.docs
    .map((d) => {
      const data = d.data() as { count?: number; resetAt?: number }
      const key = d.id
      const prefix = key.includes(':') ? key.split(':')[0] : key
      const matchApi = apiByPrefix.find((a) => a.id === prefix || key.startsWith(prefix))
      return {
        key,
        count: typeof data.count === 'number' ? data.count : 0,
        resetAtMs: toMillis(data.resetAt),
        active: typeof data.resetAt === 'number' ? data.resetAt > nowMs : false,
        ceiling: matchApi?.limit ?? null,
      }
    })
    .sort((a, b) => b.count - a.count)

  // ---- events: keys at/over their ceiling ----
  const events = usage
    .filter((u) => u.ceiling !== null && u.count >= (u.ceiling as number) && u.active)
    .slice(0, 50)
    .map((u) => ({
      key: u.key,
      count: u.count,
      ceiling: u.ceiling,
      resetAtMs: u.resetAtMs,
      reason: 'at_ceiling',
    }))

  // ---- per-org overrides (for visibility) ----
  const overridesSnap = await adminDb.collection('rate_limit_overrides').limit(200).get()
  const overrides = overridesSnap.docs.map((d) => {
    const data = d.data() as { limit?: number; expiresAt?: number; disabled?: boolean; note?: string }
    return {
      orgId: d.id,
      limit: data.limit ?? null,
      disabled: Boolean(data.disabled),
      expiresAtMs: toMillis(data.expiresAt),
      note: data.note ?? '',
      active: typeof data.expiresAt === 'number' ? data.expiresAt > nowMs : true,
    }
  })

  return apiSuccess({
    plans,
    api,
    usage: usage.slice(0, 100),
    events,
    overrides,
    seeded,
    eventsNote:
      'No dedicated 429 log collection exists; "events" surfaces live rate_limits counters that have hit their configured ceiling. Add a 429 audit write at the call sites to capture a full history.',
    timestamp: new Date().toISOString(),
  })
})

interface PatchBody {
  scope: 'plan' | 'api'
  planKey?: string
  limits?: Record<string, number>
  apiEntries?: typeof API_DEFAULTS
}

export const PATCH = withAuth('admin', async (req: NextRequest, user) => {
  if (!isSuperAdmin(user)) return apiError('Super admin only', 403)

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  if (body.scope === 'api') {
    if (!Array.isArray(body.apiEntries)) return apiError('apiEntries[] required', 400)
    await adminDb.collection(CONFIG).doc('api').set(
      { entries: body.apiEntries, updatedBy: user.uid ?? 'admin', updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )
    return apiSuccess({ updated: 'api', entries: body.apiEntries.length })
  }

  if (body.scope === 'plan') {
    if (!body.planKey || typeof body.limits !== 'object' || !body.limits) {
      return apiError('planKey and limits{} required', 400)
    }
    // Coerce to numbers.
    const cleaned: Record<string, number> = {}
    for (const [k, v] of Object.entries(body.limits)) {
      const n = Number(v)
      if (!Number.isNaN(n)) cleaned[k] = n
    }
    await adminDb.collection(CONFIG).doc(`plan_${body.planKey}`).set(
      { planKey: body.planKey, limits: cleaned, updatedBy: user.uid ?? 'admin', updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )
    return apiSuccess({ updated: `plan_${body.planKey}`, limits: cleaned })
  }

  return apiError('scope must be "plan" or "api"', 400)
})
