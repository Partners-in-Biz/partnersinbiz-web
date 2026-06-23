// app/api/v1/admin/settings/maintenance/route.ts
// Scheduled maintenance window (platform_config/maintenance).
// GET (admin) returns current state + recent history. PUT (super-admin)
// toggles/schedules and appends to platform_config/maintenance/history.
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { serializeGovernance, cleanStr, cleanBool, actorOf, toMillis } from '@/lib/governance/firestore'
import { dispatchAdminAlert } from '@/lib/governance/alerts'

export const dynamic = 'force-dynamic'

const MAINT_REF = () => adminDb.collection('platform_config').doc('maintenance')

function cleanIpList(value: unknown): string[] {
  let arr: unknown[] = []
  if (Array.isArray(value)) arr = value
  else if (typeof value === 'string') arr = value.split(/[\n,]/)
  return Array.from(
    new Set(
      arr
        .map((v) => cleanStr(v, 64))
        .filter((ip) => ip.length > 0 && ip.length < 64),
    ),
  )
}

function toIsoOrNull(value: unknown): string | null {
  const ms = toMillis(value)
  return ms > 0 ? new Date(ms).toISOString() : null
}

export const GET = withAuth('admin', async () => {
  try {
    const snap = await MAINT_REF().get()
    const data = snap.exists ? snap.data() ?? {} : {}
    const state = {
      enabled: data.enabled === true,
      message: typeof data.message === 'string' ? data.message : '',
      scheduledStart: toIsoOrNull(data.scheduledStart),
      scheduledEnd: toIsoOrNull(data.scheduledEnd),
      ipAllowlist: Array.isArray(data.ipAllowlist) ? data.ipAllowlist : [],
    }

    const histSnap = await MAINT_REF().collection('history').orderBy('at', 'desc').limit(50).get()
    const history = histSnap.docs.map((d) => serializeGovernance({ id: d.id, ...d.data() }))

    return apiSuccess(serializeGovernance({ ...state, history }))
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const PUT = withAuth('admin', async (req, user) => {
  if (!isSuperAdmin(user)) return apiError('Forbidden', 403)
  try {
    const raw = await req.json().catch(() => ({}))

    const enabled = cleanBool(raw.enabled, false)
    const message = cleanStr(raw.message, 2000)
    const ipAllowlist = cleanIpList(raw.ipAllowlist)
    const startMs = toMillis(raw.scheduledStart)
    const endMs = toMillis(raw.scheduledEnd)

    if (startMs > 0 && endMs > 0 && endMs <= startMs) {
      return apiError('scheduledEnd must be after scheduledStart', 400)
    }

    const actor = actorOf(user)
    const record: Record<string, unknown> = {
      enabled,
      message,
      ipAllowlist,
      scheduledStart: startMs > 0 ? Timestamp.fromMillis(startMs) : FieldValue.delete(),
      scheduledEnd: endMs > 0 ? Timestamp.fromMillis(endMs) : FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor,
    }

    await MAINT_REF().set(record, { merge: true })
    await MAINT_REF().collection('history').add({
      enabled,
      message,
      window: {
        start: startMs > 0 ? new Date(startMs).toISOString() : null,
        end: endMs > 0 ? new Date(endMs).toISOString() : null,
      },
      ipAllowlist,
      actor,
      at: FieldValue.serverTimestamp(),
    })

    // Fan out to admin alert webhook (best-effort, never throws).
    void dispatchAdminAlert('maintenance.toggled', {
      enabled,
      message,
      scheduledStart: startMs > 0 ? new Date(startMs).toISOString() : null,
      scheduledEnd: endMs > 0 ? new Date(endMs).toISOString() : null,
      actor,
    })

    const snap = await MAINT_REF().get()
    const data = snap.data() ?? {}
    return apiSuccess(
      serializeGovernance({
        enabled: data.enabled === true,
        message: data.message ?? '',
        scheduledStart: toIsoOrNull(data.scheduledStart),
        scheduledEnd: toIsoOrNull(data.scheduledEnd),
        ipAllowlist: Array.isArray(data.ipAllowlist) ? data.ipAllowlist : [],
      }),
    )
  } catch (err) {
    return apiErrorFromException(err)
  }
})
