/**
 * GET  /api/v1/admin/system/infrastructure/alerts  — read infra alert thresholds
 * PATCH /api/v1/admin/system/infrastructure/alerts  — edit (super-admin only)
 *
 * Stored in `infra_alert_settings/global`:
 *   {
 *     thresholds: {
 *       cpuPct:    number,   // alert when host CPU above this %
 *       ramPct:    number,
 *       diskPct:   number,
 *       heartbeatStaleMinutes: number,  // alert when no heartbeat for N min
 *     },
 *     enabled: boolean,
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

const DOC = adminDb.collection('infra_alert_settings').doc('global')

interface Thresholds {
  cpuPct: number
  ramPct: number
  diskPct: number
  heartbeatStaleMinutes: number
}

const DEFAULTS: Thresholds = {
  cpuPct: 85,
  ramPct: 90,
  diskPct: 90,
  heartbeatStaleMinutes: 10,
}

const KEYS = Object.keys(DEFAULTS) as (keyof Thresholds)[]

async function readSettings(): Promise<{ enabled: boolean; thresholds: Thresholds }> {
  const snap = await DOC.get()
  const stored = snap.exists ? snap.data() : undefined
  const storedThresholds = (stored?.thresholds ?? {}) as Partial<Thresholds>
  const thresholds = {} as Thresholds
  for (const key of KEYS) {
    const v = storedThresholds[key]
    thresholds[key] = typeof v === 'number' && v > 0 ? v : DEFAULTS[key]
  }
  return { enabled: stored?.enabled ?? true, thresholds }
}

export const GET = withAuth('admin', async () => {
  return apiSuccess(await readSettings())
})

export const PATCH = withAuth('admin', async (req: NextRequest, user) => {
  if (!isSuperAdmin(user)) return apiError('Super admin only', 403)

  let body: { enabled?: boolean; thresholds?: Partial<Thresholds> }
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const current = await readSettings()
  const next: Thresholds = { ...current.thresholds }
  if (body.thresholds && typeof body.thresholds === 'object') {
    for (const key of KEYS) {
      const v = body.thresholds[key]
      if (typeof v === 'number' && v > 0) next[key] = Math.round(v)
    }
  }
  const enabled = typeof body.enabled === 'boolean' ? body.enabled : current.enabled

  await DOC.set(
    { enabled, thresholds: next, updatedAt: FieldValue.serverTimestamp(), updatedBy: user.uid },
    { merge: true },
  )

  return apiSuccess({ enabled, thresholds: next })
})
