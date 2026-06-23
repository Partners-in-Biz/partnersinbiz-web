/**
 * DELETE /api/v1/admin/demo-orgs/[id] — untag a demo org.
 *
 * Sets isDemo:false, removes demo metadata, and cleans up all seeded demo data
 * (demoSeed contacts). The org itself is preserved.
 *
 * Auth: super-admin only.
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { writeAdminAudit } from '@/lib/admin/audit'
import { clearSeededDemoData } from '../_shared'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const DELETE = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Super-admin access required', 403)
  const { id } = await (ctx as RouteContext).params

  const ref = adminDb.collection('organizations').doc(id)
  const snap = await ref.get()
  if (!snap.exists) return apiError('Organisation not found', 404)
  const data = snap.data() as Record<string, unknown>

  const removed = await clearSeededDemoData(id)
  await ref.set({
    isDemo: false,
    demoPersona: FieldValue.delete(),
    demoToken: FieldValue.delete(),
    seededAt: FieldValue.delete(),
    resetAt: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  await writeAdminAudit(user, {
    action: 'demo_org.untag',
    orgId: id,
    summary: `Untagged "${data.name ?? id}" as a demo org and removed ${removed} seeded contacts`,
    metadata: { removed },
  })

  return apiSuccess({ id, removed })
})
