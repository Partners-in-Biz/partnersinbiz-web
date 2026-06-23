// app/api/v1/admin/settings/alerts/test/route.ts
// POST (super-admin): send a test payload to the configured webhook and record
// the attempt in admin_alert_history. Never throws on fetch failure — records
// a 'failed' attempt and returns the result.
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { serializeGovernance, actorOf } from '@/lib/governance/firestore'

export const dynamic = 'force-dynamic'

export const POST = withAuth('admin', async (req, user) => {
  if (!isSuperAdmin(user)) return apiError('Forbidden', 403)
  try {
    const snap = await adminDb.collection('platform_config').doc('alerts').get()
    const webhookUrl = snap.exists ? (snap.data()?.webhookUrl as string | undefined) : undefined
    if (!webhookUrl) return apiError('No webhook URL configured', 400)

    const actor = actorOf(user)
    const at = new Date().toISOString()
    const payload = { text: 'PiB admin alert test', event: 'test', at }

    let status: 'sent' | 'failed' = 'failed'
    let httpStatus: number | null = null
    let errorMessage: string | undefined

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      httpStatus = res.status
      status = res.ok ? 'sent' : 'failed'
      if (!res.ok) errorMessage = `HTTP ${res.status}`
    } catch (err) {
      status = 'failed'
      httpStatus = null
      errorMessage = err instanceof Error ? err.message : String(err)
    }

    const historyEntry: Record<string, unknown> = {
      event: 'test',
      status,
      httpStatus,
      actor,
      at: FieldValue.serverTimestamp(),
    }
    if (errorMessage) historyEntry.error = errorMessage

    await adminDb.collection('admin_alert_history').add(historyEntry)

    return apiSuccess(serializeGovernance({ status, httpStatus, at, ...(errorMessage ? { error: errorMessage } : {}) }))
  } catch (err) {
    return apiErrorFromException(err)
  }
})
