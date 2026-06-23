/**
 * GET  /api/v1/admin/system/health/alerts  — read alert settings
 * PATCH /api/v1/admin/system/health/alerts  — edit (super-admin only)
 *
 * Per-service alert settings stored in `health_alert_settings/global`:
 *   {
 *     services: {
 *       firestore: { enabled: boolean, latencyThresholdMs: number },
 *       auth:      { ... },
 *       paypal:    { ... },
 *       social:    { ... },
 *     },
 *     updatedAt, updatedBy
 *   }
 *
 * GET: admin. PATCH: super-admin.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { FieldValue } from 'firebase-admin/firestore'

export const dynamic = 'force-dynamic'

const DOC = adminDb.collection('health_alert_settings').doc('global')

const SERVICE_KEYS = ['firestore', 'auth', 'paypal', 'social'] as const
type ServiceKey = (typeof SERVICE_KEYS)[number]

interface ServiceAlert {
  enabled: boolean
  latencyThresholdMs: number
}

const DEFAULTS: Record<ServiceKey, ServiceAlert> = {
  firestore: { enabled: true, latencyThresholdMs: 1500 },
  auth: { enabled: true, latencyThresholdMs: 2000 },
  paypal: { enabled: true, latencyThresholdMs: 3000 },
  social: { enabled: false, latencyThresholdMs: 5000 },
}

async function readSettings(): Promise<Record<ServiceKey, ServiceAlert>> {
  const snap = await DOC.get()
  const stored = (snap.exists ? snap.data()?.services : undefined) as
    | Partial<Record<ServiceKey, Partial<ServiceAlert>>>
    | undefined
  const out = {} as Record<ServiceKey, ServiceAlert>
  for (const key of SERVICE_KEYS) {
    out[key] = {
      enabled: stored?.[key]?.enabled ?? DEFAULTS[key].enabled,
      latencyThresholdMs: stored?.[key]?.latencyThresholdMs ?? DEFAULTS[key].latencyThresholdMs,
    }
  }
  return out
}

export const GET = withAuth('admin', async () => {
  const services = await readSettings()
  return apiSuccess({ services })
})

export const PATCH = withAuth('admin', async (req: NextRequest, user) => {
  if (!isSuperAdmin(user)) return apiError('Super admin only', 403)

  let body: { services?: Partial<Record<ServiceKey, Partial<ServiceAlert>>> }
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON body', 400)
  }
  if (!body.services || typeof body.services !== 'object') {
    return apiError('Body must include a "services" object', 400)
  }

  const current = await readSettings()
  const next = { ...current }
  for (const key of SERVICE_KEYS) {
    const patch = body.services[key]
    if (!patch) continue
    next[key] = {
      enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current[key].enabled,
      latencyThresholdMs:
        typeof patch.latencyThresholdMs === 'number' && patch.latencyThresholdMs > 0
          ? Math.round(patch.latencyThresholdMs)
          : current[key].latencyThresholdMs,
    }
  }

  await DOC.set(
    { services: next, updatedAt: FieldValue.serverTimestamp(), updatedBy: user.uid },
    { merge: true },
  )

  return apiSuccess({ services: next })
})
