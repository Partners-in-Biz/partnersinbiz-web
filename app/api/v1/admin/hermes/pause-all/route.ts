/**
 * POST /api/v1/admin/hermes/pause-all
 *
 * Global kill-switch for the Hermes fleet. Body { action: 'pause' | 'resume' }.
 *   - pause  → sets enabled=false on every hermes_profile_links doc.
 *   - resume → sets enabled=true on every hermes_profile_links doc.
 *
 * Writes are batched. Records a single `hermes.pause_all` / `hermes.resume_all`
 * audit entry with the affected count. Super-admin only.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { writeAdminAudit } from '@/lib/admin/audit'
import { HERMES_PROFILE_LINKS_COLLECTION } from '@/lib/hermes/server'

export const dynamic = 'force-dynamic'

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  if (!isSuperAdmin(user)) return apiError('Only super admins can pause or resume the Hermes fleet', 403)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const action = String(body.action ?? '')
  if (action !== 'pause' && action !== 'resume') {
    return apiError("action must be 'pause' or 'resume'", 400)
  }
  const enabled = action === 'resume'

  const snap = await adminDb.collection(HERMES_PROFILE_LINKS_COLLECTION).get()
  if (snap.empty) return apiSuccess({ action, affected: 0 })

  // Only flip docs that actually change to keep the count meaningful.
  const targets = snap.docs.filter((d) => (d.data()?.enabled !== false) !== enabled)
  let batch = adminDb.batch()
  let inBatch = 0
  let affected = 0
  for (const doc of targets) {
    batch.set(
      doc.ref,
      { enabled, updatedAt: FieldValue.serverTimestamp(), updatedBy: user.uid },
      { merge: true },
    )
    inBatch += 1
    affected += 1
    if (inBatch >= 400) {
      await batch.commit()
      batch = adminDb.batch()
      inBatch = 0
    }
  }
  if (inBatch > 0) await batch.commit()

  await writeAdminAudit(user, {
    action: action === 'pause' ? 'hermes.pause_all' : 'hermes.resume_all',
    summary: `${action === 'pause' ? 'Paused' : 'Resumed'} ${affected} Hermes profile link${affected === 1 ? '' : 's'}`,
    metadata: { action, affected, total: snap.size },
  })

  return apiSuccess({ action, affected, total: snap.size })
})
