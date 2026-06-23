// app/api/v1/admin/settings/alerts/route.ts
// Admin alert configuration (platform_config/alerts).
// GET (admin) returns config with all known events defaulted. PUT (super-admin)
// persists webhookUrl, slackEnabled, and per-event enable flags.
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { serializeGovernance, cleanStr, cleanBool, actorOf } from '@/lib/governance/firestore'
import { ALERT_EVENTS } from '@/lib/governance/alerts'

export const dynamic = 'force-dynamic'

const ALERTS_REF = () => adminDb.collection('platform_config').doc('alerts')

function defaultEvents(): Record<string, boolean> {
  return Object.fromEntries(ALERT_EVENTS.map((e) => [e, false]))
}

function mergeEvents(stored: unknown): Record<string, boolean> {
  const out = defaultEvents()
  if (stored && typeof stored === 'object') {
    for (const e of ALERT_EVENTS) {
      const v = (stored as Record<string, unknown>)[e]
      if (typeof v === 'boolean') out[e] = v
    }
  }
  return out
}

export const GET = withAuth('admin', async () => {
  try {
    const snap = await ALERTS_REF().get()
    const data = snap.exists ? snap.data() ?? {} : {}
    return apiSuccess(
      serializeGovernance({
        webhookUrl: typeof data.webhookUrl === 'string' ? data.webhookUrl : '',
        slackEnabled: data.slackEnabled === true,
        events: mergeEvents(data.events),
        availableEvents: ALERT_EVENTS,
      }),
    )
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const PUT = withAuth('admin', async (req, user) => {
  if (!isSuperAdmin(user)) return apiError('Forbidden', 403)
  try {
    const raw = await req.json().catch(() => ({}))
    const webhookUrl = cleanStr(raw.webhookUrl, 1000)
    if (webhookUrl && !/^https?:\/\//i.test(webhookUrl)) {
      return apiError('webhookUrl must be a valid http(s) URL', 400)
    }

    const events = defaultEvents()
    if (raw.events && typeof raw.events === 'object') {
      for (const e of ALERT_EVENTS) {
        events[e] = cleanBool((raw.events as Record<string, unknown>)[e], false)
      }
    }

    const record = {
      webhookUrl,
      slackEnabled: cleanBool(raw.slackEnabled, false),
      events,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorOf(user),
    }

    await ALERTS_REF().set(record, { merge: true })
    return apiSuccess(serializeGovernance({ webhookUrl, slackEnabled: record.slackEnabled, events, availableEvents: ALERT_EVENTS }))
  } catch (err) {
    return apiErrorFromException(err)
  }
})
