// app/api/v1/admin/settings/alerts/history/route.ts
// GET (admin): last 50 admin alert dispatch attempts, newest first.
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiErrorFromException } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { serializeGovernance } from '@/lib/governance/firestore'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async () => {
  try {
    const snap = await adminDb.collection('admin_alert_history').orderBy('at', 'desc').limit(50).get()
    const items = snap.docs.map((d) => serializeGovernance({ id: d.id, ...d.data() }))
    return apiSuccess(items)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
