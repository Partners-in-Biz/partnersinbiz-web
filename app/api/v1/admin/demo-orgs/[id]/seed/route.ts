/**
 * POST /api/v1/admin/demo-orgs/[id]/seed — seed demo data for a demo org.
 *
 * Writes the persona's sample contacts (demoSeed:true) scoped to the org and
 * records seededAt. Idempotent-ish: clears existing demoSeed data first so a
 * re-seed never duplicates.
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
import { isPersonaKey, clearSeededDemoData, seedDemoData, PERSONAS } from '../../_shared'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Super-admin access required', 403)
  const { id } = await (ctx as RouteContext).params

  const ref = adminDb.collection('organizations').doc(id)
  const snap = await ref.get()
  if (!snap.exists) return apiError('Organisation not found', 404)
  const data = snap.data() as Record<string, unknown>
  if (data.isDemo !== true) return apiError('Organisation is not tagged as a demo org', 400)
  const persona = data.demoPersona
  if (!isPersonaKey(persona)) return apiError('Demo org has no valid persona', 400)

  await clearSeededDemoData(id)
  const count = await seedDemoData(id, persona)
  await ref.set({ seededAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })

  await writeAdminAudit(user, {
    action: 'demo_org.seed',
    orgId: id,
    summary: `Seeded ${count} ${PERSONAS[persona].label} demo contacts for "${data.name ?? id}"`,
    metadata: { persona, count },
  })

  return apiSuccess({ id, seededContacts: count })
})
